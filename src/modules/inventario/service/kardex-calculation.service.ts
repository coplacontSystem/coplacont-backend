import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventarioLote } from '../entities/inventario-lote.entity';
import { Inventario } from '../entities/inventario.entity';
import { MovimientoDetalle } from '../../movimientos/entities/movimiento-detalle.entity';
import { TipoMovimiento } from '../../movimientos/enum/tipo-movimiento.enum';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';
import { StockCalculationService } from './stock-calculation.service';

/**
 * Interfaz para un movimiento de Kardex calculado dinámicamente
 */
export interface KardexMovement {
  fecha: Date;
  tipoOperacion: string; // Ahora es string en lugar de enum
  tipoOperacionCodigo?: string;
  tipoMovimiento: TipoMovimiento;
  tipoComprobante?: string;
  tipoComprobanteCodigo?: string;
  numeroComprobante?: string;
  cantidad: number;
  costoUnitario: number;
  costoTotal: number;
  cantidadSaldo: number;
  costoUnitarioSaldo: number;
  valorTotalSaldo: number;
  idInventario: number;
  idMovimiento: number;
  idMovimientoDetalle: number;
  detallesSalida?: DetalleSalidaCalculado[];
}

/**
 * Interfaz para detalles de salida calculados dinámicamente
 */
export interface DetalleSalidaCalculado {
  idLote: number;
  cantidad: number;
  costoUnitarioDeLote: number;
  costoTotal: number;
}

/**
 * Interfaz para el resultado completo del Kardex
 */
export interface KardexResult {
  idInventario: number;
  producto: {
    id: number;
    codigo: string;
    nombre: string;
    unidadMedida: string;
  };
  almacen: {
    id: number;
    nombre: string;
  };
  saldoInicial: {
    cantidad: number;
    costoUnitario: number;
    valorTotal: number;
  };
  movimientos: KardexMovement[];
  stockFinal: number;
  costoUnitarioFinal: number;
  valorTotalFinal: number;
}

/**
 * Servicio para cálculo dinámico completo del Kardex
 * Genera reportes de Kardex sin depender de datos precalculados
 */
@Injectable()
export class KardexCalculationService {
  // Estado temporal para el cálculo FIFO durante el procesamiento del Kardex
  private lotesDisponiblesTemporales: Map<
    number,
    { cantidadDisponible: number; costoUnitario: number; fechaIngreso: Date }
  > = new Map();

  constructor(
    @InjectRepository(Inventario)
    private readonly inventarioRepository: Repository<Inventario>,
    @InjectRepository(InventarioLote)
    private readonly loteRepository: Repository<InventarioLote>,
    @InjectRepository(MovimientoDetalle)
    private readonly movimientoDetalleRepository: Repository<MovimientoDetalle>,
    private readonly stockCalculationService: StockCalculationService,
  ) {}

  /**
   * Genera el Kardex completo para un inventario específico
   * @param idInventario ID del inventario
   * @param fechaDesde Fecha de inicio del período
   * @param fechaHasta Fecha de fin del período
   * @param metodoValoracion Método de valoración (PROMEDIO o FIFO)
   * @returns Kardex calculado dinámicamente
   */
  async generarKardex(
    idInventario: number,
    fechaDesde: Date,
    fechaHasta: Date,
    metodoValoracion: MetodoValoracion,
  ): Promise<KardexResult | null> {
    // Verificar que el inventario existe y obtener información del producto y almacén
    const inventario = await this.inventarioRepository.findOne({
      where: { id: idInventario },
      relations: ['producto', 'almacen'],
    });

    if (!inventario) {
      return null;
    }

    // Obtener todos los movimientos del inventario en el período
    const movimientos = await this.obtenerMovimientosInventario(
      idInventario,
      fechaDesde,
      fechaHasta,
    );

    // Calcular saldo inicial (movimientos anteriores a fechaDesde)
    const saldoInicial = await this.calcularSaldoInicial(
      idInventario,
      fechaDesde,
    );

    // Procesar movimientos según el método de valoración
    const movimientosKardex = await this.procesarMovimientos(
      movimientos,
      saldoInicial,
      metodoValoracion,
      idInventario,
      fechaDesde,
    );

    // Calcular valores finales
    const ultimoMovimiento = movimientosKardex[movimientosKardex.length - 1];
    const stockFinal = ultimoMovimiento?.cantidadSaldo || saldoInicial.cantidad;
    const costoUnitarioFinal =
      ultimoMovimiento?.costoUnitarioSaldo || saldoInicial.costoUnitario;
    const valorTotalFinal = stockFinal * costoUnitarioFinal;

    return {
      idInventario,
      producto: {
        id: inventario.producto.id,
        codigo: inventario.producto.codigo,
        nombre: inventario.producto.nombre,
        unidadMedida: inventario.producto.unidadMedida,
      },
      almacen: {
        id: inventario.almacen.id,
        nombre: inventario.almacen.nombre,
      },
      saldoInicial: {
        cantidad: saldoInicial.cantidad,
        costoUnitario: saldoInicial.costoUnitario,
        valorTotal: saldoInicial.valorTotal,
      },
      movimientos: movimientosKardex,
      stockFinal,
      costoUnitarioFinal,
      valorTotalFinal,
    };
  }

