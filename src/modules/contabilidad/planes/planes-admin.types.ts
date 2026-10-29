import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ArchivoPlanDto {
  @ApiProperty({ example: 'pcge-2030.xlsx' })
  @IsString()
  @MaxLength(255)
  nombre: string;

  @ApiProperty({ description: 'Contenido en base64 (.xlsx, .csv o .json)' })
  @IsString()
  @MinLength(1)
  contenido: string;
}

/** Importar un plan nuevo o una actualización de uno existente */
export class ImportarPlanDto {
  @ApiProperty({ enum: ['nuevo', 'actualizar'] })
  @IsIn(['nuevo', 'actualizar'])
  modo: 'nuevo' | 'actualizar';

  @ApiProperty({ example: 'PCGE2030' })
  @Matches(/^[A-Z0-9_-]{2,20}$/i, {
    message: 'Código del plan: 2 a 20 letras o números',
  })
  codigo: string;

  @ApiPropertyOptional({ example: 'Plan Contable General Empresarial 2030' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @ApiPropertyOptional({ example: 'Resolución N° 001-2030-EF/30' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  norma?: string;

  @ApiPropertyOptional({ example: '01', description: 'Tabla 17 de SUNAT' })
  @IsOptional()
  @Matches(/^\d{2}$/)
  codigoSunat?: string;

  @ApiPropertyOptional({ example: '2030-01-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  vigenteDesde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  nota?: string;

  @ApiPropertyOptional({
    description: 'Cuenta sugerida por rol de los asientos automáticos',
  })
  @IsOptional()
  @IsObject()
  cuentasSugeridas?: Record<string, string>;

  @ApiProperty({ type: ArchivoPlanDto })
  @ValidateNested()
  @Type(() => ArchivoPlanDto)
  archivo: ArchivoPlanDto;
}
