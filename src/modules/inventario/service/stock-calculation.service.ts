import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventarioLote } from '../entities/inventario-lote.entity';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';

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
 * Interfaz para lotes disponibles para FIFO
 */
export interface LoteDisponible {
  idLote: number;
  cantidadDisponible: number;
  costoUnitario: number;
  fechaIngreso: Date;
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
   * Stock de varios inventarios con tres consultas agregadas en total
   * (lotes con sus entradas/salidas, salidas sin lote e inventarios existentes),
   * en lugar de varias consultas por cada lote. Mismas reglas que calcularStockLote.
   */
  async calcularStockInventarios(
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

  /**
   * Obtiene los lotes disponibles para consumo FIFO
   * @param idInventario ID del inventario
   * @param fechaHasta Fecha límite para el cálculo (opcional)
   * @returns Lotes ordenados por FIFO con stock disponible
   */
  async obtenerLotesDisponiblesFIFO(
    idInventario: number,
    fechaHasta?: Date,
  ): Promise<LoteDisponible[]> {
    const stockInventario = await this.calcularStockInventario(
      idInventario,
      fechaHasta,
    );
    if (!stockInventario) {
      return [];
    }

    const lotesDisponibles = stockInventario.lotes
      .filter((lote) => lote.cantidadActual > 0)
      .map((lote) => ({
        idLote: lote.idLote,
        cantidadDisponible: lote.cantidadActual,
        costoUnitario: lote.costoUnitario,
        fechaIngreso: lote.fechaIngreso,
      }))
      .sort((a, b) => a.fechaIngreso.getTime() - b.fechaIngreso.getTime());

    return lotesDisponibles;
  }

  /**
   * Calcula el costo promedio ponderado de un inventario
   * @param idInventario ID del inventario
   * @param fechaHasta Fecha límite para el cálculo (opcional)
   * @returns Costo promedio ponderado
   */
  async calcularCostoPromedio(
    idInventario: number,
    fechaHasta?: Date,
  ): Promise<number> {
    const stockInventario = await this.calcularStockInventario(
      idInventario,
      fechaHasta,
    );
    return stockInventario?.costoPromedioActual || 0;
  }

  /**
   * Verifica si hay stock suficiente para una operación
   * @param idInventario ID del inventario
   * @param cantidadRequerida Cantidad requerida
   * @param fechaHasta Fecha límite para el cálculo (opcional)
   * @returns True si hay stock suficiente
   */
  async verificarStockSuficiente(
    idInventario: number,
    cantidadRequerida: number,
    fechaHasta?: Date,
  ): Promise<boolean> {
    const stockInventario = await this.calcularStockInventario(
      idInventario,
      fechaHasta,
    );
    return stockInventario
      ? stockInventario.stockActual >= cantidadRequerida
      : false;
  }

  /**
   * Calcula el consumo de lotes para una cantidad específica usando FIFO
   * @param idInventario ID del inventario
   * @param cantidadAConsumir Cantidad a consumir
   * @param fechaHasta Fecha límite para el cálculo (opcional)
   * @returns Detalle del consumo por lotes
   */
  async calcularConsumoFIFO(
    idInventario: number,
    cantidadAConsumir: number,
    fechaHasta?: Date,
    yaConsumido?: Map<number, number>,
  ): Promise<{ idLote: number; cantidad: number; costoUnitario: number }[]> {
    // Descuenta lo que ya consumieron otras líneas del mismo comprobante
    const lotesDisponibles = (
      await this.obtenerLotesDisponiblesFIFO(idInventario, fechaHasta)
    )
      .map((l) => ({
        ...l,
        cantidadDisponible:
          l.cantidadDisponible - (yaConsumido?.get(l.idLote) ?? 0),
      }))
      .filter((l) => l.cantidadDisponible > 1e-9);

    const consumo: {
      idLote: number;
      cantidad: number;
      costoUnitario: number;
    }[] = [];
    let cantidadRestante = cantidadAConsumir;

    for (const lote of lotesDisponibles) {
      if (cantidadRestante <= 0) break;

      const cantidadDelLote = Math.min(
        cantidadRestante,
        lote.cantidadDisponible,
      );

      consumo.push({
        idLote: lote.idLote,
        cantidad: cantidadDelLote,
        costoUnitario: lote.costoUnitario,
      });

      cantidadRestante -= cantidadDelLote;
    }

    if (cantidadRestante > 0) {
      throw new BadRequestException(
        `Stock insuficiente. Faltante: ${cantidadRestante}`,
      );
    }

    return consumo;
  }

  /**
   * Calcula el costo unitario para una venta usando el método especificado
   * @param idInventario ID del inventario
   * @param cantidadVenta Cantidad de la venta
   * @param metodoValoracion Método de valoración (FIFO o PROMEDIO)
   * @param fechaHasta Fecha límite para el cálculo (opcional)
   * @returns Costo unitario calculado
   */
  async calcularCostoUnitarioVenta(
    idInventario: number,
    cantidadVenta: number,
    metodoValoracion: MetodoValoracion,
    fechaHasta?: Date,
    yaConsumido?: Map<number, number>,
  ): Promise<number> {
    if (metodoValoracion === MetodoValoracion.PROMEDIO) {
      return await this.calcularCostoPromedio(idInventario, fechaHasta);
    } else {
      // FIFO: calcular costo promedio ponderado de los lotes que se van a consumir
      const consumo = await this.calcularConsumoFIFO(
        idInventario,
        cantidadVenta,
        fechaHasta,
        yaConsumido,
      );

      let costoTotal = 0;
      let cantidadTotal = 0;

      for (const item of consumo) {
        costoTotal += item.cantidad * item.costoUnitario;
        cantidadTotal += item.cantidad;
      }

      return cantidadTotal > 0 ? costoTotal / cantidadTotal : 0;
    }
  }
}
