import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventarioLote } from '../entities/inventario-lote.entity';
import { Inventario } from '../entities/inventario.entity';
import { ComprobanteDetalle } from '../../comprobantes/entities/comprobante-detalle';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';
import { StockCalculationService } from './stock-calculation.service';
import { StockCacheService } from './stock-cache.service';

/**
 * Servicio simplificado para creación de lotes sin campos calculados
 * Utiliza el nuevo sistema de cálculo dinámico
 */
@Injectable()
export class LoteCreationService {
  constructor(
    @InjectRepository(InventarioLote)
    private readonly loteRepository: Repository<InventarioLote>,
    @InjectRepository(Inventario)
    private readonly inventarioRepository: Repository<Inventario>,
    private readonly stockCalculationService: StockCalculationService,
    private readonly stockCacheService: StockCacheService,
  ) {}

  /**
   * Procesar lotes según el tipo de operación del comprobante
   */
  async procesarLotesComprobante(
    detalles: ComprobanteDetalle[],
    modo: 'ENTRADA' | 'SALIDA',
    metodoValoracion: MetodoValoracion = MetodoValoracion.PROMEDIO,
    fechaEmision: Date,
    factorCosto = 1,
  ): Promise<{
    costoUnitario: number[];
    lotes: { idLote: number; costoUnitarioDeLote: number; cantidad: number }[];
  }> {
    const costosUnitariosDeDetalles: number[] = [];
    const lotesUsados: {
      idLote: number;
      costoUnitarioDeLote: number;
      cantidad: number;
    }[] = [];
    // Consumo acumulado por lote entre las líneas de este mismo comprobante
    const consumidoPorLote = new Map<number, number>();

    // Stock "a la fecha": todo lo registrado hasta el final del día de emisión
    const fechaRef = new Date(
      Date.UTC(
        fechaEmision.getUTCFullYear(),
        fechaEmision.getUTCMonth(),
        fechaEmision.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    for (const detalle of detalles) {
      if (modo === 'ENTRADA') {
        // El costo del lote se guarda siempre en soles (factorCosto = tipo de cambio)
        const costo = Number(detalle.precioUnitario) * factorCosto;
        const loteCreado = await this.registrarLoteCompra(
          detalle,
          fechaEmision,
          costo,
        );
        costosUnitariosDeDetalles.push(costo);
        lotesUsados.push({
          idLote: loteCreado.id,
          costoUnitarioDeLote: costo,
          cantidad: Number(detalle.cantidad),
        });
        continue;
      }

      // Salida: costo según el método de valoración
      const costoUnitario =
        await this.stockCalculationService.calcularCostoUnitarioVenta(
          detalle.inventario.id,
          Number(detalle.cantidad),
          metodoValoracion,
          fechaRef,
          consumidoPorLote,
        );
      costosUnitariosDeDetalles.push(costoUnitario);

      // El stock físico siempre se descuenta de lotes reales por FIFO,
      // aunque el costo se calcule por promedio
      const consumoFIFO =
        await this.stockCalculationService.calcularConsumoFIFO(
          detalle.inventario.id,
          Number(detalle.cantidad),
          fechaRef,
          consumidoPorLote,
        );
      for (const consumo of consumoFIFO) {
        consumidoPorLote.set(
          consumo.idLote,
          (consumidoPorLote.get(consumo.idLote) ?? 0) + consumo.cantidad,
        );
        lotesUsados.push({
          idLote: consumo.idLote,
          costoUnitarioDeLote: consumo.costoUnitario,
          cantidad: consumo.cantidad,
        });
      }

      this.stockCacheService.invalidateInventario(detalle.inventario.id);
    }

    return {
      costoUnitario: costosUnitariosDeDetalles,
      lotes: lotesUsados,
    };
  }

  /**
   * Registrar lote para compra (sin actualizar campos calculados)
   */
  private async registrarLoteCompra(
    detalle: ComprobanteDetalle,
    fechaEmision: Date,
    costoUnitario: number,
  ): Promise<InventarioLote> {
    // Validar que el detalle tenga inventario
    if (!detalle.inventario || !detalle.inventario.id) {
      throw new Error('El detalle debe tener un inventario válido');
    }

    const inventario = await this.inventarioRepository.findOne({
      where: { id: detalle.inventario.id },
      relations: ['producto', 'almacen'],
    });

    if (!inventario) {
      throw new Error(`Inventario no encontrado: ${detalle.inventario.id}`);
    }

    // Validar que el inventario tenga producto y almacén
    if (!inventario.producto) {
      throw new Error(
        `El inventario ${detalle.inventario.id} no tiene un producto asociado`,
      );
    }
    if (!inventario.almacen) {
      throw new Error(
        `El inventario ${detalle.inventario.id} no tiene un almacén asociado`,
      );
    }

    // Validar cantidad y precio
    const cantidad = Number(detalle.cantidad);
    const precioUnitario = costoUnitario;

    if (cantidad <= 0) {
      throw new Error('La cantidad debe ser mayor a 0');
    }
    if (precioUnitario < 0) {
      throw new Error('El precio unitario no puede ser negativo');
    }

    // Crear nuevo lote (sin campos calculados)
    const lote = this.loteRepository.create({
      inventario: inventario,
      numeroLote: `LOTE-${Date.now()}-${inventario.id}-${inventario.producto.id}`,
      cantidadInicial: 0,
      costoUnitario: precioUnitario,
      fechaIngreso: fechaEmision,
      observaciones: `Lote creado automáticamente desde compra - ${detalle.descripcion || 'Sin descripción'}`,
    });

    const loteGuardado = await this.loteRepository.save(lote);

    // Invalidar caché después de la compra
    this.stockCacheService.invalidateInventario(inventario.id);

    return loteGuardado;
  }

  /**
   * Validar que los lotes se crearon correctamente para compras
   */
  async validarLotesCompra(detalles: ComprobanteDetalle[]): Promise<boolean> {
    try {
      for (const detalle of detalles) {
        // Buscar el lote más reciente creado (por ID, no por fecha de ingreso)
        // para evitar problemas con compras retroactivas
        const loteReciente = await this.loteRepository.findOne({
          where: { inventario: { id: detalle.inventario.id } },
          order: { id: 'DESC' },
          relations: ['inventario'],
        });

        if (!loteReciente) {
          return false;
        }

        // Validar datos del lote: aceptamos dos modalidades
        // 1) cantidadInicial igual a cantidad del detalle (modo tradicional)
        // 2) cantidadInicial = 0 y costo unitario correcto (modo movimiento-only)
        const cantidadInicialValida =
          Number(loteReciente.cantidadInicial) === Number(detalle.cantidad) ||
          Number(loteReciente.cantidadInicial) === 0;
        const costoUnitarioValido =
          Number(loteReciente.costoUnitario) === Number(detalle.precioUnitario);
        if (!cantidadInicialValida || !costoUnitarioValido) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}
