import { Permission } from '../../entities/permission.entity';
import { Role } from '../../entities/role.entity';

export class Payload {
  sub: number;
  email: string;
  roles: Role[];
  permissions: Permission[];
  /** Versión de sesión del usuario al emitir el token */
  ver?: number;
}
