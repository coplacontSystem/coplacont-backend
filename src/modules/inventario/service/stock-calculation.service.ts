import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventarioLote } from '../entities/inventario-lote.entity';
import {
  KardexMaterializadoService,
  leerKardexMaterializado,
} from '../valoracion/kardex-materializado.service';

/**
 * Interfaz para el resultado del cálculo de stock de lote
 */
export interface LoteStockResult {
  idLote: number;
  cantidadActual: number;
  cantidadInicial: number;
  costoUnitario: number;
  fechaIngreso: Date;
  numeroLote?: string;
}

/**
 * Interfaz para el resultado del cálculo de stock de inventario
 */
export interface InventarioStockResult {
  idInventario: number;
  stockActual: number;
  costoPromedioActual: number;
  lotes: LoteStockResult[];
}

/**
 * Servicio para cálculo dinámico de stock de lotes e inventarios
 * Elimina la necesidad de mantener campos calculados en las entidades
 */
@Injectable()
export class StockCalculationService {
  constructor(
    @InjectRepository(InventarioLote)
    private readonly loteRepository: Repository<InventarioLote>,
    private readonly kardex: KardexMaterializadoService,
  ) {}

  /**
   * Calcula el stock actual de un lote específico
   * @param idLote ID del lote
   * @param fechaHasta Fecha límite para el cálculo (opcional)
   * @returns Stock actual del lote
   */
  async calcularStockLote(
    idLote: number,
    fechaHasta?: Date,
  ): Promise<LoteStockResult | null> {
    const lote = await this.loteRepository.findOne({
      where: { id: idLote },
      relations: ['inventario'],
    });
    if (!lote) return null;

    // Misma regla que el cálculo por inventario (una sola implementación)
    const stock = (
      await this.calcularStockInventarios([lote.inventario.id], fechaHasta)
    ).get(Number(lote.inventario.id));
    return (
      stock?.lotes.find((l) => l.idLote === Number(idLote)) ?? {
        idLote: Number(lote.id),
        cantidadActual: 0,
        cantidadInicial: Number(lote.cantidadInicial),
        costoUnitario: Number(lote.costoUnitario),
        fechaIngreso: new Date(lote.fechaIngreso),
        numeroLote: lote.numeroLote,
      }
    );
  }

  /**
   * Calcula el stock actual de todos los lotes de un inventario
   * @param idInventario ID del inventario
   * @param fechaHasta Fecha límite para el cálculo (opcional)
   * @returns Stock consolidado del inventario
   */
  async calcularStockInventario(
    idInventario: number,
    fechaHasta?: Date,
  ): Promise<InventarioStockResult | null> {
    // Sin caché en memoria: el cálculo agregado son tres consultas y un caché
    // por proceso se desincroniza cuando hay varias instancias del servidor
    const resultado = (
      await this.calcularStockInventarios([idInventario], fechaHasta)
    ).get(Number(idInventario)); // los ids bigint pueden llegar como texto
    return resultado ?? null;
  }

  /**
   * Stock de varios inventarios. Lee el saldo del kardex materializado
   * (el costo promedio es el valor del saldo según el método de valoración).
   */
  async calcularStockInventarios(
    idsInventario: number[],
    fechaHasta?: Date,
  ): Promise<Map<number, InventarioStockResult>> {
    if (!leerKardexMaterializado()) {
      return this.calcularStockDinamico(idsInventario, fechaHasta);
    }
    // fechaHasta es fin de día en hora local: su día calendario local
    const hastaDia = fechaHasta
      ? `${fechaHasta.getFullYear()}-${String(fechaHasta.getMonth() + 1).padStart(2, '0')}-${String(fechaHasta.getDate()).padStart(2, '0')}`
      : undefined;
    const saldos = await this.kardex.saldos(idsInventario, hastaDia);
    const resultado = new Map<number, InventarioStockResult>();
    for (const [id, saldo] of saldos) {
      resultado.set(id, {
        idInventario: id,
        stockActual: saldo.cantidad,
        costoPromedioActual: saldo.costoUnitario,
        lotes: saldo.lotes.map((l) => ({
          idLote: l.idLote,
          cantidadActual: l.cantidad,
          cantidadInicial: l.cantidadInicial,
          costoUnitario: l.costoUnitario,
          fechaIngreso: l.fechaIngreso,
          numeroLote: l.numeroLote,
        })),
      });
    }
    return resultado;
  }

