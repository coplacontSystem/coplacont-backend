import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';
import {
  ConsumoLote,
  diaDe,
  EPSILON,
  LineaValorizada,
  MovimientoValorizable,
  ordenarMovimientos,
  ResultadoValoracion,
  valorizar,
} from './motor-valoracion';

/** Movimiento de un inventario con los datos que muestran el kardex y los reportes. */
export interface MovimientoInventario extends MovimientoValorizable {
  idInventario: number;
  idMovimiento: number | null;
  numeroDocumento: string | null;
  codigoOperacion: string | null;
  operacion: string | null;
  codigoComprobante: string | null;
  comprobante: string | null;
  serie: string | null;
  numero: string | null;
}

export interface InventarioValorizado {
  movimientos: MovimientoInventario[];
  resultado: ResultadoValoracion;
}

export interface SalidaPorCostear {
  idInventario: number;
  cantidad: number;
}

export interface SalidaCosteada {
  costoUnitario: number;
  consumos: ConsumoLote[];
}

/** Ids provisionales para salidas que aún no existen (van después de todo lo registrado). */
const ID_PROVISIONAL = 1e15;

/**
 * Lee los movimientos de inventario y los pasa por el motor de valoración.
 * Usa `dataSource.manager`, que dentro de `runInTransaction` es el de la transacción.
 */