  /**
   * Obtiene todos los movimientos de un inventario en un período específico
   */
  private async obtenerMovimientosInventario(
    idInventario: number,
    fechaDesde: Date,
    fechaHasta: Date,
  ): Promise<any[]> {
    const movimientos = await this.movimientoDetalleRepository
      .createQueryBuilder('md')
      .innerJoin('md.movimiento', 'm')
      .leftJoin('m.comprobante', 'c')
      .leftJoin('c.tipoOperacion', 'to')
      .leftJoin('c.tipoComprobante', 'tc')
      .where('md.idInventario = :idInventario', { idInventario })
      .andWhere('m.fecha >= :fechaDesde', { fechaDesde })
      .andWhere('m.fecha <= :fechaHasta', { fechaHasta })
      .andWhere('m.estado = :estado', { estado: 'PROCESADO' })
      .select([
        'md.id as idmovimientodetalle',
        'md.cantidad as md_cantidad',
        'md.idLote as md_id_lote',
        'md.idInventario as md_id_inventario',
        'm.id as idmovimiento',
        'm.tipo as tipomovimiento',
        'm.fecha as m_fecha',
        'm.numeroDocumento as m_numeroDocumento',
        'm.codigoTabla12 as m_codigo_tabla12',
        'm.codigoTabla10 as m_codigo_tabla10',
        'to.descripcion as c_tipoOperacion',
        'to.codigo as c_tipoOperacion_codigo',
        'tc.descripcion as c_tipoComprobante',
        'tc.codigo as c_tipoComprobante_codigo',
        'c.serie as c_serie',
        'c.numero as c_numero',
        'c.correlativo as m_correlativo',
      ])
      .orderBy('m.fecha', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .getRawMany();

    // Si no hay movimientos, retornar lista vacía
    if (movimientos.length === 0) {
      return [];
    }

    return movimientos;
  }

  /**
   * Calcula el saldo inicial antes del período de consulta
   */
  private async calcularSaldoInicial(
    idInventario: number,
    fechaDesde: Date,
  ): Promise<{ cantidad: number; costoUnitario: number; valorTotal: number }> {
    // Obtener stock hasta la fecha de inicio (un día antes)
    const fechaAnterior = new Date(fechaDesde);
    fechaAnterior.setDate(fechaAnterior.getDate() - 1);
    fechaAnterior.setHours(23, 59, 59, 999); // Final del día anterior

    const stockInventario =
      await this.stockCalculationService.calcularStockInventario(
        idInventario,
        fechaAnterior,
      );

    if (!stockInventario || stockInventario.stockActual <= 0) {
      return { cantidad: 0, costoUnitario: 0, valorTotal: 0 };
    }

    const cantidad = stockInventario.stockActual;
    const costoUnitario = stockInventario.costoPromedioActual;
    const valorTotal = cantidad * costoUnitario;

    return { cantidad, costoUnitario, valorTotal };
  }

  /**
   * Procesa los movimientos aplicando el método de valoración correspondiente
   */
  private async procesarMovimientos(
    movimientos: any[],
    saldoInicial: {
      cantidad: number;
      costoUnitario: number;
      valorTotal: number;
    },
    metodoValoracion: MetodoValoracion,
    idInventario: number,
    fechaDesde: Date,
  ): Promise<KardexMovement[]> {
    const movimientosKardex: KardexMovement[] = [];
    let saldoActual = { ...saldoInicial };

    // Inicializar estado temporal de lotes para FIFO
    if (metodoValoracion === MetodoValoracion.FIFO) {
      await this.inicializarLotesTemporales(idInventario, fechaDesde);
    }

    for (let i = 0; i < movimientos.length; i++) {
      const mov = movimientos[i];

      const esEntrada = this.esMovimientoEntrada(
        mov.tipomovimiento,
        mov.c_tipoOperacion,
      );

      let movimientoKardex: KardexMovement;

      if (esEntrada) {
        movimientoKardex = await this.procesarEntrada(mov, saldoActual);

        // Actualizar lotes temporales para FIFO en entradas usando datos del movimiento calculado
        if (metodoValoracion === MetodoValoracion.FIFO && mov.md_id_lote) {
          this.actualizarLoteTemporalEntrada(
            Number(mov.md_id_lote),
            Number(movimientoKardex.cantidad),
            Number(movimientoKardex.costoUnitario),
            new Date(movimientoKardex.fecha),
          );
        }
      } else {
        const resultado = this.procesarSalida(
          mov,
          saldoActual,
          metodoValoracion,
          idInventario,
        );

        // Manejar el caso en que procesarSalida devuelve un array (FIFO con múltiples lotes)
        if (Array.isArray(resultado)) {
          // Agregar todos los movimientos al kardex
          movimientosKardex.push(...resultado);
          // Actualizar saldo con el último movimiento del array
          if (resultado.length > 0) {
            const ultimoMovimiento = resultado[resultado.length - 1];
            saldoActual = {
              cantidad: ultimoMovimiento.cantidadSaldo,
              costoUnitario: ultimoMovimiento.costoUnitarioSaldo,
              valorTotal: ultimoMovimiento.valorTotalSaldo,
            };
          }
          // Continuar con el siguiente movimiento
          continue;
        } else {
          // Caso normal (un solo movimiento)
          movimientoKardex = resultado;
        }
      }

      movimientosKardex.push(movimientoKardex);

      // Actualizar saldo para el siguiente movimiento
      saldoActual = {
        cantidad: movimientoKardex.cantidadSaldo,
        costoUnitario: movimientoKardex.costoUnitarioSaldo,
        valorTotal: movimientoKardex.valorTotalSaldo,
      };
    }

    // Limpiar estado temporal
    this.lotesDisponiblesTemporales.clear();

    return movimientosKardex;
  }

  /**
   * Procesa un movimiento de entrada (compra)
   */
  private async procesarEntrada(
    mov: any,
    saldoAnterior: {
      cantidad: number;
      costoUnitario: number;
      valorTotal: number;
    },
  ): Promise<KardexMovement> {
    const cantidad = Number(mov.md_cantidad);

    // Para entradas, obtener el costo del lote
    const costoUnitario = await this.obtenerCostoUnitarioEntrada(
      mov.md_id_lote,
    );

    const costoTotal = cantidad * costoUnitario;

    // Calcular nuevo saldo
    const nuevaCantidad = saldoAnterior.cantidad + cantidad;
    const nuevoValorTotal = saldoAnterior.valorTotal + costoTotal;
    const nuevoCostoUnitario =
      nuevaCantidad > 0 ? nuevoValorTotal / nuevaCantidad : 0;

    return {
      fecha: new Date(mov.m_fecha),
      tipoOperacion: mov.c_tipoOperacion,
      tipoOperacionCodigo: mov.c_tipoOperacion_codigo || mov.m_codigo_tabla12,
      tipoMovimiento: mov.tipomovimiento,
      tipoComprobante: mov.c_tipoComprobante,
      tipoComprobanteCodigo:
        mov.c_tipoComprobante_codigo || mov.m_codigo_tabla10,
      numeroComprobante:
        mov.c_serie && mov.c_numero
          ? `${mov.c_serie}-${mov.c_numero}`
          : mov.m_numeroDocumento,
      cantidad,
      costoUnitario,
      costoTotal,
      cantidadSaldo: nuevaCantidad,
      costoUnitarioSaldo: nuevoCostoUnitario,
      valorTotalSaldo: nuevoValorTotal,
      idInventario: Number(mov.md_id_inventario),
      idMovimiento: Number(mov.idmovimiento),
      idMovimientoDetalle: Number(mov.idmovimientodetalle),
    };
  }

  /**
   * Procesa un movimiento de salida (venta)
   */
  private procesarSalida(
    mov: any,
    saldoAnterior: {
      cantidad: number;
      costoUnitario: number;
      valorTotal: number;
    },
    metodoValoracion: MetodoValoracion,
    idInventario: number,
  ): KardexMovement | KardexMovement[] {
    const cantidad = Number(mov.md_cantidad);

    // Para método PROMEDIO, mantener el comportamiento original
    if (metodoValoracion === MetodoValoracion.PROMEDIO) {
      const costoUnitario = saldoAnterior.costoUnitario;
      const costoTotal = cantidad * costoUnitario;

      // Calcular nuevo saldo
      const nuevaCantidad = Math.max(0, saldoAnterior.cantidad - cantidad);
      const nuevoValorTotal = Math.max(
        0,
        saldoAnterior.valorTotal - costoTotal,
      );
      const nuevoCostoUnitario =
        nuevaCantidad > 0 ? nuevoValorTotal / nuevaCantidad : 0;

      return {
        fecha: new Date(mov.m_fecha),
        tipoOperacion: mov.c_tipoOperacion,
        tipoOperacionCodigo: mov.c_tipoOperacion_codigo || mov.m_codigo_tabla12,
        tipoMovimiento: mov.tipomovimiento,
        tipoComprobante: mov.c_tipoComprobante,
        tipoComprobanteCodigo:
          mov.c_tipoComprobante_codigo || mov.m_codigo_tabla10,
        numeroComprobante:
          mov.c_serie && mov.c_numero
            ? `${mov.c_serie}-${mov.c_numero}`
            : mov.m_numeroDocumento,
        cantidad,
        costoUnitario,
        costoTotal,
        cantidadSaldo: nuevaCantidad,
        costoUnitarioSaldo: nuevoCostoUnitario,
        valorTotalSaldo: nuevoValorTotal,
        idInventario: Number(mov.md_id_inventario),
        idMovimiento: Number(mov.idmovimiento),
        idMovimientoDetalle: Number(mov.idmovimientodetalle),
      };
    }

    // Para método FIFO, crear un movimiento por cada lote consumido
    else {
      // Calcular los lotes a consumir usando FIFO
      const resultadoFIFO = this.calcularCostoFIFO(idInventario, cantidad);

      const movimientosPorLote: KardexMovement[] = [];
      let saldoActualizado = { ...saldoAnterior };

      // Crear un movimiento por cada lote consumido
      for (const detalle of resultadoFIFO.detallesSalida) {
        const cantidadLote = detalle.cantidad;
        const costoUnitarioLote = detalle.costoUnitarioDeLote;
        const costoTotalLote = detalle.costoTotal;

        // Calcular nuevo saldo después de este lote
        const nuevaCantidad = Math.max(
          0,
          saldoActualizado.cantidad - cantidadLote,
        );
        const nuevoValorTotal = Math.max(
          0,
          saldoActualizado.valorTotal - costoTotalLote,
        );
        const nuevoCostoUnitario =
          nuevaCantidad > 0 ? nuevoValorTotal / nuevaCantidad : 0;

        // Crear movimiento para este lote
        const movimientoLote: KardexMovement = {
          fecha: new Date(mov.m_fecha),
          tipoOperacion: mov.c_tipoOperacion,
          tipoOperacionCodigo:
            mov.c_tipoOperacion_codigo || mov.m_codigo_tabla12,
          tipoMovimiento: mov.tipomovimiento,
          tipoComprobante: mov.c_tipoComprobante,
          tipoComprobanteCodigo:
            mov.c_tipoComprobante_codigo || mov.m_codigo_tabla10,
          numeroComprobante:
            mov.c_serie && mov.c_numero
              ? `${mov.c_serie}-${mov.c_numero}`
              : mov.m_numeroDocumento,
          cantidad: cantidadLote,
          costoUnitario: costoUnitarioLote,
          costoTotal: costoTotalLote,
          cantidadSaldo: nuevaCantidad,
          costoUnitarioSaldo: nuevoCostoUnitario,
          valorTotalSaldo: nuevoValorTotal,
          idInventario: Number(mov.md_id_inventario),
          idMovimiento: Number(mov.idmovimiento),
          idMovimientoDetalle: Number(mov.idmovimientodetalle),
          detallesSalida: [
            {
              idLote: detalle.idLote,
              cantidad: cantidadLote,
              costoUnitarioDeLote: costoUnitarioLote,
              costoTotal: costoTotalLote,
            },
          ],
        };

        movimientosPorLote.push(movimientoLote);

        // Actualizar saldo para el siguiente lote
        saldoActualizado = {
          cantidad: nuevaCantidad,
          costoUnitario: nuevoCostoUnitario,
          valorTotal: nuevoValorTotal,
        };
      }

      return movimientosPorLote;
    }
  }

  /**
   * Obtiene el costo unitario de una entrada desde el lote
   */
  private async obtenerCostoUnitarioEntrada(idLote: number): Promise<number> {
    if (!idLote) {
      return 0;
    }

    const lote = await this.loteRepository.findOne({
      where: { id: idLote },
      select: ['costoUnitario'],
    });

    return lote ? Number(lote.costoUnitario) : 0;
  }

  /**
   * Inicializa el estado temporal de lotes para el cálculo FIFO
   */
  private async inicializarLotesTemporales(
    idInventario: number,
    fechaInicio: Date,
  ): Promise<void> {
    this.lotesDisponiblesTemporales.clear();

    // Obtener lotes disponibles al inicio del período
    const fechaEstadoInicial = new Date(fechaInicio);
    fechaEstadoInicial.setDate(fechaEstadoInicial.getDate() - 1);
    fechaEstadoInicial.setHours(23, 59, 59, 999);
    const lotesDisponibles =
      await this.stockCalculationService.obtenerLotesDisponiblesFIFO(
        idInventario,
        fechaEstadoInicial,
      );

    // Cargar en el estado temporal
    for (const lote of lotesDisponibles) {
      this.lotesDisponiblesTemporales.set(lote.idLote, {
        cantidadDisponible: lote.cantidadDisponible,
        costoUnitario: lote.costoUnitario,
        fechaIngreso: lote.fechaIngreso,
      });
    }
  }

  /**
   * Actualiza el estado temporal cuando hay una entrada (nuevo lote)
   */
  private actualizarLoteTemporalEntrada(
    idLote: number,
    cantidad: number,
    costoUnitario: number,
    fechaIngreso: Date,
  ): void {
    const loteExistente = this.lotesDisponiblesTemporales.get(idLote);

    if (loteExistente) {
      // Actualizar cantidad del lote existente
      loteExistente.cantidadDisponible += cantidad;
    } else {
      // Agregar nuevo lote
      this.lotesDisponiblesTemporales.set(idLote, {
        cantidadDisponible: cantidad,
        costoUnitario: costoUnitario,
        fechaIngreso: fechaIngreso,
      });
    }
  }

  /**
   * Calcula el costo FIFO para una salida específica usando el estado temporal
   */
  private calcularCostoFIFO(
    idInventario: number,
    cantidadSalida: number,
  ): {
    costoUnitarioPromedio: number;
    detallesSalida: DetalleSalidaCalculado[];
  } {
    // Usar lotes temporales en lugar de consultar la base de datos
    const lotesDisponibles = Array.from(
      this.lotesDisponiblesTemporales.entries(),
    )
      .filter((entry) => entry[1].cantidadDisponible > 0)
      .map(([idLote, lote]) => ({
        idLote,
        cantidadDisponible: lote.cantidadDisponible,
        costoUnitario: lote.costoUnitario,
        fechaIngreso: lote.fechaIngreso,
      }))
      .sort((a, b) => {
        // Primero ordenar por fecha de ingreso
        const fechaDiff = a.fechaIngreso.getTime() - b.fechaIngreso.getTime();
        if (fechaDiff !== 0) return fechaDiff;
        // Si las fechas son iguales, ordenar por ID del lote (FIFO estricto)
        return a.idLote - b.idLote;
      });

    const detallesSalida: DetalleSalidaCalculado[] = [];
    let cantidadRestante = cantidadSalida;
    let costoTotalSalida = 0;

    for (const lote of lotesDisponibles) {
      if (cantidadRestante <= 0) break;

      const cantidadDelLote = Math.min(
        cantidadRestante,
        lote.cantidadDisponible,
      );
      const costoDelLote = cantidadDelLote * lote.costoUnitario;

      detallesSalida.push({
        idLote: lote.idLote,
        cantidad: cantidadDelLote,
        costoUnitarioDeLote: lote.costoUnitario,
        costoTotal: costoDelLote,
      });

      // Acumular costo total para el cálculo del promedio
      costoTotalSalida += costoDelLote;

      // Actualizar el estado temporal del lote
      const loteTemp = this.lotesDisponiblesTemporales.get(lote.idLote);
      if (loteTemp) {
        loteTemp.cantidadDisponible -= cantidadDelLote;
      }

      cantidadRestante -= cantidadDelLote;
    }

    const costoUnitarioPromedio =
      cantidadSalida > 0 ? costoTotalSalida / cantidadSalida : 0;

    return {
      costoUnitarioPromedio,
      detallesSalida,
    };
  }

  /**
   * Determina si un movimiento es de entrada
   */
  private esMovimientoEntrada(
    tipoMovimiento: TipoMovimiento,
    tipoOperacion?: string,
  ): boolean {
    if (tipoOperacion === 'COMPRA') {
      return true;
    }

    if (tipoMovimiento === TipoMovimiento.ENTRADA) {
      return true;
    }

    return false;
  }

  /**
   * Calcula el Kardex para múltiples inventarios
   * @param idsInventario Array de IDs de inventarios
   * @param fechaDesde Fecha de inicio del período
   * @param fechaHasta Fecha de fin del período
   * @param metodoValoracion Método de valoración
   * @returns Array de Kardex calculados
   */
  async generarKardexMultiple(
    idsInventario: number[],
    fechaDesde: Date,
    fechaHasta: Date,
    metodoValoracion: MetodoValoracion,
  ): Promise<KardexResult[]> {
    const resultados: KardexResult[] = [];

    for (const idInventario of idsInventario) {
      const kardex = await this.generarKardex(
        idInventario,
        fechaDesde,
        fechaHasta,
        metodoValoracion,
      );

      if (kardex) {
        resultados.push(kardex);
      }
    }

    return resultados;
  }

  /**
   * Obtiene un resumen de stock actual para múltiples inventarios
   * @param idsInventario Array de IDs de inventarios
   * @param fechaHasta Fecha límite para el cálculo
   * @returns Resumen de stocks
   */
  async obtenerResumenStock(
    idsInventario: number[],
    fechaHasta?: Date,
  ): Promise<
    {
      idInventario: number;
      stockActual: number;
      costoUnitario: number;
      valorTotal: number;
    }[]
  > {
    const resumen: {
      idInventario: number;
      stockActual: number;
      costoUnitario: number;
      valorTotal: number;
    }[] = [];

    for (const idInventario of idsInventario) {
      const stock = await this.stockCalculationService.calcularStockInventario(
        idInventario,
        fechaHasta,
      );

      if (stock) {
        resumen.push({
          idInventario,
          stockActual: stock.stockActual,
          costoUnitario: stock.costoPromedioActual,
          valorTotal: stock.stockActual * stock.costoPromedioActual,
        });
      }
    }

    return resumen;
  }
}
