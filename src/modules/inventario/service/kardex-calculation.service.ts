import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventario } from '../entities/inventario.entity';
import { TipoMovimiento } from '../../movimientos/enum/tipo-movimiento.enum';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';
import { diaDe, LineaValorizada } from '../valoracion/motor-valoracion';
import {
  MovimientoInventario,
  ValoracionService,
} from '../valoracion/valoracion.service';

/**
 * Interfaz para un movimiento de Kardex calculado dinámicamente
 */
export interface KardexMovement {
  fecha: Date;
  tipoOperacion: string | null;
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
 * Kardex de un inventario. La valoración la hace el motor único
 * (`ValoracionService`), el mismo que costea las ventas al registrarlas.
 */
@Injectable()
export class KardexCalculationService {
  constructor(
    @InjectRepository(Inventario)
    private readonly inventarioRepository: Repository<Inventario>,
    private readonly valoracion: ValoracionService,
  ) {}

  /**
   * Genera el Kardex de un inventario entre dos fechas (días completos).
   * El saldo inicial es el saldo valorizado al final del día anterior a `fechaDesde`.
   */
  async generarKardex(
    idInventario: number,
    fechaDesde: Date,
    fechaHasta: Date,
    metodoValoracion: MetodoValoracion,
  ): Promise<KardexResult | null> {
    const inventario = await this.inventarioRepository.findOne({
      where: { id: idInventario },
      relations: ['producto', 'almacen'],
    });
    if (!inventario) {
      return null;
    }

    const valorizado = (
      await this.valoracion.valorizarInventarios(
        [idInventario],
        metodoValoracion,
      )
    ).get(Number(idInventario));
    const movimientos = valorizado?.movimientos ?? [];
    const lineas = valorizado?.resultado.lineas ?? [];

    const desde = diaDe(fechaDesde);
    const hasta = diaDe(fechaHasta);
    let saldoInicial = { cantidad: 0, costoUnitario: 0, valorTotal: 0 };
    let saldoFinal = saldoInicial;
    const movimientosKardex: KardexMovement[] = [];

    lineas.forEach((linea, i) => {
      const dia = diaDe(linea.fecha);
      const saldo = {
        cantidad: linea.saldoCantidad,
        costoUnitario: linea.saldoCostoUnitario,
        valorTotal: linea.saldoValor,
      };
      if (dia < desde) {
        saldoInicial = saldo;
        saldoFinal = saldo;
        return;
      }
      if (dia > hasta) return;
      movimientosKardex.push(
        ...this.filasKardex(
          movimientos[i],
          linea,
          saldoFinal,
          metodoValoracion,
        ),
      );
      saldoFinal = saldo;
    });

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
      saldoInicial,
      movimientos: movimientosKardex,
      stockFinal: saldoFinal.cantidad,
      costoUnitarioFinal: saldoFinal.costoUnitario,
      valorTotalFinal: saldoFinal.valorTotal,
    };
  }

  /**
   * Filas del kardex para una línea valorizada. Con FIFO una salida se muestra
   * en una fila por cada lote consumido; en los demás casos, una sola fila.
   */
  private filasKardex(
    mov: MovimientoInventario,
    linea: LineaValorizada,
    saldoAnterior: { cantidad: number; valorTotal: number },
    metodo: MetodoValoracion,
  ): KardexMovement[] {
    const base = {
      fecha: linea.fecha,
      tipoOperacion: mov.operacion,
      tipoOperacionCodigo: mov.codigoOperacion ?? undefined,
      tipoMovimiento:
        linea.tipo === 'ENTRADA'
          ? TipoMovimiento.ENTRADA
          : TipoMovimiento.SALIDA,
      tipoComprobante: mov.comprobante ?? undefined,
      tipoComprobanteCodigo: mov.codigoComprobante ?? undefined,
      numeroComprobante:
        mov.serie && mov.numero
          ? `${mov.serie}-${mov.numero}`
          : (mov.numeroDocumento ?? undefined),
      idInventario: mov.idInventario,
      idMovimiento: mov.idMovimiento ?? 0,
      idMovimientoDetalle: mov.id > 0 ? mov.id : 0,
    };

    if (
      linea.tipo === 'SALIDA' &&
      metodo === MetodoValoracion.FIFO &&
      linea.consumos.length > 0
    ) {
      let cantidad = saldoAnterior.cantidad;
      let valor = saldoAnterior.valorTotal;
      return linea.consumos.map((c, i) => {
        const costoTotal = c.cantidad * c.costoUnitario;
        const ultima = i === linea.consumos.length - 1;
        cantidad = ultima ? linea.saldoCantidad : cantidad - c.cantidad;
        valor = ultima ? linea.saldoValor : valor - costoTotal;
        return {
          ...base,
          cantidad: c.cantidad,
          costoUnitario: c.costoUnitario,
          costoTotal,
          cantidadSaldo: cantidad,
          costoUnitarioSaldo: cantidad > 0 ? valor / cantidad : 0,
          valorTotalSaldo: valor,
          detallesSalida: [
            {
              idLote: c.idLote,
              cantidad: c.cantidad,
              costoUnitarioDeLote: c.costoUnitario,
              costoTotal,
            },
          ],
        };
      });
    }

    return [
      {
        ...base,
        cantidad: linea.cantidad,
        costoUnitario: linea.costoUnitario,
        costoTotal: linea.costoTotal,
        cantidadSaldo: linea.saldoCantidad,
        costoUnitarioSaldo: linea.saldoCostoUnitario,
        valorTotalSaldo: linea.saldoValor,
      },
    ];
  }
}
