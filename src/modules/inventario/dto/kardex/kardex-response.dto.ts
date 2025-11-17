import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

/**
 * DTO para los detalles de salida en el reporte Kardex
 */
export class KardexDetalleSalidaDto {
  @ApiProperty({
    description: 'ID del detalle de salida',
    example: 1,
  })
  @Expose()
  id: number;

  @ApiProperty({
    description: 'ID del lote utilizado',
    example: 5,
  })
  @Expose()
  idLote: number;

  @ApiProperty({
    description: 'Costo unitario específico del lote',
    example: 25.5,
  })
  @Expose()
  costoUnitarioDeLote: number;

  @ApiProperty({
    description: 'Cantidad utilizada del lote',
    example: 10.5,
  })
  @Expose()
  cantidad: number;
}

export class KardexReportMovementDto {
  /**
   * Fecha del movimiento
   */
  @ApiProperty({
    description: 'Fecha del movimiento',
    example: '15 - 10 - 2025',
  })
  @Expose()
  fecha: string;

  /**
   * Tipo de movimiento (Entrada/Salida)
   */
  @ApiProperty({
    description: 'Tipo de movimiento',
    example: 'Entrada',
  })
  @Expose()
  tipo: string;

  /**
   * Tipo de comprobante
   */
  @ApiProperty({
    description: 'Código del tipo de comprobante',
    example: '01',
  })
  @Expose()
  tComprob: string;

  /**
   * Tipo de operación
   */
  @ApiProperty({
    description: 'Código del tipo de operación',
    example: '02',
  })
  @Expose()
  tOperacion: string;

  /**
   * Número de comprobante
   */
  @ApiProperty({
    description: 'Número de comprobante',
    example: 'F001-00012345',
  })
  @Expose()
  nComprobante: string;

  /**
   * Cantidad del movimiento
   */
  @ApiProperty({
    description: 'Cantidad del movimiento',
    example: 10,
  })
  @Expose()
  cantidad: number;

  /**
   * Saldo acumulado después del movimiento
   */
  @ApiProperty({
    description: 'Saldo acumulado',
    example: 100,
  })
  @Expose()
  saldo: number;

  /**
   * Costo unitario
   */
  @ApiProperty({
    description: 'Costo unitario',
    example: 100,
  })
  @Expose()
  costoUnitario: number;

  /**
   * Costo total
   */
  @ApiProperty({
    description: 'Costo total',
    example: 1000,
  })
  @Expose()
  costoTotal: number;

  /**
   * Detalles de salida (solo para movimientos de tipo SALIDA)
   */
  @ApiProperty({
    description: 'Detalles de salida con información de lotes utilizados',
    type: [KardexDetalleSalidaDto],
    required: false,
  })
  @Expose()
  @Type(() => KardexDetalleSalidaDto)
  detallesSalida?: KardexDetalleSalidaDto[];
}

export class KardexResponseDto {
  /**
   * Información del producto
   */
  @ApiProperty({
    description: 'Nombre del producto',
    example: 'Producto A',
  })
  @Expose()
  producto: string;

  /**
   * Información del almacén
   */
  @ApiProperty({
    description: 'Nombre del almacén',
    example: 'Almacén Principal',
  })
  @Expose()
  almacen: string;

  /**
   * Cantidad inicial del inventario
   */
  @ApiProperty({
    description: 'Cantidad inicial del inventario al inicio del período',
    example: '50.0000',
  })
  @Expose()
  inventarioInicialCantidad: string;

  /**
   * Costo total inicial del inventario
   */
  @ApiProperty({
    description: 'Costo total inicial del inventario al inicio del período',
    example: '1250.50000000',
  })
  @Expose()
  inventarioInicialCostoTotal: string;

  /**
   * Lista de movimientos del kardex
   */
  @ApiProperty({
    description: 'Lista de movimientos del kardex',
    type: [KardexReportMovementDto],
  })
  @Expose()
  movimientos: KardexReportMovementDto[];

  /**
   * Resumen final
   */
  @ApiProperty({
    description: 'Cantidad actual',
    example: 'XXXXXX',
  })
  @Expose()
  cantidadActual: string;

  /**
   * Saldo actual
   */
  @ApiProperty({
    description: 'Saldo actual',
    example: 'XXXXXX',
  })
  @Expose()
  saldoActual: string;

  /**
   * Costo final
   */
  @ApiProperty({
    description: 'Costo final',
    example: 'XXXXXX',
  })
  @Expose()
  costoFinal: string;
}
