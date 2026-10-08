import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../modules/users/decorators/current-user.decorator';

/** Devuelve la empresa del usuario o responde 403 si no tiene una asociada. */
export function empresaDe(user: AuthenticatedUser): number {
  if (!user?.personaId) {
    throw new ForbiddenException('Usuario no tiene una empresa asociada');
  }
  return Number(user.personaId);
}
