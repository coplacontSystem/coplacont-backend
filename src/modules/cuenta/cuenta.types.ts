import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Imagen JPG o PNG en base64, de hasta 2 MB */
export const IMAGEN_DATA_URL =
  /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
export const IMAGEN_MAX_LARGO = Math.ceil((2 * 1024 * 1024 * 4) / 3) + 32;

export class ActualizarPerfilDto {
  @ApiPropertyOptional({ example: 'María Rojas Quispe' })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(120)
  nombre?: string;

  @ApiPropertyOptional({ example: '987 654 321' })
  @IsOptional()
  @Transform(recortar)
  @Matches(/^$|^(\+?51)?[\d\s()-]{7,15}$/, {
    message: 'Ingresa un teléfono válido',
  })
  telefono?: string;

  @ApiPropertyOptional({ example: 'Contadora general' })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(40, { message: 'El cargo admite máximo 40 caracteres' })
  cargo?: string;
}

export class CambiarCorreoDto {
  @ApiProperty({ example: 'nuevo@empresa.pe' })
  @Transform(recortar)
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Ingresa tu contraseña actual' })
  contrasenaActual: string;
}

export class CambiarContrasenaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Ingresa tu contraseña actual' })
  actual: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(72)
  nueva: string;
}

export class ImagenDto {
  @ApiProperty({ description: 'data:image/png|jpeg;base64,...' })
  @IsString()
  @MaxLength(IMAGEN_MAX_LARGO, { message: 'La imagen supera los 2 MB' })
  @Matches(IMAGEN_DATA_URL, { message: 'Sube una imagen JPG o PNG' })
  imagen: string;
}

export class ActualizarEmpresaDto {
  @ApiPropertyOptional({ example: 'Comercial Andina S.A.C.' })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'La razón social es obligatoria' })
  @MaxLength(200)
  razonSocial?: string;

  @ApiPropertyOptional({ example: 'Andina Mayorista' })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(200)
  nombreComercial?: string;

  @ApiPropertyOptional({ example: 'Av. Nicolás Ayllón 2850, Ate, Lima' })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'La dirección fiscal es obligatoria' })
  @MaxLength(250)
  direccion?: string;

  @ApiPropertyOptional({ example: '(01) 345 6789' })
  @IsOptional()
  @Transform(recortar)
  @Matches(/^$|^(\+?51)?[\d\s()-]{7,15}$/, {
    message: 'Ingresa un teléfono válido',
  })
  telefono?: string;
}

export interface Perfil {
  id: number;
  nombre: string;
  email: string;
  telefono: string | null;
  cargo: string | null;
  avatar: string | null;
  ultimoLogin: string | null;
  ultimoAgente: string | null;
  contrasenaActualizada: string | null;
}

export interface Empresa {
  id: number;
  razonSocial: string;
  nombreComercial: string;
  ruc: string;
  direccion: string | null;
  telefono: string | null;
  logo: string | null;
}
