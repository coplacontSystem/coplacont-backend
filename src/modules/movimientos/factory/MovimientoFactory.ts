import { Comprobante } from 'src/modules/comprobantes/entities/comprobante';
import {
  CreateMovimientoDetalleDto,
  CreateMovimientoDto,
  CreateDetalleSalidaDto,
} from '../dto';
import { EstadoMovimiento, TipoMovimiento } from '../enum';
import { Injectable } from '@nestjs/common';
import { ComprobanteDetalle } from 'src/modules/comprobantes/entities/comprobante-detalle';

@Injectable()
export class MovimientoFactory {
  constructor() {}

  /**
   * Crea un movimiento desde un comprobante.
   * El tipo (entrada/salida) lo decide quien registra el comprobante, según la
   * operación y el tipo de comprobante (ver reglas-registro.ts).
   */
  createMovimientoFromComprobante(
    comprobante: Comprobante,
    costosUnitarios: number[],
    precioYcantidadPorLote: {
      idLote: number;
      costoUnitarioDeLote: number;
      cantidad: number;
    }[],
    tipoMovimiento: TipoMovimiento,
  ): CreateMovimientoDto {
    const modoOperacion =
      tipoMovimiento === TipoMovimiento.ENTRADA ? 'COMPRA' : 'VENTA';
    const detalles = this.createMovimientosDetallesFromDetallesComprobante(
      comprobante.detalles,
      modoOperacion,
      costosUnitarios,
      precioYcantidadPorLote,
    );

    return {
      numeroDocumento: comprobante.serie + '-' + comprobante.numero,
      tipo: tipoMovimiento,
      // Misma fecha contable que el comprobante
      fecha: new Date(comprobante.fechaEmision),
      observaciones: `Movimiento generado desde comprobante ${comprobante.serie}-${comprobante.numero}`,
      estado: EstadoMovimiento.PROCESADO,
      idComprobante: comprobante.idComprobante,
      detalles: detalles,
    };
  }

  /**
   * Crea los detalles de movimiento desde los detalles del comprobante
   * Para ventas: calcula el costo unitario usando el método de costeo promedio ponderado
   * Para compras: usa el precio unitario original del comprobante
   */
  createMovimientosDetallesFromDetallesComprobante(
    detalles: ComprobanteDetalle[],
    tipoOperacion: string,
    _costosUnitarios: number[],
    precioYcantidadPorLote: {
      idLote: number;
      costoUnitarioDeLote: number;
      cantidad: number;
    }[],
  ): CreateMovimientoDetalleDto[] {
    const movimientoDetalles: CreateMovimientoDetalleDto[] = [];
    let indiceLote = 0; // Contador para acceder a los lotes por detalle

    for (const detalle of detalles) {
      // Validar que el detalle tenga inventario
      if (!detalle.inventario || !detalle.inventario.id) {
        // Inventario inválido: saltar este detalle
        continue;
      }

      let detallesSalida: CreateDetalleSalidaDto[] | undefined;

      const op = (tipoOperacion || '').toUpperCase();
      if (!(op === 'COMPRA' || op.includes('ENTRADA'))) {
        // Obtener los lotes correspondientes a este detalle
        const lotesParaEsteDetalle: CreateDetalleSalidaDto[] = [];
        let cantidadRestante = Number(detalle.cantidad);

        while (
          cantidadRestante > 0 &&
          indiceLote < precioYcantidadPorLote.length
        ) {
          const lote = precioYcantidadPorLote[indiceLote];
          const cantidadAUsar = Math.min(cantidadRestante, lote.cantidad);

          lotesParaEsteDetalle.push({
            idLote: lote.idLote,
            costoUnitarioDeLote: lote.costoUnitarioDeLote,
            cantidad: cantidadAUsar,
          });

          cantidadRestante -= cantidadAUsar;

          if (cantidadAUsar === lote.cantidad) {
            indiceLote++;
          } else {
            // Actualizar la cantidad restante del lote
            precioYcantidadPorLote[indiceLote].cantidad -= cantidadAUsar;
          }
        }

        detallesSalida =
          lotesParaEsteDetalle.length > 0 ? lotesParaEsteDetalle : undefined;
      }

      const movimientoDetalle: CreateMovimientoDetalleDto = {
        idInventario: detalle.inventario.id,
        cantidad: detalle.cantidad,
      };

      // Para compras/entradas, asignar el idLote del lote creado
      if (op === 'COMPRA' || op.includes('ENTRADA') || op.includes('INGRESO')) {
        if (indiceLote < precioYcantidadPorLote.length) {
          const loteCompra = precioYcantidadPorLote[indiceLote];
          movimientoDetalle.idLote = loteCompra.idLote;
          indiceLote++;
        }
      }

      if (detallesSalida) {
        movimientoDetalle.detallesSalida = detallesSalida;
      }

      movimientoDetalles.push(movimientoDetalle);
    }

    return movimientoDetalles;
  }
}
