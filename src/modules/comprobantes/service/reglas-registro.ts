import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { COMPROBANTE, OPERACION } from 'src/common/catalogo.service';
import { CreateComprobanteDetalleDto } from '../dto/comprobante-detalle/create-comprobante-detalle.dto';

/** Tolerancia para comparar importes redondeados a céntimos. */
const TOLERANCIA = 0.011;
/** Tolerancia para comparar cantidades. */
const EPSILON = 1e-9;
/** Espacio de nombres de los advisory locks de inventario. */
const LOCK_INVENTARIO = 7301;

export type ModoInventario = 'ENTRADA' | 'SALIDA';

/**
 * Fecha contable de un comprobante: el día calendario indicado, a las 12:00 UTC.
 * Así la fecha no cambia de día en ninguna zona horaria (Perú es UTC-5) y no
 * depende de la hora del servidor.
 */
export function fechaContable(valor: string | Date): Date {
  const d = new Date(valor);
  if (isNaN(d.getTime())) {
    throw new BadRequestException('La fecha de emisión no es válida');
  }
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12),
  );
}

/** 'YYYY-MM-DD' de una fecha contable (ver `fechaContable`, definida en UTC). */
export function ymdContable(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * 'YYYY-MM-DD' de una columna `date`. El driver de Postgres la entrega como
 * medianoche en la hora local del servidor, así que se leen los campos locales.
 */
export function ymd(valor: string | Date): string {
  if (typeof valor === 'string') return valor.slice(0, 10);
  const mes = String(valor.getMonth() + 1).padStart(2, '0');
  const dia = String(valor.getDate()).padStart(2, '0');
  return `${valor.getFullYear()}-${mes}-${dia}`;
}

/**
 * Convierte 'YYYY-MM-DD' en una fecha local para guardarla en una columna `date`
 * (new Date('YYYY-MM-DD') es medianoche UTC y en Perú cae el día anterior).
 */
export function fechaLocal(valor: string | Date): Date {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [a, m, d] = valor.split('-').map(Number);
    return new Date(a, m - 1, d);
  }
  return new Date(valor);
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Verifica que los importes de cada línea sean coherentes. No se confía en el
 * cliente: subtotal = cantidad × precio, IGV entre 0 y 18 %, total = subtotal + IGV + ISC.
 */
export function validarImportes(detalles: CreateComprobanteDetalleDto[]): void {
  detalles.forEach((d, i) => {
    const linea = `Línea ${i + 1}`;
    const subtotal = redondear(Number(d.cantidad) * Number(d.precioUnitario));
    if (Math.abs(subtotal - Number(d.subtotal)) > TOLERANCIA) {
      throw new BadRequestException(
        `${linea}: el subtotal debe ser cantidad × precio unitario (${subtotal.toFixed(2)})`,
      );
    }
    const igvMaximo = redondear(subtotal * 0.18);
    if (Number(d.igv) > igvMaximo + TOLERANCIA) {
      throw new BadRequestException(
        `${linea}: el IGV no puede superar el 18 % del subtotal (${igvMaximo.toFixed(2)})`,
      );
    }
    const total = redondear(
      Number(d.subtotal) + Number(d.igv ?? 0) + Number(d.isc ?? 0),
    );
    if (Math.abs(total - Number(d.total)) > TOLERANCIA) {
      throw new BadRequestException(
        `${linea}: el total debe ser subtotal + IGV + ISC (${total.toFixed(2)})`,
      );
    }
  });
}

/**
 * Qué movimiento de inventario genera un comprobante.
 * - Compra: entrada. Venta: salida.
 * - Nota de crédito: revierte la operación afectada (sobre una venta es una
 *   devolución que entra; sobre una compra, una devolución que sale).
 * - Nota de débito: mismo sentido que la operación afectada.
 * - Otros tipos de operación: no mueven inventario.
 */
export function modoInventario(
  codigoOperacion: string,
  codigoComprobante: string,
  codigoOperacionAfecta?: string,
): ModoInventario | null {
  const esNota =
    codigoComprobante === COMPROBANTE.NOTA_CREDITO ||
    codigoComprobante === COMPROBANTE.NOTA_DEBITO;
  const base = esNota ? codigoOperacionAfecta : codigoOperacion;
  let modo: ModoInventario | null =
    base === OPERACION.COMPRA
      ? 'ENTRADA'
      : base === OPERACION.VENTA
        ? 'SALIDA'
        : null;
  if (modo && codigoComprobante === COMPROBANTE.NOTA_CREDITO) {
    modo = modo === 'ENTRADA' ? 'SALIDA' : 'ENTRADA';
  }
  return modo;
}

/**
 * Bloquea los inventarios hasta el fin de la transacción. Dos registros que
 * tocan el mismo inventario se serializan (evita vender dos veces el mismo stock).
 * Se bloquean en orden para no generar deadlocks.
 */
export async function bloquearInventarios(
  manager: EntityManager,
  ids: number[],
): Promise<void> {
  const ordenados = [...new Set(ids.map(Number))].sort((a, b) => a - b);
  for (const id of ordenados) {
    await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
      LOCK_INVENTARIO,
      id,
    ]);
  }
}

/**
 * Verifica que una salida en `fecha` no deje el stock negativo en ningún
 * momento: ni ese día ni después (importa en registros con fecha pasada).
 */
export async function validarStockEnElTiempo(
  manager: EntityManager,
  idInventario: number,
  cantidad: number,
  fecha: Date,
): Promise<void> {
  const eventos: { fecha: Date; delta: string }[] = await manager.query(
    `SELECT m.fecha AS fecha,
            CASE m.tipo WHEN 'SALIDA' THEN -md.cantidad ELSE md.cantidad END AS delta,
            m.id AS orden
       FROM movimiento_detalles md
       JOIN movimientos m ON m.id = md.id_movimiento
      WHERE md.id_inventario = $1 AND m.estado = 'PROCESADO'
     UNION ALL
     -- Lotes con cantidad inicial y sin movimientos (inventario inicial)
     SELECT l."fechaIngreso"::timestamp, l."cantidadInicial", 0
       FROM inventario_lote l
      WHERE l.id_inventario = $1 AND l."cantidadInicial" > 0
        AND NOT EXISTS (SELECT 1 FROM movimiento_detalles x WHERE x.id_lote = l.id)
      ORDER BY 1, 3`,
    [idInventario],
  );

  const limite = fecha.getTime();
  let saldo = 0;
  let aplicada = false;
  let minimo = Number.POSITIVE_INFINITY;
  for (const e of eventos) {
    if (!aplicada && new Date(e.fecha).getTime() > limite) {
      saldo -= cantidad;
      aplicada = true;
      minimo = Math.min(minimo, saldo);
    }
    saldo += Number(e.delta);
    if (aplicada) minimo = Math.min(minimo, saldo);
  }
  if (!aplicada) {
    saldo -= cantidad;
    minimo = Math.min(minimo, saldo);
  }

  if (minimo < -EPSILON) {
    throw new BadRequestException(
      `Stock insuficiente para el inventario ${idInventario}: con esta salida el saldo ` +
        `llegaría a ${minimo.toFixed(4)}` +
        (saldo >= -EPSILON
          ? ' antes de reponerse (revise ventas posteriores)'
          : ''),
    );
  }
}
