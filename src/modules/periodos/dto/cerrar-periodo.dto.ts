import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para cerrar un período contable
 */
export class CerrarPeriodoDto {
  /**
   * Usuario que cierra el período
   */
  @ApiProperty({
    description: 'Usuario que cierra el período',
    example: 'admin@empresa.com',
  })
  // Lo completa el servidor con el usuario autenticado
  @IsOptional()
  @IsString({ message: 'El usuario debe ser texto' })
  usuarioCierre: string;

  /**
   * Observaciones del cierre
   */
  @ApiProperty({
    description: 'Observaciones del cierre del período',
    example: 'Cierre del período 2024 - Todos los movimientos revisados',
    required: false,
    maxLength: 500,
  })
  @IsOptional()
  @IsString({ message: 'Las observaciones deben ser texto' })
  observacionesCierre?: string;
}
