import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { FindManyOptions, ObjectLiteral, Repository } from 'typeorm';

export const LIMITE_POR_DEFECTO = 50;

/**
 * Paginación opcional de listados. Sin `pagina` ni `limite` el listado se
 * devuelve completo, como antes (compatibilidad con el frontend actual).
 */
export class PaginacionDto {
  @ApiPropertyOptional({
    description:
      'Página, desde 1. Si se envía página o límite, la respuesta es { datos, total, pagina, limite, totalPaginas }',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @ApiPropertyOptional({
    description: `Elementos por página (máximo 200, por defecto ${LIMITE_POR_DEFECTO})`,
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}

export interface Pagina<T> {
  datos: T[];
  total: number;
  pagina: number;
  limite: number;
  totalPaginas: number;
}

/**
 * Lista con `find` o, si se pidió paginación, con `findAndCount` y skip/take.
 * `opciones.order` debe ser determinista (desempatar por id) para que las
 * páginas no repitan ni salten filas.
 */
export async function listar<E extends ObjectLiteral, R>(
  repositorio: Repository<E>,
  opciones: FindManyOptions<E>,
  paginacion: PaginacionDto | undefined,
  mapear: (filas: E[]) => R[],
): Promise<R[] | Pagina<R>> {
  if (paginacion?.pagina === undefined && paginacion?.limite === undefined) {
    return mapear(await repositorio.find(opciones));
  }
  const pagina = paginacion.pagina ?? 1;
  const limite = paginacion.limite ?? LIMITE_POR_DEFECTO;
  const [filas, total] = await repositorio.findAndCount({
    ...opciones,
    skip: (pagina - 1) * limite,
    take: limite,
  });
  return {
    datos: mapear(filas),
    total,
    pagina,
    limite,
    totalPaginas: Math.ceil(total / limite),
  };
}
