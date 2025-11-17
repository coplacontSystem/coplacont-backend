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
   * Crea un movimiento desde un comprobante
   * Utiliza el método de costeo promedio ponderado para calcular los costos en ventas
   * Para compras usa el precio unitario original del comprobante
   */
  createMovimientoFromComprobante(
    comprobante: Comprobante,
    costosUnitarios: number[],
    precioYcantidadPorLote: {
      idLote: number;
      costoUnitarioDeLote: number;
      cantidad: number;
    }[],
  ): CreateMovimientoDto {
    const tipoMovimiento = this.generateTipoFromComprobante(comprobante);
    const modoOperacion =
      tipoMovimiento === TipoMovimiento.ENTRADA ? 'COMPRA' : 'VENTA';
    const detalles = this.createMovimientosDetallesFromDetallesComprobante(
      comprobante.detalles,
      modoOperacion,
      costosUnitarios,
      precioYcantidadPorLote,
    );

    const em = new Date(comprobante.fechaEmision as any);
    const now = new Date();
    const movementDate = new Date(
      Date.UTC(
        em.getUTCFullYear(),
        em.getUTCMonth(),
        em.getUTCDate(),
        now.getUTCHours(),
        now.getUTCMinutes(),
        now.getUTCSeconds(),
        now.getUTCMilliseconds(),
      ),
    );

    return {
      numeroDocumento: comprobante.serie + '-' + comprobante.numero,
      tipo: tipoMovimiento,
      fecha: movementDate,
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
        let cantidadRestante = detalle.cantidad;

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

  private generateTipoFromComprobante(
    comprobante: Comprobante,
  ): TipoMovimiento {
    const desc = (comprobante.tipoOperacion?.descripcion || '')
      .trim()
      .toUpperCase();
    const cod = (comprobante.tipoOperacion?.codigo || '').trim();
    if (
      desc === 'COMPRA' ||
      cod === '02' ||
      desc.includes('ENTRADA') ||
      desc.includes('INGRESO')
    )
      return TipoMovimiento.ENTRADA;
    if (
      desc === 'VENTA' ||
      cod === '01' ||
      desc.includes('SALIDA') ||
      desc.includes('EGRESO')
    )
      return TipoMovimiento.SALIDA;

    if (
      cod === '07' ||
      desc.includes('NOTA DE CRÉDITO') ||
      desc.includes('NOTA DE CREDITO')
    ) {
      const afectoCod = comprobante.comprobanteAfecto?.tipoOperacion?.codigo;
      if (afectoCod === '01') return TipoMovimiento.ENTRADA; // NC sobre venta: entrada
      if (afectoCod === '02') return TipoMovimiento.SALIDA; // NC sobre compra: salida
    }
    if (
      cod === '08' ||
      desc.includes('NOTA DE DÉBITO') ||
      desc.includes('NOTA DE DEBITO')
    ) {
      const afectoCod = comprobante.comprobanteAfecto?.tipoOperacion?.codigo;
      if (afectoCod === '01') return TipoMovimiento.SALIDA; // ND sobre venta: salida
      if (afectoCod === '02') return TipoMovimiento.ENTRADA; // ND sobre compra: entrada
    }
    throw new Error(
      `Tipo de operación no soportado: ${comprobante.tipoOperacion?.descripcion}`,
    );
  }
}
