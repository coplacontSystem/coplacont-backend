import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventarioLote } from '../entities/inventario-lote.entity';
import { Inventario } from '../entities/inventario.entity';
import { ComprobanteDetalle } from '../../comprobantes/entities/comprobante-detalle';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';
import { ValoracionService } from '../valoracion/valoracion.service';

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
    private readonly valoracion: ValoracionService,
  ) {}

  /**
   * Procesar lotes según el tipo de operación del comprobante.
   * - Entrada: crea un lote por línea, al costo en soles (`precio × factorCosto`)
   *   o al de `costosEntrada` por inventario (devolución de una venta).
   * - Salida: costo y lotes consumidos según el motor de valoración; valida que
   *   haya stock en la fecha y después (registros retroactivos).
   */
  async procesarLotesComprobante(
    detalles: ComprobanteDetalle[],
    modo: 'ENTRADA' | 'SALIDA',
    metodoValoracion: MetodoValoracion = MetodoValoracion.PROMEDIO,
    fechaEmision: Date,
    factorCosto = 1,
    costosEntrada?: Map<number, number>,
  ): Promise<{
    costoUnitario: number[];
    lotes: { idLote: number; costoUnitarioDeLote: number; cantidad: number }[];
  }> {
    if (modo === 'SALIDA') {
      const costeadas = await this.valoracion.costearSalidas(
        detalles.map((d) => ({
          idInventario: Number(d.inventario.id),
          cantidad: Number(d.cantidad),
        })),
        fechaEmision,
        metodoValoracion,
      );
      return {
        costoUnitario: costeadas.map((c) => c.costoUnitario),
        lotes: costeadas.flatMap((c) =>
          c.consumos.map((consumo) => ({
            idLote: consumo.idLote,
            costoUnitarioDeLote: consumo.costoUnitario,
            cantidad: consumo.cantidad,
          })),
        ),
      };
    }

    const costosUnitariosDeDetalles: number[] = [];
    const lotesUsados: {
      idLote: number;
      costoUnitarioDeLote: number;
      cantidad: number;
    }[] = [];
    for (const detalle of detalles) {
      // El costo del lote se guarda siempre en soles (factorCosto = tipo de cambio)
      const costo =
        costosEntrada?.get(Number(detalle.inventario.id)) ??
        Number(detalle.precioUnitario) * factorCosto;
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

    return loteGuardado;
  }
}
