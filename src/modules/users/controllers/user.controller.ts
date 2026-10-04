import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { esAdmin, RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { RolEnum } from '../enums/RoleEnum';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { UserService } from '../services/user.service';
import { PersonaService } from '../services/person.service';
import { CreateUserDto } from '../dto/user/create-user.dto';
import { CreateUserForPersonaDto } from '../dto/user/create-user-for-persona.dto';
import { CreatePersonaWithUserDto } from '../dto/persona/create-persona-with-user.dto';
import { ResponseUserDto } from '../dto/user/response-user.dto';
import { UpdateUserDto } from '../dto/user/update-user.dto';
import { hash } from 'bcrypt';

@ApiTags('Usuarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly personaService: PersonaService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Obtener usuario por ID' })
  @ApiParam({
    name: 'id',
    description: 'ID del usuario',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario encontrado exitosamente',
    type: ResponseUserDto,
    example: {
      id: 1,
      email: 'usuario@empresa.com',
      nombre: 'Juan Pérez',
      habilitado: true,
      esPrincipal: true,
      persona: {
        id: 1,
        nombreEmpresa: 'Mi Empresa SAC',
        ruc: '20123456789',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  findById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseUserDto> {
    this.assertAdminOPropio(user, id);
    return this.userService.findById(id);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los usuarios' })
  @ApiResponse({
    status: 200,
    description: 'Lista de usuarios obtenida exitosamente',
    type: [ResponseUserDto],
    example: [
      {
        id: 1,
        email: 'admin@empresa.com',
        nombre: 'Administrador',
        habilitado: true,
        esPrincipal: true,
      },
      {
        id: 2,
        email: 'contador@empresa.com',
        nombre: 'Contador',
        habilitado: true,
        esPrincipal: false,
      },
    ],
  })
  async findAll(@CurrentUser() user: AuthenticatedUser) {
    const usuarios = await this.userService.findAll();
    // Un usuario que no es ADMIN solo puede verse a sí mismo
    if (esAdmin(user)) return usuarios;
    return usuarios.filter((u: { id: number }) => Number(u.id) === user.id);
  }

  @Roles(RolEnum.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Crear un nuevo usuario' })
  @ApiBody({
    type: CreateUserDto,
    examples: {
      ejemplo1: {
        summary: 'Usuario administrador',
        value: {
          nombre: 'Juan Pérez',
          email: 'juan.perez@empresa.com',
          idPersona: 1,
          idRol: 1,
          esPrincipal: true,
        },
      },
      ejemplo2: {
        summary: 'Usuario contador',
        value: {
          nombre: 'María García',
          email: 'maria.garcia@empresa.com',
          idPersona: 1,
          idRol: 2,
          esPrincipal: false,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Usuario creado exitosamente',
    type: ResponseUserDto,
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 409, description: 'El email ya existe' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Patch('/:id')
  @ApiOperation({ summary: 'Actualizar usuario' })
  @ApiParam({
    name: 'id',
    description: 'ID del usuario a actualizar',
    example: 1,
  })
  @ApiBody({
    type: UpdateUserDto,
    examples: {
      ejemplo1: {
        summary: 'Actualizar nombre y email',
        value: {
          nombre: 'Juan Carlos Pérez',
          email: 'juan.carlos@empresa.com',
        },
      },
      ejemplo2: {
        summary: 'Cambiar rol',
        value: {
          idRol: 3,
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Usuario actualizado exitosamente' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    this.assertAdminOPropio(user, id);
    // Sobre su propia cuenta, un usuario solo puede cambiar nombre y email
    const datos: UpdateUserDto = esAdmin(user)
      ? updateUserDto
      : { nombre: updateUserDto.nombre, email: updateUserDto.email };
    return this.userService.update(id, datos);
  }

  @Roles(RolEnum.ADMIN)
  @Patch(':id/disabled')
  @ApiOperation({ summary: 'Desactivar usuario (método legacy)' })
  @ApiParam({
    name: 'id',
    description: 'ID del usuario a desactivar',
    example: 1,
  })
  @ApiResponse({ status: 200, description: 'Usuario desactivado exitosamente' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  disable(@Param('id') id: number): Promise<void> {
    return this.userService.softDelete(id);
  }

  /**
   * Crea un usuario asociado a una empresa específica
   * @param idPersona ID de la empresa
   * @param createUserForPersonaDto Datos del usuario a crear
   * @returns Usuario creado
   */
  @Roles(RolEnum.ADMIN)
  @Post('persona/:idPersona')
  @ApiOperation({
    summary: 'Crear usuario para una empresa específica',
    description:
      'Crea un nuevo usuario y lo asocia automáticamente a la empresa especificada. Se envía un email de bienvenida con credenciales temporales.',
  })
  @ApiParam({
    name: 'idPersona',
    description: 'ID de la empresa a la que se asociará el usuario',
    example: 1,
  })
  @ApiBody({
    type: CreateUserForPersonaDto,
    examples: {
      administrador: {
        summary: 'Usuario administrador de empresa',
        value: {
          nombre: 'Carlos Administrador',
          email: 'admin@nuevaempresa.com',
          idRol: 1,
          esPrincipal: true,
        },
      },
      contador: {
        summary: 'Usuario contador',
        value: {
          nombre: 'Ana Contadora',
          email: 'contador@nuevaempresa.com',
          idRol: 2,
          esPrincipal: false,
        },
      },
      vendedor: {
        summary: 'Usuario vendedor',
        value: {
          nombre: 'Luis Vendedor',
          email: 'ventas@nuevaempresa.com',
          idRol: 3,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Usuario creado exitosamente y asociado a la empresa',
    type: ResponseUserDto,
    example: {
      id: 5,
      email: 'admin@nuevaempresa.com',
      nombre: 'Carlos Administrador',
      habilitado: true,
      esPrincipal: true,
      persona: {
        id: 1,
        nombreEmpresa: 'Nueva Empresa SAC',
        ruc: '20987654321',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o email ya existe',
  })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  createUserForPersona(
    @Param('idPersona') idPersona: number,
    @Body() createUserForPersonaDto: CreateUserForPersonaDto,
  ): Promise<ResponseUserDto> {
    return this.userService.createUserForPersona(
      createUserForPersonaDto,
      idPersona,
    );
  }

  /**
   * Desactiva una empresa y todos sus usuarios asociados
   * @param idPersona ID de la empresa a desactivar
   */
  @Roles(RolEnum.ADMIN)
  @Patch('persona/:idPersona/disabled')
  @ApiOperation({
    summary: 'Desactivar empresa y todos sus usuarios',
    description:
      'Desactiva una empresa (persona jurídica) y automáticamente desactiva todos los usuarios asociados a ella. Esta acción es reversible.',
  })
  @ApiParam({
    name: 'idPersona',
    description: 'ID de la empresa a desactivar',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Empresa y usuarios desactivados exitosamente',
    example: {
      message:
        'Empresa y 3 usuarios asociados han sido desactivados exitosamente',
    },
  })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  @ApiResponse({
    status: 400,
    description: 'Error al desactivar la empresa o sus usuarios',
  })
  disablePersonaAndUsers(@Param('idPersona') idPersona: number): Promise<void> {
    return this.personaService.disablePersonaAndUsers(idPersona);
  }

  /**
   * Desactiva un usuario individual
   * @param id ID del usuario a desactivar
   */
  @Roles(RolEnum.ADMIN)
  @Patch(':id/disable')
  @ApiOperation({
    summary: 'Desactivar usuario individual',
    description:
      'Desactiva un usuario específico sin afectar a otros usuarios de la misma empresa. El usuario no podrá acceder al sistema pero sus datos se conservan.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del usuario a desactivar',
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario desactivado exitosamente',
    example: {
      message: 'Usuario desactivado exitosamente',
    },
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  @ApiResponse({ status: 400, description: 'Error al desactivar el usuario' })
  disableUser(@Param('id') id: number): Promise<void> {
    return this.userService.softDelete(id);
  }

  /**
   * Actualiza la contraseña de un usuario sin requerir la contraseña actual
   * @param id ID del usuario
   * @param body Objeto con la nueva contraseña
   */
  @Patch(':id/password')
  @ApiOperation({
    summary: 'Actualizar contraseña de usuario',
    description:
      'Actualiza la contraseña de un usuario específico sin requerir la contraseña actual. Útil para administradores o procesos de recuperación.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del usuario cuya contraseña se actualizará',
    example: 1,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        password: {
          type: 'string',
          description: 'Nueva contraseña del usuario',
          example: 'nuevaPassword123!',
          minLength: 8,
        },
      },
      required: ['password'],
    },
    examples: {
      ejemplo1: {
        summary: 'Actualizar contraseña',
        value: {
          password: 'nuevaPassword123!',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Contraseña actualizada exitosamente',
    example: {
      message: 'Contraseña actualizada exitosamente',
    },
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  @ApiResponse({ status: 400, description: 'Contraseña inválida o muy débil' })
  async updatePassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { password: string },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    this.assertAdminOPropio(user, id);
    if (typeof body?.password !== 'string' || body.password.length < 8) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres',
      );
    }
    const hashedPassword = await hash(body.password, 10);
    return this.userService.updatePassword(id, hashedPassword);
  }

  /**
   * Crea una nueva empresa junto con su usuario principal
   * @param createPersonaWithUserDto Datos de la empresa y usuario principal
   * @returns Empresa y usuario creados
   */
  @Roles(RolEnum.ADMIN)
  @Post('empresa-con-usuario')
  @ApiOperation({
    summary: 'Crear empresa con usuario principal',
    description:
      'Crea una nueva empresa (persona jurídica) junto con su usuario principal en una sola operación. El usuario principal tendrá acceso completo a la empresa y recibirá un email de bienvenida con credenciales temporales.',
  })
  @ApiBody({
    type: CreatePersonaWithUserDto,
    examples: {
      empresaCompleta: {
        summary: 'Empresa nueva con administrador',
        value: {
          nombreEmpresa: 'Innovación Tech S.A.C.',
          ruc: '20123456789',
          razonSocial: 'INNOVACION TECH SOCIEDAD ANONIMA CERRADA',
          telefono: '+51 999 888 777',
          direccion: 'Av. Tecnológica 123, San Isidro, Lima',
          nombreUsuario: 'Carlos Administrador',
          emailUsuario: 'admin@innovaciontech.com',
          idRol: 1,
          esPrincipal: true,
        },
      },
      empresaBasica: {
        summary: 'Empresa básica con datos mínimos',
        value: {
          nombreEmpresa: 'Comercial ABC E.I.R.L.',
          ruc: '20987654321',
          razonSocial:
            'COMERCIAL ABC EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA',
          nombreUsuario: 'Ana Gerente',
          emailUsuario: 'gerencia@comercialabc.com',
          idRol: 1,
          esPrincipal: true,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Empresa y usuario principal creados exitosamente',
    example: {
      persona: {
        id: 10,
        nombreEmpresa: 'Innovación Tech S.A.C.',
        ruc: '20123456789',
        razonSocial: 'INNOVACION TECH SOCIEDAD ANONIMA CERRADA',
        telefono: '+51 999 888 777',
        direccion: 'Av. Tecnológica 123, San Isidro, Lima',
        habilitado: true,
        createdAt: '2024-01-15T10:30:00.000Z',
        updatedAt: '2024-01-15T10:30:00.000Z',
      },
      usuario: {
        id: 25,
        email: 'admin@innovaciontech.com',
        nombre: 'Carlos Administrador',
        habilitado: true,
        esPrincipal: true,
        persona: {
          id: 10,
          nombreEmpresa: 'Innovación Tech S.A.C.',
          ruc: '20123456789',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos, RUC ya existe, o email ya registrado',
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor durante la transacción',
  })
  createPersonaWithUser(
    @Body() createPersonaWithUserDto: CreatePersonaWithUserDto,
  ): Promise<{ persona: any; usuario: any }> {
    return this.personaService.createPersonaWithUser(createPersonaWithUserDto);
  }

  @Roles(RolEnum.ADMIN)
  @Patch(':id/enable')
  @ApiOperation({
    summary: 'Activar usuario individual',
    description:
      'Activa un usuario específico sin afectar a otros usuarios de la misma empresa. El usuario podrá acceder al sistema nuevamente.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del usuario a activar',
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario activado exitosamente',
    example: {
      message: 'Usuario activado exitosamente',
    },
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  @ApiResponse({ status: 400, description: 'Error al activar el usuario' })
  async enableUser(@Param('id') id: number): Promise<void> {
    await this.userService.enableUser(id);
  }

  /** Solo un ADMIN puede operar sobre usuarios distintos del propio. */
  private assertAdminOPropio(user: AuthenticatedUser, id: number): void {
    if (!esAdmin(user) && Number(user.id) !== Number(id)) {
      throw new ForbiddenException('No tiene permisos sobre este usuario');
    }
  }
}
