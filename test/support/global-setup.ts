import { Client } from 'pg';
import { testDatabaseUrl } from './test-db';

/**
 * Recrea la BD de pruebas desde cero antes de cada corrida.
 * El esquema lo crea TypeORM (synchronize) y los catálogos el seed de la app.
 */
export default async function globalSetup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const dbName = url.pathname.replace('/', '');
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Por seguridad, la BD de pruebas debe contener "test" en su nombre (${dbName})`,
    );
  }

  const admin = new URL(url.toString());
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();
}
