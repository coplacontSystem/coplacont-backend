import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';

/** Códigos de PostgreSQL que indican datos de entrada inválidos. */
const ENTRADA_INVALIDA = new Set([
  '22P02', // texto con formato inválido (p. ej. "abc" en un entero)
  '22007', // fecha/hora con formato inválido
  '22008', // fecha/hora fuera de rango
  '22003', // número fuera de rango
  '22001', // texto demasiado largo
  '23502', // falta un valor obligatorio
  '23503', // referencia a un registro inexistente
]);

/**
 * Filtro global de errores: deja pasar las HttpException tal cual y traduce el
 * resto sin exponer mensajes internos (SQL, nombres de tablas, stack).
 */
@Catch()
export class ErroresFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errores');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno del servidor';

    if (exception instanceof QueryFailedError) {
      const code = (exception as QueryFailedError & { code?: string }).code;
      if (code === '23505') {
        status = HttpStatus.CONFLICT;
        message = 'Ya existe un registro con esos datos';
      } else if (code && ENTRADA_INVALIDA.has(code)) {
        status = HttpStatus.BAD_REQUEST;
        message = 'Datos inválidos';
      }
    } else if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      message = 'Registro no encontrado';
    }

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        (exception as Error)?.message ?? String(exception),
        (exception as Error)?.stack,
      );
    }

    res.status(status).json({ statusCode: status, message });
  }
}