@Injectable()
export class ValoracionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Movimientos procesados de los inventarios, en orden contable. */
  async cargarMovimientos(
    idsInventario: number[],
  ): Promise<Map<number, MovimientoInventario[]>> {
    const ids = [...new Set(idsInventario.map(Number))];
    const porInventario = new Map<number, MovimientoInventario[]>(
      ids.map((id) => [id, []]),
    );
    if (ids.length === 0) return porInventario;
    const manager = this.dataSource.manager;

    const filas: {
      id: string;
      id_inventario: string;
      cantidad: string;
      id_lote: string | null;
      costo_lote: string | null;
      id_movimiento: string;
      tipo: 'ENTRADA' | 'SALIDA' | 'AJUSTE';
      fecha: Date;
      numero_documento: string | null;
      cod_operacion: string | null;
      operacion: string | null;
      cod_comprobante: string | null;
      comprobante: string | null;
      serie: string | null;
      numero: string | null;
      salidas_devueltas: string[] | null;
    }[] = await manager.query(
      `SELECT md.id, md.id_inventario, md.cantidad, md.id_lote,
              l."costoUnitario" AS costo_lote,
              m.id AS id_movimiento, m.tipo::text AS tipo, m.fecha,
              m."numeroDocumento" AS numero_documento,
              COALESCE(top.codigo, m."codigoTabla12") AS cod_operacion,
              top.descripcion AS operacion,
              COALESCE(tco.codigo, m."codigoTabla10") AS cod_comprobante,
              tco.descripcion AS comprobante,
              c.serie, c.numero,
              -- Devolución de una venta (nota de crédito que entra): salidas cuyo costo hereda
              CASE WHEN m.tipo = 'ENTRADA' AND c.id_comprobante_afecto IS NOT NULL THEN (
                SELECT array_agg(md2.id)
                  FROM movimientos m2
                  JOIN movimiento_detalles md2 ON md2.id_movimiento = m2.id
                 WHERE m2.id_comprobante = c.id_comprobante_afecto
                   AND m2.tipo = 'SALIDA' AND m2.estado = 'PROCESADO'
                   AND md2.id_inventario = md.id_inventario)
              END AS salidas_devueltas
         FROM movimiento_detalles md
         JOIN movimientos m ON m.id = md.id_movimiento AND m.estado = 'PROCESADO'
         LEFT JOIN inventario_lote l ON l.id = md.id_lote
         LEFT JOIN comprobante c ON c."idComprobante" = m.id_comprobante
         LEFT JOIN tabla_detalle top ON top."idTablaDetalle" = c.id_tipo_operacion
         LEFT JOIN tabla_detalle tco ON tco."idTablaDetalle" = c.id_tipo_comprobante
        WHERE md.id_inventario = ANY($1)`,
      [ids],
    );

    for (const f of filas) {
      const cantidad = Number(f.cantidad);
      // Un ajuste positivo es una entrada; uno negativo, una salida
      const tipo =
        f.tipo === 'SALIDA' || (f.tipo === 'AJUSTE' && cantidad < 0)
          ? 'SALIDA'
          : 'ENTRADA';
      porInventario.get(Number(f.id_inventario))?.push({
        id: Number(f.id),
        idInventario: Number(f.id_inventario),
        fecha: new Date(f.fecha),
        tipo,
        cantidad: Math.abs(cantidad),
        idLote: f.id_lote != null ? Number(f.id_lote) : null,
        costoUnitario: Number(f.costo_lote) || 0,
        costoDeSalidas: f.salidas_devueltas?.map(Number),
        idMovimiento: Number(f.id_movimiento),
        numeroDocumento: f.numero_documento,
        codigoOperacion: f.cod_operacion,
        operacion: f.operacion,
        codigoComprobante: f.cod_comprobante,
        comprobante: f.comprobante,
        serie: f.serie,
        numero: f.numero,
      });
    }

    // Lotes de inventario inicial sin movimiento: entradas en su fecha de ingreso
    const iniciales: {
      id: string;
      id_inventario: string;
      cantidad: string;
      costo: string;
      fecha: string;
    }[] = await manager.query(
      `SELECT l.id, l.id_inventario, l."cantidadInicial" AS cantidad,
              l."costoUnitario" AS costo, to_char(l."fechaIngreso", 'YYYY-MM-DD') AS fecha
         FROM inventario_lote l
        WHERE l.id_inventario = ANY($1) AND l."cantidadInicial" > 0
          AND NOT EXISTS (SELECT 1 FROM movimiento_detalles x WHERE x.id_lote = l.id)`,
      [ids],
    );
    for (const l of iniciales) {
      porInventario.get(Number(l.id_inventario))?.push({
        // Ids negativos: no chocan con los detalles de movimiento y van primero en su día
        id: -Number(l.id),
        idInventario: Number(l.id_inventario),
        fecha: new Date(`${l.fecha}T12:00:00Z`),
        tipo: 'ENTRADA',
        cantidad: Number(l.cantidad),
        idLote: Number(l.id),
        costoUnitario: Number(l.costo) || 0,
        idMovimiento: null,
        numeroDocumento: 'INV-INIT',
        codigoOperacion: null,
        operacion: null,
        codigoComprobante: null,
        comprobante: null,
        serie: null,
        numero: null,
      });
    }

    for (const [id, lista] of porInventario) {
      porInventario.set(id, ordenarMovimientos(lista));
    }
    return porInventario;
  }

  /** Valoriza el historial completo de cada inventario. */
  async valorizarInventarios(
    idsInventario: number[],
    metodo: MetodoValoracion,
  ): Promise<Map<number, InventarioValorizado>> {
    const movimientos = await this.cargarMovimientos(idsInventario);
    const resultado = new Map<number, InventarioValorizado>();
    for (const [id, lista] of movimientos) {
      resultado.set(id, {
        movimientos: lista,
        resultado: valorizar(lista, metodo),
      });
    }
    return resultado;
  }

  /**
   * Costo y lotes de salidas por registrar en `fecha`, en el orden recibido.
   * Valoriza el historial con las salidas insertadas en su fecha; si dejan sin
   * stock a la propia salida o a una posterior, lanza 400 (stock en el tiempo).
   * Si hay salidas posteriores (registro retroactivo), reasigna sus lotes.
   * Llamar dentro de la transacción, con los inventarios ya bloqueados
   * (`bloquearInventarios`).
   */
  async costearSalidas(
    salidas: SalidaPorCostear[],
    fecha: Date,
    metodo: MetodoValoracion,
  ): Promise<SalidaCosteada[]> {
    const historial = await this.cargarMovimientos(
      salidas.map((s) => s.idInventario),
    );
    const costeadas: SalidaCosteada[] = new Array<SalidaCosteada>(
      salidas.length,
    );

    for (const [idInventario, existentes] of historial) {
      const nuevas = salidas
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => Number(s.idInventario) === idInventario)
        .map(({ s, i }) => ({
          indice: i,
          mov: {
            id: ID_PROVISIONAL + i,
            fecha,
            tipo: 'SALIDA' as const,
            cantidad: Number(s.cantidad),
          },
        }));

      const antes = valorizar(existentes, metodo);
      const despues = valorizar(
        ordenarMovimientos([...existentes, ...nuevas.map((n) => n.mov)]),
        metodo,
      );
      const faltante = (r: ResultadoValoracion) =>
        r.lineas.reduce((s, l) => s + l.faltante, 0);

      if (faltante(despues) - faltante(antes) > EPSILON) {
        const propias = despues.lineas.filter((l) => l.id >= ID_PROVISIONAL);
        const faltaEnPropias = propias.some((l) => l.faltante > EPSILON);
        const disponible = antes.lineas
          .filter((l) => diaDe(l.fecha) <= diaDe(fecha))
          .slice(-1)[0]?.saldoCantidad;
        throw new BadRequestException(
          faltaEnPropias
            ? `Stock insuficiente para el inventario ${idInventario}: disponible al ` +
              `${diaDe(fecha)}: ${Number(disponible ?? 0).toFixed(4)}`
            : `Stock insuficiente para el inventario ${idInventario}: con esta salida ` +
              'faltaría stock para salidas posteriores (revise ventas posteriores)',
        );
      }

      // Salidas ya registradas después de las nuevas: el FIFO físico cambió
      const primeraNueva = despues.lineas.findIndex(
        (l) => l.id >= ID_PROVISIONAL,
      );
      await this.reasignarLotes(
        despues.lineas
          .slice(primeraNueva)
          .filter(
            (l) => l.tipo === 'SALIDA' && l.id > 0 && l.id < ID_PROVISIONAL,
          ),
      );

      for (const { indice, mov } of nuevas) {
        const linea = despues.lineas.find((l) => l.id === mov.id)!;
        costeadas[indice] = {
          costoUnitario: linea.costoUnitario,
          // Lotes ficticios (entradas sin lote) se registran como lote 0
          consumos: linea.consumos.map((c) => ({
            ...c,
            idLote: c.idLote > 0 ? c.idLote : 0,
          })),
        };
      }
    }
    return costeadas;
  }

  /** Reemplaza los lotes consumidos (`detalle_salidas`) de salidas ya registradas. */
  private async reasignarLotes(lineas: LineaValorizada[]): Promise<void> {
    if (lineas.length === 0) return;
    const manager = this.dataSource.manager;
    const salidas: { id: string }[] = await manager.query(
      `SELECT md.id FROM movimiento_detalles md
         JOIN movimientos m ON m.id = md.id_movimiento
        WHERE md.id = ANY($1) AND m.tipo = 'SALIDA'`,
      [lineas.map((l) => l.id)],
    );
    const ids = new Set(salidas.map((s) => Number(s.id)));
    const filas = lineas
      .filter((l) => ids.has(l.id))
      .flatMap((l) =>
        l.consumos.map((c) => [
          l.id,
          c.idLote > 0 ? c.idLote : 0,
          c.costoUnitario,
          c.cantidad,
        ]),
      );
    await manager.query(
      'DELETE FROM detalle_salidas WHERE id_movimiento_detalle = ANY($1)',
      [[...ids]],
    );
    if (filas.length === 0) return;
    await manager.query(
      `INSERT INTO detalle_salidas
         (id_movimiento_detalle, id_lote, costo_unitario_de_lote, cantidad)
       SELECT * FROM unnest($1::int[], $2::int[], $3::numeric[], $4::numeric[])`,
      [0, 1, 2, 3].map((k) => filas.map((f) => f[k])),
    );
  }

  /**
   * Costo unitario con que salió cada inventario en un comprobante (para que
   * su devolución reingrese a ese costo). Sin salida registrada, no hay entrada.
   */
  async costoDeSalidaDe(
    idComprobante: number,
    idsInventario: number[],
    metodo: MetodoValoracion,
  ): Promise<Map<number, number>> {
    const costos = new Map<number, number>();
    const valorizados = await this.valorizarInventarios(idsInventario, metodo);
    const ids: { id: string }[] = await this.dataSource.manager.query(
      `SELECT md.id FROM movimientos m
         JOIN movimiento_detalles md ON md.id_movimiento = m.id
        WHERE m.id_comprobante = $1 AND m.tipo = 'SALIDA' AND m.estado = 'PROCESADO'`,
      [idComprobante],
    );
    const salidas = new Set(ids.map((r) => Number(r.id)));
    for (const [idInventario, { resultado }] of valorizados) {
      const lineas = resultado.lineas.filter((l) => salidas.has(l.id));
      const cantidad = lineas.reduce((s, l) => s + l.cantidad - l.faltante, 0);
      const costo = lineas.reduce((s, l) => s + l.costoTotal, 0);
      if (cantidad > EPSILON) costos.set(idInventario, costo / cantidad);
    }
    return costos;
  }
}
