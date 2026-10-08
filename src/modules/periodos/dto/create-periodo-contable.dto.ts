import {
  IsNotEmpty,
  IsNumber,
  IsDateString,
  IsOptional,
  IsString,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para crear un nuevo período contable
 */
export class CreatePeriodoContableDto {
  /**
   * Año del período contable
   */
  @ApiProperty({
    description: 'Año del período contable',
    example: 2024,
    minimum: 2000,
    maximum: 2100,
  })
  @IsNotEmpty({ message: 'El año es requerido' })
  @IsNumber({}, { message: 'El año debe ser un número' })
  @Min(2000, { message: 'El año debe ser mayor a 2000' })
  @Max(2100, { message: 'El año debe ser menor a 2100' })
  año: number;

  /**
   * Fecha de inicio del período (opcional, se calcula automáticamente si no se proporciona)
   */
  @ApiProperty({
    description: 'Fecha de inicio del período',
    example: '2024-01-01',
    required: false,
  })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de inicio debe ser una fecha válida' })
  fechaInicio?: string;

  /**
   * Fecha de fin del período (opcional, se calcula automáticamente si no se proporciona)
   */
  @ApiProperty({
    description: 'Fecha de fin del período',
    example: '2024-12-31',
    required: false,
  })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de fin debe ser una fecha válida' })
  fechaFin?: string;

  /**
   * ID de la persona/empresa
   */
  @ApiProperty({
    description: 'ID de la persona/empresa propietaria del período',
    example: 1,
  })
  @IsOptional()
  @IsNumber({}, { message: 'El ID de la persona debe ser un número' })
  idPersona?: number;

  /** Método con que se valoriza el kardex del período; por defecto, el vigente */
  @ApiProperty({ enum: MetodoValoracion, required: false })
  @IsOptional()
  @IsEnum(MetodoValoracion, { message: 'Método de valoración inválido' })
  metodoValoracion?: MetodoValoracion;

  /**
   * Observaciones del período
   */
  @ApiProperty({
    description: 'Observaciones del período',
    example: 'Período contable 2024',
    required: false,
    maxLength: 500,
  })
  @IsOptional()
  @IsString({ message: 'Las observaciones deben ser texto' })
  observaciones?: string;
}
