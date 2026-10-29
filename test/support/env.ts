import { testDatabaseUrl } from './test-db';

// Los tests e2e nunca deben tocar la BD de desarrollo.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
// Ni Decolecta ni el tipo de cambio se consultan de verdad en las pruebas
process.env.SUNAT_API_TOKEN = '';
process.env.DECOLECTA_URL = 'http://127.0.0.1:9';
