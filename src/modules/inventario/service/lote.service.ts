import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventarioLote } from '../entities';
import { StockCalculationService } from './stock-calculation.service';

@Injectable()
export class LoteService {
  constructor(
    @InjectRepository(InventarioLote)
    private readonly loteRepository: Repository<InventarioLote>,
    private readonly stockCalculationService: StockCalculationService,
  ) {}

  /**
   * Obtener lotes recientes (últimos 10)
   */
  async findLotesRecientes(personaId: number): Promise<InventarioLote[]> {
    return this.loteRepository.find({
      where: { inventario: { almacen: { persona: { id: personaId } } } },
      relations: ['inventario', 'inventario.producto', 'inventario.almacen'],
      order: { fechaIngreso: 'DESC' },
      take: 10,
    });
  }

  /**
   * Obtener lotes por inventario
   */
  async findLotesByInventario(idInventario: number): Promise<InventarioLote[]> {
    return this.loteRepository.find({
      where: { inventario: { id: idInventario } },
      relations: ['inventario', 'inventario.producto', 'inventario.almacen'],
      order: { fechaIngreso: 'ASC' },
    });
  }

  /**
   * Obtener lote por ID
   */
  async findLoteById(id: number): Promise<InventarioLote | null> {
    return this.loteRepository.findOne({
      where: { id },
      relations: ['inventario', 'inventario.producto', 'inventario.almacen'],
    });
  }

  /**
   * Obtener lotes con stock disponible (usando cálculo dinámico)
   */
  async findLotesDisponibles(idInventario: number): Promise<InventarioLote[]> {
    const lotes = await this.loteRepository.find({
      where: { inventario: { id: idInventario } },
      relations: ['inventario', 'inventario.producto', 'inventario.almacen'],
      order: { fechaIngreso: 'ASC' },
    });

    // Filtrar lotes con stock disponible usando cálculo dinámico
    const lotesConStock: InventarioLote[] = [];
    for (const lote of lotes) {
      const stockLote = await this.stockCalculationService.calcularStockLote(
        lote.id,
      );
      if (stockLote && stockLote.cantidadActual > 0) {
        // Agregar el stock calculado dinámicamente al objeto lote
        (lote as any).cantidadActual = stockLote.cantidadActual;
        lotesConStock.push(lote);
      }
    }

    return lotesConStock;
  }
}
