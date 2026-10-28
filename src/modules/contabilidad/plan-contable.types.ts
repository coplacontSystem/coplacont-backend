import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsObject,
} from 'class-validator';
import type { Naturaleza } from './entities/cuenta-contable.entity';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListarCuentasQuery {
  @ApiPropertyOptional({ description: 'Elemento (0–9)', example: '4' })
  @IsOptional()
  @Matches(/^\d$/, { message: 'El elemento es un dígito del 0 al 9' })
  elemento?: string;

  @ApiPropertyOptional({
    description: 'Busca por código o nombre',
    example: 'igv',
  })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({
    description: 'Solo las cuentas que reciben movimientos',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  imputables?: boolean;
}

export class CrearSubcuentaDto {
  @ApiPropertyOptional({
    description:
      'Código de la cuenta padre. Vacío solo para cuentas del elemento 9',
    example: '1041',
  })
  @IsOptional()
  @Matches(/^\d{2,9}$/, { message: 'Código de cuenta padre inválido' })
  codigoPadre?: string;

  @ApiProperty({ example: '104101' })
  @Matches(/^\d{2,10}$/, { message: 'El código solo admite dígitos (2 a 10)' })
  codigo: string;

  @ApiProperty({ example: 'BCP cuenta corriente soles' })
  @Transform(recortar)
  @IsString()
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres' })
  @MaxLength(200)
  nombre: string;

  @ApiPropertyOptional({ enum: ['deudora', 'acreedora', 'mixta'] })
  @IsOptional()
  @IsIn(['deudora', 'acreedora', 'mixta'])
  naturaleza?: Naturaleza;
}

export class ActualizarSubcuentaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres' })
  @MaxLength(200)
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

export class CambiarPlanDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  idPlan: number;

  @ApiPropertyOptional({
    description: 'Desde este período (y los siguientes); sin él, todos',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  idPeriodoDesde?: number;

  @ApiPropertyOptional({
    description: 'Cuenta del plan actual → cuenta del plan nuevo',
    example: { '92': '911' },
  })
  @IsOptional()
  @IsObject()
  reasignar?: Record<string, string>;
}

export interface CuentaVista {
  id: number;
  codigo: string;
  nombre: string;
  nivel: number;
  elemento: string;
  naturaleza: Naturaleza;
  idPadre: number | null;
  codigoPadre: string | null;
  /** true = subcuenta creada por la empresa */
  propia: boolean;
  activa: boolean;
  /** Tiene subcuentas activas (oficiales o propias de la empresa) */
  tieneHijas: boolean;
  /** Recibe movimientos: activa y sin subcuentas activas */
  imputable: boolean;
}

export interface PlanVista {
  id: number;
  codigo: string;
  nombre: string;
  norma: string;
  codigoSunat: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  nota: string | null;
  elementos: Record<string, string>;
  cuentasSugeridas: Record<string, string>;
  areasSugeridas: { nombre: string; cuenta?: string; nombreCuenta?: string }[];
}
