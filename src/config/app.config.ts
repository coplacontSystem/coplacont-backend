import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ErroresFilter } from '../common/errores.filter';

/** Orígenes permitidos por CORS (CORS_ORIGINS, separados por coma). */
function origenesPermitidos(): string[] | boolean {
  const lista = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (lista.length > 0) return lista;
  if (process.env.NODE_ENV === 'production') {
    new Logger('CORS').warn(
      'CORS_ORIGINS no está definido: se aceptan todos los orígenes. Defínelo en producción.',
    );
  }
  return true;
}

/**
 * Configuración global de la aplicación.
 * Se usa desde main.ts y desde los tests e2e para que ambos levanten la app igual.
 */
export function configureApp(app: INestApplication): void {
  app.enableCors({
    origin: origenesPermitidos(),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // El frontend lee el nombre de los archivos exportados
    exposedHeaders: ['Content-Disposition'],
    credentials: true,
  });

  // Valida los DTO de entrada (class-validator). No elimina propiedades sin
  // decorador para no romper DTO que aún no los tienen.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  app.useGlobalFilters(new ErroresFilter());
}
