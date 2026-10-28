import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CUENTA = /^\d{2,10}$/;
const msg = { message: 'Código de cuenta inválido' };

export class GenerarAsientosDto {
  @ApiProperty({ example: '2026-05-01' })
  @Matches(FECHA, { message: 'Fecha inválida (AAAA-MM-DD)' })
  desde: string;

  @ApiProperty({ example: '2026-05-31' })
  @Matches(FECHA, { message: 'Fecha inválida (AAAA-MM-DD)' })
  hasta: string;
}

/** Cuentas de los asientos automáticos que la empresa quiere cambiar */
export class CuentasAutomaticasDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CUENTA, msg)
  compraMercaderias?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(CUENTA, msg) igv?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CUENTA, msg)
  proveedores?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(CUENTA, msg) clientes?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CUENTA, msg)
  ventaMercaderias?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CUENTA, msg)
  devolucionVentas?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CUENTA, msg)
  costoVentas?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(CUENTA, msg) almacen?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(CUENTA, msg) variacion?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CUENTA, msg)
  cargasImputables?: string;
}
