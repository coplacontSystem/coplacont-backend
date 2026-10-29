import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './config/swagger.config';
import { configureApp, swaggerHabilitado } from './config/app.config';
import {
  addTransactionalDataSource,
  initializeTransactionalContext,
} from 'typeorm-transactional';
import { DataSource } from 'typeorm';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';

let cachedApp: Express | null = null;

async function createApp(): Promise<Express> {
  if (cachedApp) {
    return cachedApp;
  }

  initializeTransactionalContext();

  const expressApp: Express = express();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(expressApp),
  );
  // Foto de perfil, logo y XML importados viajan en base64 dentro del JSON
  app.useBodyParser('json', { limit: '15mb' });

  const dataSource = app.get(DataSource);
  addTransactionalDataSource(dataSource);

  configureApp(app);

  // Detrás del proxy de Render/Vercel: la IP real viene en X-Forwarded-For
  app.set('trust proxy', 1);

  if (swaggerHabilitado()) {
    setupSwagger(app);

    // Redirección automática de / a /api/docs
    app.use('/', (req: Request, res: Response, next: NextFunction) => {
      if (req.url === '/') {
        res.redirect('/api/docs');
        return;
      }
      next();
    });
  }

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
