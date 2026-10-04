import type { INestApplication } from '@nestjs/common';

/**
 * Configuración global de la aplicación.
 * Se usa desde main.ts y desde los tests e2e para que ambos levanten la app igual.
 */
export function configureApp(app: INestApplication): void {
  app.enableCors({
    origin: true, // Permitir todos los orígenes
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
}
