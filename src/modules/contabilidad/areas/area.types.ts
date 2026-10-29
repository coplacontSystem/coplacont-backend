import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const vacioANull = ({ value }: { value: unknown }) =>
  value === '' ? null : value;

export class GuardarAreaDto {
  @ApiProperty({ example: 'Administración' })
  @Transform(recortar)
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(60)
  nombre: string;

  @ApiPropertyOptional({
    example: '94',
    description: 'Cuenta de destino (clase 9)',
  })
  @IsOptional()
  @Transform(vacioANull)
  @Matches(/^9\d{1,9}$/, {
    message: 'La cuenta de destino debe ser de la clase 9 (90–99…)',
  })
  cuentaDestino?: string | null;
}

export class ActualizarAreaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nombre?: string;

  @ApiPropertyOptional({ example: '94' })
  @IsOptional()
  @Transform(vacioANull)
  @Matches(/^9\d{1,9}$/, {
    message: 'La cuenta de destino debe ser de la clase 9 (90–99…)',
  })
  cuentaDestino?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

export interface AreaVista {
  id: number;
  nombre: string;
  cuentaDestino: string | null;
  nombreCuentaDestino: string | null;
  activa: boolean;
}
