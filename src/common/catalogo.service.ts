import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Códigos SUNAT usados por el sistema (Tabla 12: tipos de operación, Tabla 10: comprobantes). */
export const OPERACION = {
  VENTA: '01',
  COMPRA: '02',
  TRANSFERENCIA_INGRESO: '100',
  TRANSFERENCIA_SALIDA: '101',
} as const;

export const COMPROBANTE = {
  NOTA_CREDITO: '07',
  NOTA_DEBITO: '08',
  DOCUMENTO_INTERNO: '100',
} as const;

/**
 * Resuelve ids de `tabla_detalle` a partir de (número de tabla, código).
 * Los ids dependen del orden en que se sembró el catálogo; los códigos no.
 */
@Injectable()
export class CatalogoService {
  private readonly cache = new Map<string, number>();

  constructor(private readonly dataSource: DataSource) {}

  async id(numeroTabla: '10' | '12', codigo: string): Promise<number> {
    const clave = `${numeroTabla}:${codigo}`;
    const enCache = this.cache.get(clave);
    if (enCache !== undefined) return enCache;

    const [fila]: { id: number }[] = await this.dataSource.query(
      `SELECT d."idTablaDetalle" AS id
         FROM tabla_detalle d
         JOIN tabla t ON t."idTabla" = d.id_tabla
        WHERE t."numeroTabla" = $1 AND d.codigo = $2`,
      [numeroTabla, codigo],
    );
    if (!fila) {
      throw new InternalServerErrorException(
        `Falta el código ${codigo} en la tabla ${numeroTabla} del catálogo`,
      );
    }
    this.cache.set(clave, Number(fila.id));
    return Number(fila.id);
  }

  operacion(codigo: string): Promise<number> {
    return this.id('12', codigo);
  }

  comprobante(codigo: string): Promise<number> {
    return this.id('10', codigo);
  }
}
