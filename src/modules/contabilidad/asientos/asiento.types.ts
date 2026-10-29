import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { EstadoAsiento, OrigenAsiento } from './asiento.entity';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const vacioAUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class LineaAsientoDto {
  @ApiProperty({ example: '6211' })
  @Matches(/^\d{2,10}$/, { message: 'Código de cuenta inválido' })
  codigoCuenta: string;

  @ApiPropertyOptional({ example: 'Sueldo de octubre' })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(250)
  glosa?: string;

  @ApiProperty({ example: 1500 })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El Debe admite hasta 2 decimales' },
  )
  @Min(0)
  @Max(999999999999)
  debe: number;

  @ApiProperty({ example: 0 })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El Haber admite hasta 2 decimales' },
  )
  @Min(0)
  @Max(999999999999)
  haber: number;
}

export class GuardarAsientoDto {
  @ApiProperty({ example: '2026-10-31' })
  @Matches(FECHA, { message: 'La fecha debe tener el formato YYYY-MM-DD' })
  fecha: string;

  @ApiProperty({ example: 'Planilla de remuneraciones de octubre' })
  @Transform(recortar)
  @IsString()
  @MinLength(3, { message: 'La glosa debe tener al menos 3 caracteres' })
  @MaxLength(250)
  glosa: string;

  @ApiPropertyOptional({ example: 'PLAME 10/2026' })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(60)
  referencia?: string;

  @ApiProperty({ type: [LineaAsientoDto] })
  @IsArray()
  @ArrayMinSize(2, { message: 'El asiento necesita al menos 2 líneas' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineaAsientoDto)
  lineas: LineaAsientoDto[];
}

export class AnularAsientoDto {
  @ApiProperty({
    example: 'Registrado por error, se reemplaza por el asiento 15',
  })
  @Transform(recortar)
  @IsString()
  @MinLength(5, { message: 'Indica el motivo (al menos 5 caracteres)' })
  @MaxLength(250)
  motivo: string;
}

export class ListarAsientosQuery {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Transform(vacioAUndefined)
  @Matches(FECHA, { message: 'desde debe tener el formato YYYY-MM-DD' })
  desde?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Transform(vacioAUndefined)
  @Matches(FECHA, { message: 'hasta debe tener el formato YYYY-MM-DD' })
  hasta?: string;

  @ApiPropertyOptional({ description: 'Busca en glosa, referencia o número' })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ enum: ['registrado', 'anulado'] })
  @IsOptional()
  @Transform(vacioAUndefined)
  @IsIn(['registrado', 'anulado'])
  estado?: EstadoAsiento;

  @ApiPropertyOptional({ enum: ['manual', 'compra', 'venta'] })
  @IsOptional()
  @Transform(vacioAUndefined)
  @IsIn(['manual', 'compra', 'venta'])
  origen?: OrigenAsiento;

  @ApiPropertyOptional({
    description: 'Solo asientos que usan esta cuenta (o sus subcuentas)',
  })
  @IsOptional()
  @Transform(vacioAUndefined)
  @Matches(/^\d{2,10}$/, { message: 'Código de cuenta inválido' })
  cuenta?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}

export interface LineaVista {
  orden: number;
  idCuenta: number;
  codigoCuenta: string;
  nombreCuenta: string;
  glosa: string | null;
  debe: number;
  haber: number;
}

export interface AsientoVista {
  id: number;
  numero: number;
  periodo: { id: number; año: number; cerrado: boolean };
  fecha: string;
  glosa: string;
  referencia: string | null;
  origen: OrigenAsiento;
  estado: EstadoAsiento;
  totalDebe: number;
  totalHaber: number;
  cantidadLineas: number;
  creadoPor: string;
  fechaCreacion: string;
  modificadoPor: string | null;
  fechaActualizacion: string;
  anulacion: { fecha: string; por: string; motivo: string } | null;
  /** Solo los manuales registrados en un periodo abierto se editan o anulan */
  editable: boolean;
  lineas?: LineaVista[];
}
