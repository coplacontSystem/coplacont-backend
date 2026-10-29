import { RegistroAcceso } from './entities/registro-acceso.entity';
import { ThrottlerModule } from '@nestjs/throttler';
import { Module } from '@nestjs/common';
import { UserController } from './controllers/user.controller';
import { UserService } from './services/user.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { RolController } from './controllers/role.controller';
import { RoleService } from './services/role.service';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { UserRoleController } from './controllers/user-role.controller';
import { UserRolService } from './services/user-role.service';
import { Permission } from './entities/permission.entity';
import { PermissionService } from './services/permission.service';
import { PermissionController } from './controllers/permission.controller';
import { RolePermissionController } from './controllers/role-permission.controller';
import { RolePermissionService } from './services/role-permission.service';
import { RolePermission } from './entities/role-permission.entity';
import { AuthController } from './controllers/auth.controller';
import { EmailController } from './controllers/email.controller';
import { AuthService } from './services/auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PersonaService } from './services/person.service';
import { PersonaController } from './controllers/persona.controller';
import { Persona } from './entities/persona.entity';
import { EmailService } from './services/email.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Role,
      UserRole,
      Permission,
      RolePermission,
      Persona,
      RegistroAcceso,
    ]),
    // Límite por IP para los endpoints de acceso (el bloqueo por correo va en AuthService)
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 30 }],
      errorMessage:
        'Demasiadas solicitudes desde tu conexión. Espera un minuto e inténtalo de nuevo.',
      // Las pruebas e2e inician muchas sesiones seguidas desde la misma IP
      skipIf: () =>
        process.env.NODE_ENV === 'test' &&
        process.env.LIMITAR_EN_PRUEBAS !== '1',
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        // Jornada de trabajo; las sesiones se pueden cerrar antes con /auth/cerrar-sesiones
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') ?? '8h',
        },
      }),
    }),
  ],
  controllers: [
    UserController,
    RolController,
    UserRoleController,
    PermissionController,
    RolePermissionController,
    AuthController,
    EmailController,
    PersonaController,
  ],
  providers: [
    UserService,
    RoleService,
    UserRolService,
    PermissionService,
    RolePermissionService,
    AuthService,
    PersonaService,
    EmailService,
    JwtAuthGuard,
  ],
  exports: [UserService, PersonaService, AuthService, JwtAuthGuard, JwtModule],
})
export class UserModule {}
