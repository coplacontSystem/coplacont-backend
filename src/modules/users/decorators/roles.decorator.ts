import { SetMetadata } from '@nestjs/common';
import { RolEnum } from '../enums/RoleEnum';

export const ROLES_KEY = 'roles';

/** Restringe un controlador o ruta a los roles indicados (usar con RolesGuard). */
export const Roles = (...roles: RolEnum[]) => SetMetadata(ROLES_KEY, roles);
