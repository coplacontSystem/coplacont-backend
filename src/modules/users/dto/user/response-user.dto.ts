import { Expose, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class PersonaResponseDto {
  @Expose()
  @ApiProperty({ description: 'ID de la empresa' })
  id: number;

  @Expose()
  @ApiProperty({ description: 'Nombre de la empresa' })
  nombreEmpresa: string;

  @Expose()
  @ApiProperty({ description: 'RUC de la empresa' })
  ruc: string;

  @Expose()
  @ApiProperty({ description: 'Razón social de la empresa' })
  razonSocial: string;

  @Expose()
  @ApiProperty({ description: 'Teléfono de la empresa' })
  telefono: string;

  @Expose()
  @ApiProperty({ description: 'Dirección de la empresa', required: false })
  direccion?: string;
}

export class ResponseUserDto {
  @Expose()
  @ApiProperty({ description: 'ID del usuario' })
  id: number;

  @Expose()
  @ApiProperty({ description: 'Nombre del usuario' })
  nombre: string;

  @Expose()
  @ApiProperty({ description: 'Email del usuario' })
  email: string;

  @Expose()
  @ApiProperty({
    description: 'Indica si es usuario principal de la empresa',
    required: false,
  })
  esPrincipal?: boolean;

  @Expose()
  @Type(() => PersonaResponseDto)
  @ApiProperty({
    description: 'Datos de la empresa asociada',
    type: PersonaResponseDto,
    required: false,
  })
  persona?: PersonaResponseDto;

  @Expose()
  @ApiProperty({ description: 'Roles del usuario', type: [String] })
  roles?: string[];
}
