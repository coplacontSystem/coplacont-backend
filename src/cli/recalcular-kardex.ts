/**
 * Recalcula el kardex materializado desde cero y reporta inconsistencias.
 *
 *   npm run kardex:recalcular                  # todas las empresas
 *   npm run kardex:recalcular -- --empresa 12  # una empresa (id de persona)
 *   npm run kardex:recalcular -- --verificar   # solo compara, no recalcula
 *
 * No hace falta correrlo para desplegar: un inventario sin kardex guardado se
 * calcula solo la primera vez que se lee. Sirve para la carga inicial controlada
 * y para auditar (salidas sin stock en datos antiguos, diferencias).
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import {
  addTransactionalDataSource,
  initializeTransactionalContext,
} from 'typeorm-transactional';
import { AppModule } from '../app.module';
import { KardexMaterializadoService } from '../modules/inventario/valoracion/kardex-materializado.service';

const TANDA = 100;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const i = args.indexOf('--empresa');
  const empresa = i >= 0 ? Number(args[i + 1]) : null;
  const soloVerificar = args.includes('--verificar');

  initializeTransactionalContext();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  addTransactionalDataSource(app.get(DataSource));
  const ds = app.get(DataSource);
  const kardex = app.get(KardexMaterializadoService);

  const filas: { id: string }[] = await ds.query(
    `SELECT i.id FROM inventario i JOIN almacen a ON a.id = i.id_almacen
      WHERE $1::int IS NULL OR a.id_persona = $1 ORDER BY i.id`,
    [empresa],
  );
  const ids = filas.map((f) => Number(f.id));
  console.log(`Inventarios: ${ids.length}`);

  const inicio = Date.now();
  const diferencias: Awaited<ReturnType<typeof kardex.verificar>> = [];
  const faltantes: Awaited<ReturnType<typeof kardex.faltantes>> = [];
  for (let k = 0; k < ids.length; k += TANDA) {
    const tanda = ids.slice(k, k + TANDA);
    if (!soloVerificar) {
      await kardex.marcarPendiente(tanda);
      await kardex.asegurarAlDia(tanda);
    }
    diferencias.push(...(await kardex.verificar(tanda)));
    faltantes.push(...(await kardex.faltantes(tanda)));
    console.log(`  ${Math.min(k + TANDA, ids.length)}/${ids.length}`);
  }
  console.log(`Listo en ${((Date.now() - inicio) / 1000).toFixed(1)} s`);

  console.log(`\nDiferencias con el cálculo desde cero: ${diferencias.length}`);
  for (const d of diferencias)
    console.log(`  inventario ${d.idInventario}: ${d.detalle}`);

  console.log(
    `\nSalidas sin stock suficiente (datos a revisar): ${faltantes.length}`,
  );
  for (const f of faltantes) {
    console.log(
      `  inventario ${f.idInventario}, ${f.dia}: faltaron ${f.faltante}`,
    );
  }

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
