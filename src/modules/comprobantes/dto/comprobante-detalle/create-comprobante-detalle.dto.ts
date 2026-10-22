import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  IsPositive,
  IsIn,
  IsInt,
  Matches,
} from 'class-validator';

export class CreateComprobanteDetalleDto {
  @ApiPropertyOptional({
    description:
      'producto (mueve inventario, por defecto) o servicio (gasto/ingreso sin inventario)',
    enum: ['producto', 'servicio'],
    default: 'producto',
  })
  @IsOptional()
  @IsIn(['producto', 'servicio'])
  tipoLinea?: 'producto' | 'servicio';

  @ApiPropertyOptional({
    description: 'ID del inventario (obligatorio en líneas de producto)',
    example: 123,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  idInventario?: number;

  @ApiPropertyOptional({
    description:
      'Cuenta de gasto o ingreso (obligatoria en líneas de servicio)',
    example: '6361',
  })
  @IsOptional()
  @Matches(/^\d{2,10}$/, { message: 'Código de cuenta inválido' })
  codigoCuenta?: string;

  @ApiPropertyOptional({
    description: 'Área o centro de costo de la línea (para el destino)',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  idArea?: number;

  @ApiProperty({
    description: 'Cantidad del producto o servicio',
    example: 10.5,
  })
  @IsNumber()
  @IsNotEmpty()
  @IsPositive()
  cantidad: number;

  @ApiProperty({
    description: 'Unidad de medida',
    example: 'KG',
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 10)
  unidadMedida: string;

  @ApiProperty({
    description: 'Precio unitario',
    example: 25.5,
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  precioUnitario: number;

  @ApiProperty({
    description: 'Subtotal del detalle',
    example: 267.75,
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  subtotal: number;

  @ApiProperty({
    description: 'IGV aplicado',
    example: 48.2,
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  igv: number;

  @ApiProperty({
    description: 'ISC aplicado',
    example: 0,
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  isc: number;

  @ApiProperty({
    description: 'Total del detalle',
    example: 315.95,
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  total: number;

  @ApiPropertyOptional({
    description: 'Descripción del producto o servicio',
    example: 'Caja de manzanas verdes',
  })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  descripcion?: string;

  @ApiPropertyOptional({
    description:
      'ID del lote específico para ventas (opcional, si no se especifica usa FIFO)',
    example: 123,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  loteId?: number;
}
