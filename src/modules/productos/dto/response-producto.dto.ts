import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { ResponseCategoriaDto } from 'src/modules/categoria/dto';
import { TipoProducto } from '../enum/tipo-producto.enum';

/**
 * DTO de respuesta para producto
 * Define la estructura de datos que se devuelve al cliente
 */
export class ResponseProductoDto {
  /**
   * ID único del producto
   */
  @ApiProperty({
    description: 'ID único del producto',
    example: 1,
  })
  @Expose()
  id: number;

  /**
   * Nombre del producto
   */
  @ApiProperty({
    description: 'Nombre del producto',
    example: 'Laptop HP Pavilion',
    required: false,
  })
  @Expose()
  nombre?: string;

  /**
   * Tipo del ítem (producto o servicio)
   */
  @ApiProperty({
    description: 'Tipo del ítem',
    enum: TipoProducto,
    example: TipoProducto.PRODUCTO,
  })
  @Expose()
  tipo: TipoProducto;

  /**
   * Descripción del producto
   */
  @ApiProperty({
    description: 'Descripción del producto',
    example: 'Laptop HP Pavilion 15.6"',
  })
  @Expose()
  descripcion: string;

  /**
   * Unidad de medida del producto
   */
  @ApiProperty({
    description: 'Unidad de medida del producto',
    example: 'unidad',
  })
  @Expose()
  unidadMedida: string;

  /**
   * Código único del producto
   */
  @ApiProperty({
    description: 'Código único del producto',
    example: 'PROD-001',
    required: false,
  })
  @Expose()
  codigo?: string;

  /**
   * Precio unitario del producto
   */
  @ApiProperty({
    description: 'Precio unitario del producto',
    example: 899.99,
    required: false,
  })
  @Expose()
  precio?: number;

  /**
   * Stock mínimo requerido
   */
  @ApiProperty({
    description: 'Stock mínimo requerido',
    example: 10,
    required: false,
  })
  @Expose()
  stockMinimo?: number;

  /**
   * Estado del producto
   */
  @ApiProperty({
    description: 'Estado del producto',
    example: true,
  })
  @Expose()
  estado: boolean;

  @ApiProperty({
    description: 'Código de producto SUNAT (CCNU)',
    nullable: true,
  })
  @Expose()
  codigoSunat: string | null;

  @ApiProperty({ description: 'Tipo de existencia (Tabla 5)', nullable: true })
  @Expose()
  tipoExistencia: string | null;

  @ApiProperty({
    description: 'Unidad de medida SUNAT (Tabla 6)',
    nullable: true,
  })
  @Expose()
  codigoUnidad: string | null;

  /**
   * Categoría del producto
   */
  @ApiProperty({
    description: 'Categoría del producto',
    type: ResponseCategoriaDto,
  })
  @Expose()
  @Type(() => ResponseCategoriaDto)
  categoria: ResponseCategoriaDto;

  /**
   * Fecha de creación
   */
  @ApiProperty({
    description: 'Fecha de creación del producto',
    example: '2024-01-15T10:30:00.000Z',
  })
  @Expose()
  fechaCreacion: Date;

  /**
   * Fecha de última actualización
   */
  @ApiProperty({
    description: 'Fecha de última actualización',
    example: '2024-01-15T10:30:00.000Z',
  })
  @Expose()
  fechaActualizacion: Date;
}
