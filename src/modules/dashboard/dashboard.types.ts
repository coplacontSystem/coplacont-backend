import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export class InventarioAlQueryDto {
  @ApiProperty({ example: '2026-12-31' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'fecha debe tener el formato YYYY-MM-DD',
  })
  fecha: string;
}

export class DashboardQueryDto {
  @ApiPropertyOptional({
    description: 'Mes del dashboard (YYYY-MM). Por defecto, el mes actual.',
    example: '2026-03',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'periodo debe ser YYYY-MM' })
  periodo?: string;
}

export interface KpiComprobantes {
  /** Base imponible en soles (sin IGV), notas de crédito restadas */
  total: number;
  cantidad: number;
  /** % frente al mes anterior; null si el mes anterior fue 0 */
  variacion: number | null;
}

export interface FilaRanking {
  id: number;
  nombre: string;
  monto: number;
}

export interface Dashboard {
  periodo: {
    mes: string;
    idPeriodoContable: number | null;
    año: number | null;
    cerrado: boolean;
    metodoValoracion: string | null;
    /** Fin del período contable (YYYY-MM-DD) */
    cierre: string | null;
    diasParaCierre: number | null;
    tipoCambio: { fecha: string; compra: number; venta: number } | null;
  };
  kpis: {
    ventas: KpiComprobantes;
    compras: KpiComprobantes;
    costoVentas: number;
    margen: { monto: number; porcentaje: number | null };
    /** saldo > 0: IGV a pagar; < 0: saldo a favor */
    igv: { ventas: number; compras: number; saldo: number };
  };
  /** Últimos 12 meses hasta el mes del dashboard */
  serieMensual: {
    mes: string;
    ventas: number;
    compras: number;
    costoVentas: number;
  }[];
  inventario: {
    valorTotal: number;
    productosConStock: number;
    porAlmacen: { idAlmacen: number; nombre: string; valor: number }[];
  };
  alertas: {
    /** Totales para los badges; las listas traen como máximo 10 */
    totalStockBajo: number;
    totalFaltantes: number;
    stockBajo: {
      idInventario: number;
      producto: string;
      almacen: string;
      stock: number;
      minimo: number;
    }[];
    faltantes: {
      idInventario: number;
      producto: string;
      almacen: string;
      fecha: string;
      cantidad: number;
    }[];
  };
  topProductos: (FilaRanking & { codigo: string; cantidad: number })[];
  topClientes: (FilaRanking & { documento: string; comprobantes: number })[];
  topProveedores: (FilaRanking & { documento: string; comprobantes: number })[];
  ultimosMovimientos: {
    id: number;
    tipo: 'COMPRA' | 'VENTA' | 'TRANSFERENCIA';
    tipoComprobante: string;
    fecha: string;
    serie: string;
    numero: string;
    entidad: string | null;
    total: number;
    moneda: string;
  }[];
}
