import * as dotenv from 'dotenv';

dotenv.config();

/**
 * URL de la base de datos de pruebas.
 * Por defecto usa la misma conexión que DATABASE_URL pero con la BD `bd_coplacont_test`.
 * Se puede sobrescribir con TEST_DATABASE_URL.
 */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'Define DATABASE_URL o TEST_DATABASE_URL para correr los tests e2e',
    );
  }
  const url = new URL(base);
  url.pathname = '/bd_coplacont_test';
  return url.toString();
}
