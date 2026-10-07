import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Reglas del período que la empresa puede ajustar desde Parámetros */
export class UpdateConfiguracionDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 12, description: '1 = enero' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  mesInicio?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 90 })
  @IsOptional()
  @IsInt()
  @Min(0, { message: 'Ingresa un número entre 0 y 90' })
  @Max(90, { message: 'Ingresa un número entre 0 y 90' })
  diasLimiteRetroactivo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiereAutorizacionRetroactivo?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  cierreAutomatico?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Ingresa un número entre 1 y 60' })
  @Max(60, { message: 'Ingresa un número entre 1 y 60' })
  diasParaCierreAutomatico?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notificarProximoCierre?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Ingresa un número entre 1 y 30' })
  @Max(30, { message: 'Ingresa un número entre 1 y 30' })
  diasNotificacionCierre?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  permitirMovimientosPeriodoCerrado?: boolean;
}
