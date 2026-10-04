import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsDateString,
  IsOptional,
  IsNumber,
  ValidateNested,
  Length,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Moneda } from '../../enum/tipo-moneda.enum';
import { MetodoValoracion } from '../../enum/metodo-valoracion.enum';
import { CreateComprobanteDetalleDto } from '../comprobante-detalle/create-comprobante-detalle.dto';

export class CreateComprobanteDto {
  @ApiProperty({
    description: 'Referencia a la persona (id)',
    example: 1,
  })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  idPersona: number;

  @ApiProperty({
    description: 'ID del tipo de operación (referencia a tabla_detalle)',
    example: 1,
  })
  @IsNotEmpty()
  @IsNumber()
  idTipoOperacion: number;

  @ApiProperty({
    description: 'ID del tipo de comprobante (referencia a tabla_detalle)',
    example: 2,
  })
  @IsNotEmpty()
  @IsNumber()
  idTipoComprobante: number;

  @ApiProperty({
    description: 'Fecha de emisión del comprobante',
    example: '2025-08-10',
  })
  @IsDateString()
  @IsNotEmpty()
  fechaEmision: Date;

  @ApiProperty({ enum: Moneda })
  @IsEnum(Moneda)
  @IsNotEmpty()
  moneda: Moneda;

  @ApiPropertyOptional({
    description: 'Tipo de cambio aplicado',
    example: 3.75,
  })
  @IsOptional()
  @IsNumber()
  tipoCambio?: number;

  @ApiPropertyOptional({
    description: 'Serie del comprobante',
    example: 'F001',
  })
  @IsString()
  @Length(0, 5)
  serie?: string;

  @ApiPropertyOptional({
    description: 'Número del comprobante',
    example: '1234567890',
  })
  @IsString()
  @Length(0, 20)
  numero?: string;

  @ApiPropertyOptional({
    description: 'Fecha de vencimiento',
    example: '2025-08-20',
  })
  @IsOptional()
  @IsDateString()
  fechaVencimiento?: Date;

  @ApiPropertyOptional({
    description: 'Detalles del comprobante',
    type: [CreateComprobanteDetalleDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateComprobanteDetalleDto)
  detalles?: CreateComprobanteDetalleDto[];

  @ApiPropertyOptional({
    description: 'Método de valoración de inventario',
    enum: MetodoValoracion,
    example: MetodoValoracion.FIFO,
  })
  @IsOptional()
  @IsEnum(MetodoValoracion)
  metodoValoracion?: MetodoValoracion;

  /**
   * Total general del comprobante cuando no existen detalles.
   * Para ventas/compras con detalles, este campo será ignorado y los totales
   * se calcularán a partir de los detalles registrados.
   */
  @ApiPropertyOptional({
    description:
      'Total general del comprobante (usado cuando no hay detalles).',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  total?: number;

  @ApiPropertyOptional({
    description:
      'ID del comprobante afecto (solo para notas de crédito/débito)',
    example: 123,
  })
  @IsOptional()
  @IsNumber()
  idComprobanteAfecto?: number;
}
