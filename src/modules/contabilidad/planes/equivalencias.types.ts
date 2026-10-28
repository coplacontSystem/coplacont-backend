import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class ParPlanesDto {
  @ApiProperty({ example: 'PCGE2019' })
  @Matches(/^[A-Z0-9_-]{2,20}$/i)
  origen: string;

  @ApiProperty({ example: 'PCGE2026' })
  @Matches(/^[A-Z0-9_-]{2,20}$/i)
  destino: string;
}

export class RevisarEquivalenciaDto {
  @ApiPropertyOptional({
    example: '70911',
    nullable: true,
    description: 'null = sin equivalente',
  })
  @ValidateIf((o: { codigoDestino?: string | null }) => o.codigoDestino != null)
  @Matches(/^\d{2,6}$/, { message: 'Código de cuenta inválido' })
  codigoDestino?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  nota?: string;
}
