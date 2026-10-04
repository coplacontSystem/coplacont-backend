import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';
import {
  diaDe,
  MetodoSegunFecha,
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

/**
 * Lee los movimientos de inventario y los pasa por el motor de valoración.
 * Usa `dataSource.manager`, que dentro de `runInTransaction` es el de la transacción.
 */
@Injectable()
export class ValoracionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Movimientos procesados de los inventarios, en orden contable.
   * Con `desdeDia` ('YYYY-MM-DD') solo los de ese día en adelante.
   */
  async cargarMovimientos(
    idsInventario: number[],
    desdeDia?: string | null,
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
        WHERE md.id_inventario = ANY($1)
          -- Un día de margen por la zona horaria; el corte exacto se hace abajo
          AND ($2::date IS NULL OR m.fecha >= $2::date - 1)`,
      [ids, desdeDia ?? null],
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
          AND NOT EXISTS (SELECT 1 FROM movimiento_detalles x WHERE x.id_lote = l.id)
          AND ($2::date IS NULL OR l."fechaIngreso" >= $2::date)`,
      [ids, desdeDia ?? null],
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
      porInventario.set(
        id,
        ordenarMovimientos(
          desdeDia ? lista.filter((m) => diaDe(m.fecha) >= desdeDia) : lista,
        ),
      );
    }
    return porInventario;
  }

  /**
   * Método de valoración de cada inventario según la fecha: el del período
   * contable de su empresa que contiene esa fecha o, si no lo fija, el de la
   * configuración de la empresa.
   */
  async metodosPara(
    idsInventario: number[],
  ): Promise<Map<number, (fecha: Date) => MetodoValoracion>> {
    const ids = [...new Set(idsInventario.map(Number))];
    const resultado = new Map<number, (fecha: Date) => MetodoValoracion>();
    if (ids.length === 0) return resultado;
    const filas: {
      id_inventario: string;
      metodo_empresa: MetodoValoracion | null;
      periodos: { inicio: string; fin: string; metodo: MetodoValoracion }[];
    }[] = await this.dataSource.manager.query(
      `SELECT i.id AS id_inventario,
              (SELECT cp."metodoCalculoCosto"::text FROM configuracion_periodo cp
                WHERE cp.id_persona = a.id_persona AND cp.activa
                ORDER BY cp.id LIMIT 1) AS metodo_empresa,
              COALESCE((SELECT json_agg(json_build_object(
                         'inicio', to_char(p."fechaInicio", 'YYYY-MM-DD'),
                         'fin', to_char(p."fechaFin", 'YYYY-MM-DD'),
                         'metodo', p."metodoValoracion"))
                  FROM periodo_contable p
                 WHERE p.id_persona = a.id_persona AND p."metodoValoracion" IS NOT NULL),
                '[]') AS periodos
         FROM inventario i
         JOIN almacen a ON a.id = i.id_almacen
        WHERE i.id = ANY($1)`,
      [ids],
    );
    for (const f of filas) {
      const porDefecto = f.metodo_empresa ?? MetodoValoracion.PROMEDIO;
      resultado.set(Number(f.id_inventario), (fecha: Date) => {
        const dia = diaDe(fecha);
        return (
          f.periodos.find((p) => p.inicio <= dia && dia <= p.fin)?.metodo ??
          porDefecto
        );
      });
    }
    return resultado;
  }

  /**
   * Valoriza desde cero el historial completo de cada inventario (cálculo
   * dinámico). Sin `metodo`, el de cada período contable.
   */
  async valorizarInventarios(
    idsInventario: number[],
    metodo?: MetodoSegunFecha,
  ): Promise<Map<number, InventarioValorizado>> {
    const movimientos = await this.cargarMovimientos(idsInventario);
    const metodos = metodo ? null : await this.metodosPara(idsInventario);
    const resultado = new Map<number, InventarioValorizado>();
    for (const [id, lista] of movimientos) {
      resultado.set(id, {
        movimientos: lista,
        resultado: valorizar(
          lista,
          metodo ?? metodos!.get(id) ?? MetodoValoracion.PROMEDIO,
        ),
      });
    }
    return resultado;
  }
}
