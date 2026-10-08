import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  addTransactionalDataSource,
  initializeTransactionalContext,
} from 'typeorm-transactional';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/config/app.config';

/** Levanta la app completa contra la BD de pruebas, igual que main.ts. */
export async function createTestApp(): Promise<INestApplication> {
  initializeTransactionalContext();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  addTransactionalDataSource(app.get(DataSource));
  configureApp(app);
  await app.init();
  return app;
}
