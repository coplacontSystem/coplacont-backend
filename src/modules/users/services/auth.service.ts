import { Injectable } from '@nestjs/common';
import { UserService } from './user.service';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { Persona } from '../entities/persona.entity';
import { JwtService } from '@nestjs/jwt';
import { AuthLoginDto } from '../dto/auth/auth-login.dto';
import { UserRolService } from './user-role.service';
import { RolePermissionService } from './role-permission.service';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { Payload } from '../dto/auth/payload';
import { AuthResponseDto } from '../dto/auth/auth-response.dto';
import { EmailService } from './email.service';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UserService,
    private readonly userRoleService: UserRolService,
    private readonly rolePermissionService: RolePermissionService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Valida las credenciales del usuario
   * @param email Email del usuario
   * @param contrasena Contraseña del usuario
   * @returns Usuario si las credenciales son válidas, null en caso contrario
   */
  async validateUser(email: string, contrasena: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);

    if (user && user.contrasena && contrasena) {
      // Verificar si el usuario está habilitado
      if (!user.habilitado) {
        return null;
      }

      // Verificar si la empresa (persona) está habilitada
      if (user.persona && !user.persona.habilitado) {
        return null;
      }

      const isPasswordValid = await bcrypt.compare(contrasena, user.contrasena);

      if (isPasswordValid) {
        return user;
      }
    }

    return null;
  }

  /**
   * Procesa el login del usuario
   * @param authLoginDto Datos de login (email y contraseña)
   * @returns Respuesta de autenticación con mensaje, email, JWT y datos de persona (si es exitoso)
   */
  async login(
    authLoginDto: AuthLoginDto,
    agente?: string,
  ): Promise<AuthResponseDto> {
    const user = await this.validateUser(
      authLoginDto.email,
      authLoginDto.contrasena,
    );

    if (!user) {
      return this.buildAuthResponse('Credenciales inválidas', false);
    }

    await this.usersService.registrarLogin(user.id, agente);
    const roles = await this.userRoleService.findRolesByUser(user);
    const permissions =
      await this.rolePermissionService.findPermissionsByRoles(roles);
    const payload = this.jwtService.sign(
      this.buildPayload(user, roles, permissions),
    );
    return this.buildAuthResponse(
      'Inicio de sesión exitoso',
      true,
      user.nombre,
      user.email,
      payload,
      user.persona,
      roles,
    );
  }

  /**
   * Solicita recuperación de contraseña enviando un email con token
   * @param email Email del usuario
   * @returns Respuesta del proceso
   */
  async requestPasswordReset(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return {
        message: 'Si el email existe, recibirás un correo de recuperación',
        success: true,
      };
    }

    const resetToken = randomBytes(32).toString('hex');

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await this.usersService.updateResetPasswordToken(
      user.id,
      resetToken,
      expiresAt,
    );

    const emailResult = await this.emailService.sendPasswordResetEmail(
      email,
      resetToken,
    );

    if (!emailResult.success) {
      return {
        message: 'Error al enviar el correo de recuperación',
        success: false,
      };
    }

    return {
      message: 'Si el email existe, recibirás un correo de recuperación',
      success: true,
    };
  }

  /**
   * Valida si el token de recuperación es válido y no ha expirado
   * @param token Token de recuperación
   * @returns Respuesta de validación
   */
  async validateResetToken(token: string) {
    const user = await this.usersService.findByResetToken(token);

    if (!user) {
      return {
        message: 'Token inválido o expirado',
        success: false,
      };
    }

    if (user.resetPasswordExpires && user.resetPasswordExpires < new Date()) {
      await this.usersService.clearResetPasswordToken(user.id);
      return {
        message: 'Token expirado',
        success: false,
      };
    }

    return {
      message: 'Token válido',
      success: true,
      userId: user.id,
    };
  }

  /**
   * Resetea la contraseña del usuario usando el token de recuperación
   * @param token Token de recuperación
   * @param password Nueva contraseña
   * @returns Respuesta del proceso
   */
  async resetPassword(token: string, password: string) {
    const tokenValidation = await this.validateResetToken(token);

    if (!tokenValidation.success) {
      return tokenValidation;
    }

    const user = await this.usersService.findByResetToken(token);

    if (!user) {
      return {
        message: 'Token inválido',
        success: false,
      };
    }

    // Hashear la nueva contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Actualizar contraseña
    await this.usersService.updatePassword(user.id, hashedPassword);

    // Limpiar token de recuperación
    await this.usersService.clearResetPasswordToken(user.id);

    return {
      message: 'Contraseña actualizada exitosamente',
      success: true,
    };
  }

  private buildPayload(
    user: User,
    roles: Role[],
    permissions: Permission[],
  ): Payload {
    return {
      sub: user.id,
      email: user.email,
      roles,
      permissions,
    };
  }

  /**
   * Construye la respuesta de autenticación
   * @param message Mensaje de respuesta
   * @param email Email del usuario (opcional)
   * @param jwt Token JWT (opcional)
   * @returns Objeto de respuesta de autenticación
   */
  /**
   * Construye la respuesta de autenticación
   * @param message Mensaje de respuesta
   * @param success Indica si la operación fue exitosa
   * @param email Email del usuario (opcional)
   * @param jwt Token JWT (opcional)
   * @param persona Datos de la persona (opcional)
   * @param roles Roles del usuario (opcional)
   * @returns Respuesta de autenticación
   */
  private buildAuthResponse(
    message: string,
    success: boolean,
    nombre?: string,
    email?: string,
    jwt?: string,
    persona?: Persona,
    roles?: Role[],
  ): AuthResponseDto {
    const response: AuthResponseDto = { message, success };

    if (nombre) response.nombre = nombre;
    if (email) response.email = email;
    if (jwt) response.jwt = jwt;
    if (persona) response.persona = persona;
    if (roles) response.roles = roles;

    return response;
  }
}
