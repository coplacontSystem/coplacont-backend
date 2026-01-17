import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber,
  IsPositive,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO para crear un nuevo registro de inventario
 * Contiene las validaciones necesarias para los datos de entrada
 */
export class CreateInventarioDto {
  /**
   * ID del almacén donde se encuentra el producto
   */
  @ApiProperty({
    description: 'ID del almacén',
    example: 1,
  })
  @IsNumber({}, { message: 'El ID del almacén debe ser un número' })
  @IsPositive({ message: 'El ID del almacén debe ser positivo' })
  @Type(() => Number)
  idAlmacen: number;

  /**
   * ID del producto en inventario
   */
  @ApiProperty({
    description: 'ID del producto',
    example: 1,
  })
  @IsNumber({}, { message: 'El ID del producto debe ser un número' })
  @IsPositive({ message: 'El ID del producto debe ser positivo' })
  @Type(() => Number)
  idProducto: number;

  /**
   * Stock inicial opcional para crear un movimiento de entrada
   */
  @ApiProperty({
    description: 'Stock inicial del inventario (opcional)',
    example: 10,
    required: false,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'El stock debe ser numérico' })
  @IsPositive({ message: 'El stock inicial debe ser positivo' })
  @Type(() => Number)
  stockInicial?: number;

  /**
   * Precio unitario asociado al stock inicial (opcional)
   */
  @ApiProperty({
    description: 'Precio unitario del stock inicial (opcional)',
    example: 25.5,
    required: false,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'El precio debe ser numérico' })
  @IsPositive({ message: 'El precio unitario debe ser positivo' })
  @Type(() => Number)
  precioUnitario?: number;

  /**
   * Fecha del lote inicial (opcional)
   * Si no se proporciona, se usa el primer día del periodo contable activo
   */
  @ApiProperty({
    description:
      'Fecha del lote inicial en formato YYYY-MM-DD (opcional). Si no se proporciona, se usa el primer día del periodo contable activo.',
    example: '2026-01-15',
    required: false,
  })
  @IsOptional()
  @IsDateString(
    {},
    {
      message: 'La fecha debe tener formato válido (YYYY-MM-DD)',
    },
  )
  fechaInicial?: string;
}
