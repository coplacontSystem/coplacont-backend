import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventarioLote } from '../entities/inventario-lote.entity';
import { Inventario } from '../entities/inventario.entity';
import { MovimientoDetalle } from '../../movimientos/entities/movimiento-detalle.entity';
import { DetalleSalida } from '../../movimientos/entities/detalle-salida.entity';
import { TipoMovimiento } from '../../movimientos/enum/tipo-movimiento.enum';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';
import { StockCacheService } from './stock-cache.service';

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
    @InjectRepository(Inventario)
    private readonly inventarioRepository: Repository<Inventario>,
    @InjectRepository(MovimientoDetalle)
    private readonly movimientoDetalleRepository: Repository<MovimientoDetalle>,
    private readonly stockCacheService: StockCacheService,
  ) {}

  private readonly logger = new Logger(StockCalculationService.name);

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
    const cachedResult = this.stockCacheService.getLoteStock(
      idLote,
      fechaHasta,
    );
    if (cachedResult && !fechaHasta) {
      return cachedResult;
    }

    // Obtener información base del lote
    const lote = await this.loteRepository.findOne({
      where: { id: idLote },
      select: [
        'id',
        'cantidadInicial',
        'costoUnitario',
        'fechaIngreso',
        'numeroLote',
      ],
    });

    if (!lote) {
      return null;
    }

    this.logger.log(
      `🔍 [STOCK-TRACE] Lote=${idLote} - Inicio cálculo${fechaHasta ? ` hasta ${fechaHasta.toISOString().split('T')[0]}` : ''}`,
    );
    // Calcular movimientos que afectan este lote
    const queryBuilder = this.movimientoDetalleRepository
      .createQueryBuilder('md')
      .innerJoin('md.movimiento', 'm')
      .where('md.idLote = :idLote', { idLote })
      .andWhere('m.estado = :estado', { estado: 'PROCESADO' });

    if (fechaHasta) {
      queryBuilder.andWhere('m.fecha <= :fechaHasta', { fechaHasta });
    }

    const entradasRow = await this.movimientoDetalleRepository
      .createQueryBuilder('md')
      .innerJoin('md.movimiento', 'm')
      .select('COALESCE(SUM(md.cantidad), 0)', 'total')
      .where('md.idLote = :idLote', { idLote })
      .andWhere('m.estado = :estado', { estado: 'PROCESADO' })
      .andWhere('m.tipo = :tipo', { tipo: TipoMovimiento.ENTRADA })
      .andWhere(fechaHasta ? 'm.fecha <= :fechaHasta' : '1=1', { fechaHasta })
      .getRawOne<{ total: string | number }>();

    const ajustesRow = await this.movimientoDetalleRepository
      .createQueryBuilder('md')
      .innerJoin('md.movimiento', 'm')
      .select('COALESCE(SUM(md.cantidad), 0)', 'total')
      .where('md.idLote = :idLote', { idLote })
      .andWhere('m.estado = :estado', { estado: 'PROCESADO' })
      .andWhere('m.tipo = :tipo', { tipo: TipoMovimiento.AJUSTE })
      .andWhere(fechaHasta ? 'm.fecha <= :fechaHasta' : '1=1', { fechaHasta })
      .getRawOne<{ total: string | number }>();

    const salidasRow = await this.movimientoDetalleRepository
      .createQueryBuilder('md')
      .innerJoin('md.movimiento', 'm')
      .innerJoin(DetalleSalida, 'ds', 'ds.id_movimiento_detalle = md.id')
      .select('COALESCE(SUM(ds.cantidad), 0)', 'total')
      .where('ds.id_lote = :idLote', { idLote })
      .andWhere('m.estado = :estado', { estado: 'PROCESADO' })
      .andWhere('m.tipo = :tipo', { tipo: TipoMovimiento.SALIDA })
      .andWhere(fechaHasta ? 'm.fecha <= :fechaHasta' : '1=1', { fechaHasta })
      .getRawOne<{ total: string | number }>();

    const entradas = parseFloat(String(entradasRow?.total ?? 0)) || 0;
    const salidas = parseFloat(String(salidasRow?.total ?? 0)) || 0;
    const ajustes = parseFloat(String(ajustesRow?.total ?? 0)) || 0;

    const tieneMovimientos = entradas > 0 || salidas > 0 || ajustes > 0;
    let cantidadActual: number;

    if (tieneMovimientos) {
      cantidadActual = entradas - salidas + ajustes;
    } else {
      if (!fechaHasta) {
        cantidadActual = Number(lote.cantidadInicial) || 0;
      } else {
        const hastaYmd = new Date(
          fechaHasta.getFullYear(),
          fechaHasta.getMonth(),
          fechaHasta.getDate(),
        );

        const invInit = await this.movimientoDetalleRepository
          .createQueryBuilder('md')
          .innerJoin('md.movimiento', 'm')
          .select(['m.fecha as fecha', 'm.numeroDocumento as numero'])
          .where('md.idLote = :idLote', { idLote })
          .andWhere('m.estado = :estado', { estado: 'PROCESADO' })
          .andWhere('m.numeroDocumento = :doc', { doc: 'INV-INIT' })
          .getRawOne<{ fecha: Date; numero: string }>();

        if (invInit && invInit.fecha) {
          const f = new Date(invInit.fecha);
          const initYmd = new Date(f.getFullYear(), f.getMonth(), f.getDate());
          cantidadActual =
            initYmd.getTime() <= hastaYmd.getTime()
              ? Number(lote.cantidadInicial) || 0
              : 0;
        } else {
          const ingreso = new Date(lote.fechaIngreso);
          const ingresoYmd = new Date(
            ingreso.getFullYear(),
            ingreso.getMonth(),
            ingreso.getDate(),
          );
          cantidadActual =
            ingresoYmd.getTime() <= hastaYmd.getTime()
              ? Number(lote.cantidadInicial) || 0
              : 0;
        }
      }
    }

    const result = {
      idLote: lote.id,
      cantidadActual: Math.max(0, cantidadActual), // No permitir stock negativo
      cantidadInicial: Number(lote.cantidadInicial),
      costoUnitario: Number(lote.costoUnitario),
      fechaIngreso: new Date(lote.fechaIngreso), // Asegurar que sea un objeto Date
      numeroLote: lote.numeroLote,
    };

    this.logger.log(
      `✅ [STOCK-TRACE] Lote=${idLote} Base=${tieneMovimientos ? 0 : Number(lote.cantidadInicial)} Entradas=${entradas} Salidas=${salidas} Ajustes=${ajustes} Actual=${result.cantidadActual} CostoUnitario=${result.costoUnitario}`,
    );

    // Guardar en caché
    this.stockCacheService.setLoteStock(idLote, fechaHasta, result);

    return result;
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
    // Para el método FIFO, necesitamos siempre calcular los lotes individuales
    // No usar caché cuando se necesiten los detalles de lotes
    const cachedResult = this.stockCacheService.getInventarioStock(
      idInventario,
      fechaHasta,
    );
    if (cachedResult && !fechaHasta) {
      // Solo usar caché para consultas sin fecha específica y cuando no se necesiten lotes
      const inventario = await this.inventarioRepository.findOne({
        where: { id: idInventario },
        relations: ['lotes'],
      });

      if (!inventario) return null;

      this.logger.log(
        `⚡ [STOCK-TRACE] Cache Inventario=${idInventario} Stock=${cachedResult.stockActual} CostoPromedio=${cachedResult.costoPromedioActual}`,
      );
      return {
        idInventario,
        stockActual: cachedResult.stockActual,
        costoPromedioActual: cachedResult.costoPromedioActual,
        lotes: [], // Los lotes se calculan dinámicamente cuando se necesiten
      };
    }
    // Verificar que el inventario existe
    const inventario = await this.inventarioRepository.findOne({
      where: { id: idInventario },
    });

    if (!inventario) {
      return null;
    }

    // Obtener todos los lotes del inventario
    const lotes = await this.loteRepository.find({
      where: { inventario: { id: idInventario } },
      select: [
        'id',
        'cantidadInicial',
        'costoUnitario',
        'fechaIngreso',
        'numeroLote',
      ],
      order: { fechaIngreso: 'ASC' },
    });

    // Calcular stock de cada lote
    const lotesConStock: LoteStockResult[] = [];
    let stockTotal = 0;
    let valorTotal = 0;

    this.logger.log(
      `🔍 [STOCK-TRACE] Inventario=${idInventario} Lotes=${lotes.length}`,
    );

    for (const lote of lotes) {
      const stockLote = await this.calcularStockLote(lote.id, fechaHasta);
      if (stockLote && stockLote.cantidadActual > 0) {
        lotesConStock.push(stockLote);
        stockTotal += stockLote.cantidadActual;
        valorTotal += stockLote.cantidadActual * stockLote.costoUnitario;
      }
    }

    // Ajuste por salidas registradas sin asignación de lote (idLote=0)
    const salidasFicticiasRow = await this.movimientoDetalleRepository
      .createQueryBuilder('md')
      .innerJoin('md.movimiento', 'm')
      .innerJoin(DetalleSalida, 'ds', 'ds.id_movimiento_detalle = md.id')
      .select('COALESCE(SUM(ds.cantidad), 0)', 'total')
      .where('md.idInventario = :idInventario', { idInventario })
      .andWhere('m.estado = :estado', { estado: 'PROCESADO' })
      .andWhere('m.tipo = :tipo', { tipo: TipoMovimiento.SALIDA })
      .andWhere('ds.id_lote = 0')
      .andWhere(fechaHasta ? 'm.fecha <= :fechaHasta' : '1=1', { fechaHasta })
      .getRawOne<{ total: string | number }>();

    const salidasFicticias =
      parseFloat(String(salidasFicticiasRow?.total ?? 0)) || 0;
    const stockTotalAjustado = Math.max(0, stockTotal - salidasFicticias);

    const costoPromedioActual =
      stockTotalAjustado > 0 ? valorTotal / stockTotalAjustado : 0;

    this.logger.log(
      `✅ [STOCK-TRACE] Inventario=${idInventario} StockTotal=${stockTotalAjustado} CostoPromedio=${costoPromedioActual} ValorTotal=${valorTotal}`,
    );
    const result = {
      idInventario,
      stockActual: stockTotalAjustado,
      costoPromedioActual,
      lotes: lotesConStock,
    };

    // Guardar en caché (solo los datos básicos)
    this.stockCacheService.setInventarioStock(idInventario, fechaHasta, {
      stockActual: stockTotalAjustado,
      costoPromedioActual: costoPromedioActual,
      valorTotal: stockTotalAjustado * costoPromedioActual,
    });

    return result;
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
  ): Promise<{ idLote: number; cantidad: number; costoUnitario: number }[]> {
    const lotesDisponibles = await this.obtenerLotesDisponiblesFIFO(
      idInventario,
      fechaHasta,
    );

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
      throw new Error(`Stock insuficiente. Faltante: ${cantidadRestante}`);
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
  ): Promise<number> {
    if (metodoValoracion === MetodoValoracion.PROMEDIO) {
      return await this.calcularCostoPromedio(idInventario, fechaHasta);
    } else {
      // FIFO: calcular costo promedio ponderado de los lotes que se van a consumir
      const consumo = await this.calcularConsumoFIFO(
        idInventario,
        cantidadVenta,
        fechaHasta,
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
