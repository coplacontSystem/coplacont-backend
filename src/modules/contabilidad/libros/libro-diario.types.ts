import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class PeriodoLibroDto {
  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  año: number;

  @ApiProperty({ example: 5, description: 'Mes (1 a 12)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mes: number;
}
