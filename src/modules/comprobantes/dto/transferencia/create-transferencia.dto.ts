import { Type } from 'class-transformer';
import {
  IsArray,
  ValidateNested,
  IsDateString,
  IsEnum,
  IsInt,
  Min,
  IsNumber,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { Moneda } from '../../enum/tipo-moneda.enum';
import { TransferenciaDetalleDto } from './transferencia-detalle.dto';

export class CreateTransferenciaDto {
  @IsInt()
  @Min(1)
  idAlmacenOrigen!: number;

  @IsInt()
  @Min(1)
  idAlmacenDestino!: number;

  @IsDateString()
  fechaEmision!: Date;

  @IsEnum(Moneda)
  moneda!: Moneda;

  @IsOptional()
  @IsNumber()
  tipoCambio?: number;

  @IsString()
  @Length(1, 5)
  serie!: string;

  @IsString()
  @Length(1, 20)
  numero!: string;

  @IsOptional()
  @IsDateString()
  fechaVencimiento?: Date;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferenciaDetalleDto)
  detalles!: TransferenciaDetalleDto[];
}
