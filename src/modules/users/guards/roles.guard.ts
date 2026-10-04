import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolEnum } from '../enums/RoleEnum';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/** Nombres de rol del usuario autenticado (el JWT trae objetos Role). */
export function rolesDe(user: AuthenticatedUser | undefined): string[] {
  const roles = (user?.roles ?? []) as Array<string | { nombre?: string }>;
  return roles.map((r) => (typeof r === 'string' ? r : (r?.nombre ?? '')));
}

export function esAdmin(user: AuthenticatedUser | undefined): boolean {
  return rolesDe(user).includes(RolEnum.ADMIN);
}

/**
 * Verifica los roles exigidos con @Roles(). Debe ir después de JwtAuthGuard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requeridos = this.reflector.getAllAndOverride<RolEnum[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requeridos || requeridos.length === 0) return true;

    const user = context.switchToHttp().getRequest<Request>()['user'] as
      | AuthenticatedUser
      | undefined;
    const roles = rolesDe(user);
    if (!requeridos.some((r) => roles.includes(r))) {
      throw new ForbiddenException('No tiene permisos para este recurso');
    }
    return true;
  }
}
