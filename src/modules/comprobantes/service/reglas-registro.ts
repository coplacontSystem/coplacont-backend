import { BadRequestException } from '@nestjs/common';
import { COMPROBANTE, OPERACION } from 'src/common/catalogo.service';
import { CreateComprobanteDetalleDto } from '../dto/comprobante-detalle/create-comprobante-detalle.dto';

/** Tolerancia para comparar importes redondeados a céntimos. */
const TOLERANCIA = 0.011;

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

// Vive con el kardex materializado, que también lo usa
export { bloquearInventarios } from 'src/modules/inventario/valoracion/bloqueo';