  /**
   * Stock calculado desde los movimientos con tres consultas agregadas
   * (fase 3). Se usa con KARDEX_MATERIALIZADO=false para comparar.
   */
  private async calcularStockDinamico(
    idsInventario: number[],
    fechaHasta?: Date,
  ): Promise<Map<number, InventarioStockResult>> {
    const ids = [...new Set(idsInventario.map(Number))];
    const resultado = new Map<number, InventarioStockResult>();
    if (ids.length === 0) return resultado;

    const manager = this.loteRepository.manager;
    const params: unknown[] = [ids];
    let filtroFecha = '';
    if (fechaHasta) {
      params.push(fechaHasta);
      filtroFecha = 'AND m.fecha <= $2';
    }

    const existentes: { id: string }[] = await manager.query(
      'SELECT id FROM inventario WHERE id = ANY($1)',
      [ids],
    );
    for (const { id } of existentes) {
      resultado.set(Number(id), {
        idInventario: Number(id),
        stockActual: 0,
        costoPromedioActual: 0,
        lotes: [],
      });
    }

    const lotes: {
      id: string;
      id_inventario: string;
      cantidad_inicial: string;
      costo_unitario: string;
      fecha_ingreso: Date;
      numero_lote: string;
      entradas: string;
      ajustes: string;
      salidas: string;
      fecha_init: Date | null;
    }[] = await manager.query(
      `WITH lotes AS (
         SELECT * FROM inventario_lote WHERE id_inventario = ANY($1)
       ),
       mov AS (
         SELECT md.id_lote,
                SUM(CASE WHEN m.tipo = 'ENTRADA' THEN md.cantidad ELSE 0 END) AS entradas,
                SUM(CASE WHEN m.tipo = 'AJUSTE' THEN md.cantidad ELSE 0 END) AS ajustes
           FROM movimiento_detalles md
           JOIN movimientos m ON m.id = md.id_movimiento
          WHERE m.estado = 'PROCESADO' AND md.id_lote IN (SELECT id FROM lotes) ${filtroFecha}
          GROUP BY md.id_lote
       ),
       sal AS (
         SELECT ds.id_lote, SUM(ds.cantidad) AS salidas
           FROM detalle_salidas ds
           JOIN movimiento_detalles md ON md.id = ds.id_movimiento_detalle
           JOIN movimientos m ON m.id = md.id_movimiento
          WHERE m.estado = 'PROCESADO' AND m.tipo = 'SALIDA'
            AND ds.id_lote IN (SELECT id FROM lotes) ${filtroFecha}
          GROUP BY ds.id_lote
       ),
       init AS (
         SELECT md.id_lote, MIN(m.fecha) AS fecha_init
           FROM movimiento_detalles md
           JOIN movimientos m ON m.id = md.id_movimiento
          WHERE m.estado = 'PROCESADO' AND m."numeroDocumento" = 'INV-INIT'
            AND md.id_lote IN (SELECT id FROM lotes)
          GROUP BY md.id_lote
       )
       SELECT l.id, l.id_inventario, l."cantidadInicial" AS cantidad_inicial,
              l."costoUnitario" AS costo_unitario, l."fechaIngreso" AS fecha_ingreso,
              l."numeroLote" AS numero_lote,
              COALESCE(mov.entradas, 0) AS entradas, COALESCE(mov.ajustes, 0) AS ajustes,
              COALESCE(sal.salidas, 0) AS salidas, init.fecha_init
         FROM lotes l
         LEFT JOIN mov ON mov.id_lote = l.id
         LEFT JOIN sal ON sal.id_lote = l.id
         LEFT JOIN init ON init.id_lote = l.id
        ORDER BY l."fechaIngreso" ASC, l.id ASC`,
      params,
    );

    const dia = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const valorPorInventario = new Map<number, number>();

    for (const l of lotes) {
      const entradas = Number(l.entradas) || 0;
      const salidas = Number(l.salidas) || 0;
      const ajustes = Number(l.ajustes) || 0;
      const inicial = Number(l.cantidad_inicial) || 0;

      let cantidadActual: number;
      if (entradas > 0 || salidas > 0 || ajustes > 0) {
        cantidadActual = entradas - salidas + ajustes;
      } else if (!fechaHasta) {
        cantidadActual = inicial;
      } else {
        // Lote sin movimientos: cuenta su cantidad inicial desde su fecha de alta
        const desde = l.fecha_init
          ? new Date(l.fecha_init)
          : new Date(l.fecha_ingreso);
        cantidadActual = dia(desde) <= dia(fechaHasta) ? inicial : 0;
      }
      cantidadActual = Math.max(0, cantidadActual);
      if (cantidadActual <= 0) continue;

      const idInventario = Number(l.id_inventario);
      const stock = resultado.get(idInventario);
      if (!stock) continue;
      const costoUnitario = Number(l.costo_unitario);
      stock.lotes.push({
        idLote: Number(l.id),
        cantidadActual,
        cantidadInicial: inicial,
        costoUnitario,
        fechaIngreso: new Date(l.fecha_ingreso),
        numeroLote: l.numero_lote,
      });
      stock.stockActual += cantidadActual;
      valorPorInventario.set(
        idInventario,
        (valorPorInventario.get(idInventario) ?? 0) +
          cantidadActual * costoUnitario,
      );
    }

    // Salidas registradas sin asignación de lote (id_lote = 0)
    const ficticias: { id_inventario: string; total: string }[] =
      await manager.query(
        `SELECT md.id_inventario, COALESCE(SUM(ds.cantidad), 0) AS total
           FROM movimiento_detalles md
           JOIN movimientos m ON m.id = md.id_movimiento
           JOIN detalle_salidas ds ON ds.id_movimiento_detalle = md.id
          WHERE md.id_inventario = ANY($1) AND m.estado = 'PROCESADO'
            AND m.tipo = 'SALIDA' AND ds.id_lote = 0 ${filtroFecha}
          GROUP BY md.id_inventario`,
        params,
      );
    const ficticiasPorInventario = new Map(
      ficticias.map((f) => [Number(f.id_inventario), Number(f.total) || 0]),
    );

    for (const stock of resultado.values()) {
      const ajustado = Math.max(
        0,
        stock.stockActual -
          (ficticiasPorInventario.get(stock.idInventario) ?? 0),
      );
      const valor = valorPorInventario.get(stock.idInventario) ?? 0;
      stock.stockActual = ajustado;
      stock.costoPromedioActual = ajustado > 0 ? valor / ajustado : 0;
    }

    return resultado;
  }
}
