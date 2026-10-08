import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Verifica que los recursos referenciados por id pertenezcan a la empresa
 * del usuario autenticado. Si no pertenecen se responde 404 (igual que si no
 * existieran) para no revelar datos de otras empresas.
 */
@Injectable()
export class PertenenciaService {
  constructor(private readonly dataSource: DataSource) {}

  private async verificar(
    sql: string,
    ids: number[],
    personaId: number,
    recurso: string,
  ): Promise<void> {
    const unicos = [...new Set(ids.map(Number))];
    if (unicos.length === 0) return;
    if (unicos.some((id) => !Number.isInteger(id))) {
      throw new NotFoundException(`${recurso} no encontrado`);
    }
    const filas: { id: string }[] = await this.dataSource.query(sql, [
      unicos,
      personaId,
    ]);
    const encontrados = new Set(filas.map((f) => Number(f.id)));
    const faltante = unicos.find((id) => !encontrados.has(id));
    if (faltante !== undefined) {
      throw new NotFoundException(`${recurso} ${faltante} no encontrado`);
    }
  }

  inventarios(ids: number[], personaId: number) {
    return this.verificar(
      `SELECT i.id FROM inventario i
         JOIN almacen a ON a.id = i.id_almacen
        WHERE i.id = ANY($1) AND a.id_persona = $2`,
      ids,
      personaId,
      'Inventario',
    );
  }

  entidades(ids: number[], personaId: number) {
    return this.verificar(
      `SELECT id FROM entidades WHERE id = ANY($1) AND id_persona = $2`,
      ids,
      personaId,
      'Cliente/proveedor',
    );
  }

  comprobantes(ids: number[], personaId: number) {
    return this.verificar(
      `SELECT "idComprobante" AS id FROM comprobante
        WHERE "idComprobante" = ANY($1) AND id_persona = $2`,
      ids,
      personaId,
      'Comprobante',
    );
  }

  movimientos(ids: number[], personaId: number) {
    return this.verificar(
      `SELECT m.id FROM movimientos m
         JOIN comprobante c ON c."idComprobante" = m.id_comprobante
        WHERE m.id = ANY($1) AND c.id_persona = $2`,
      ids,
      personaId,
      'Movimiento',
    );
  }

  lotes(ids: number[], personaId: number) {
    return this.verificar(
      `SELECT l.id FROM inventario_lote l
         JOIN inventario i ON i.id = l.id_inventario
         JOIN almacen a ON a.id = i.id_almacen
        WHERE l.id = ANY($1) AND a.id_persona = $2`,
      ids,
      personaId,
      'Lote',
    );
  }

  almacenes(ids: number[], personaId: number) {
    return this.verificar(
      `SELECT id FROM almacen WHERE id = ANY($1) AND id_persona = $2`,
      ids,
      personaId,
      'Almacén',
    );
  }

  productos(ids: number[], personaId: number) {
    return this.verificar(
      `SELECT id FROM producto WHERE id = ANY($1) AND id_persona = $2`,
      ids,
      personaId,
      'Producto',
    );
  }

  /** Ids de todos los inventarios de la empresa (para filtrar listados). */
  async inventariosDeEmpresa(personaId: number): Promise<Set<number>> {
    const filas: { id: string }[] = await this.dataSource.query(
      `SELECT i.id FROM inventario i
         JOIN almacen a ON a.id = i.id_almacen
        WHERE a.id_persona = $1`,
      [personaId],
    );
    return new Set(filas.map((f) => Number(f.id)));
  }
}
