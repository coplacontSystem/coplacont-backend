import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './config/swagger.config';
import {
  addTransactionalDataSource,
  initializeTransactionalContext,
} from 'typeorm-transactional';
import { DataSource } from 'typeorm';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';

let cachedApp: Express | null = null;

async function createApp(): Promise<Express> {
  if (cachedApp) {
    return cachedApp;
  }

  initializeTransactionalContext();

  const expressApp: Express = express();
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
  );

  const dataSource = app.get(DataSource);
  addTransactionalDataSource(dataSource);

  // Habilitar CORS
  app.enableCors({
    origin: true, // Permitir todos los orígenes
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], // Métodos HTTP permitidos
    allowedHeaders: ['Content-Type', 'Authorization'], // Headers permitidos
    credentials: true, // Permitir cookies y credenciales
  });

  // Configurar Swagger
  setupSwagger(app);

  // Redirección automática de / a /api/docs
  app.use('/', (req: Request, res: Response, next: NextFunction) => {
    if (req.url === '/') {
      res.redirect('/api/docs');
      return;
    }
    next();
  });

  await app.init();
  cachedApp = expressApp;
  return expressApp;
}

// Para desarrollo local
async function bootstrap(): Promise<void> {
  const app = await createApp();
  const port = process.env.PORT ?? 3000;
  app.listen(port, () => {
    console.log(`Application is running on port ${port}`);
  });
}

// Para Vercel
export default async (req: Request, res: Response): Promise<void> => {
  const app = await createApp();
  app(req, res);
};

const isServerless = !!process.env.VERCEL;
if (!isServerless) {
  void bootstrap();
}
