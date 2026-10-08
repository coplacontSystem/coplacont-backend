import { testDatabaseUrl } from './test-db';

// Los tests e2e nunca deben tocar la BD de desarrollo.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
