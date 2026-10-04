import { EntityManager } from 'typeorm';

/** Espacio de nombres de los advisory locks de inventario. */
const LOCK_INVENTARIO = 7301;

/**
 * Bloquea los inventarios hasta el fin de la transacción. Dos registros (o
 * recálculos del kardex) que tocan el mismo inventario se serializan.
 * Se bloquean en orden para no generar deadlocks. Es reentrante.
 */
export async function bloquearInventarios(
  manager: EntityManager,
  ids: number[],
): Promise<void> {
  const ordenados = [...new Set(ids.map(Number))].sort((a, b) => a - b);
  for (const id of ordenados) {
    await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
      LOCK_INVENTARIO,
      id,
    ]);
  }
}
