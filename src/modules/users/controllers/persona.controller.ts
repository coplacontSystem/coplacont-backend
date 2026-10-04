import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { RolEnum } from '../enums/RoleEnum';
import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  HttpCode,
  HttpStatus,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { PersonaService } from '../services/person.service';
import {
  PersonaWithUsersResponseDto,
  UserInPersonaResponseDto,
} from '../dto/persona/persona-with-users-response.dto';
import { UpdatePersonaDto } from '../dto/persona/update-persona.dto';
import { plainToInstance } from 'class-transformer';

@ApiTags('Personas/Empresas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolEnum.ADMIN)
@Controller('api/persona')
export class PersonaController {
  constructor(private readonly personaService: PersonaService) {}

  @Get()
  @ApiOperation({
    summary: 'Obtener todas las empresas con sus usuarios',
    description:
      'Retorna una lista completa de todas las empresas registradas junto con sus usuarios asociados, incluyendo roles y estado de cada usuario.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de empresas con usuarios obtenida exitosamente',
    type: [PersonaWithUsersResponseDto],
    example: [
      {
        id: 1,
        nombreEmpresa: 'Empresa Ejemplo SAC',
        ruc: '20123456789',
        razonSocial: 'Empresa Ejemplo Sociedad Anónima Cerrada',
        telefono: '+51 999 888 777',
        direccion: 'Av. Principal 123, Lima',
        habilitado: true,
        createdAt: '2024-01-15T10:30:00Z',
        updatedAt: '2024-01-15T10:30:00Z',
        totalUsuarios: 3,
        usuariosActivos: 2,
        usuarios: [
          {
            id: 1,
            nombre: 'Juan Pérez',
            email: 'juan.perez@empresa.com',
            habilitado: true,
            esPrincipal: true,
            roles: ['Administrador'],
          },
          {
            id: 2,
            nombre: 'María García',
            email: 'maria.garcia@empresa.com',
            habilitado: true,
            esPrincipal: false,
            roles: ['Contador'],
          },
          {
            id: 3,
            nombre: 'Carlos López',
            email: 'carlos.lopez@empresa.com',
            habilitado: false,
            esPrincipal: false,
            roles: ['Usuario'],
          },
        ],
      },
    ],
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor',
  })
  async findAllWithUsers(): Promise<PersonaWithUsersResponseDto[]> {
    const personas = await this.personaService.findAllWithUsers();

    return personas.map((persona) => {
      const personaDto = plainToInstance(PersonaWithUsersResponseDto, persona, {
        excludeExtraneousValues: true,
      });

      // Mapear usuarios con sus roles
      if (persona.usuarios) {
        personaDto.usuarios = persona.usuarios.map((user) => {
          const userDto = plainToInstance(UserInPersonaResponseDto, user, {
            excludeExtraneousValues: true,
          });

          // Extraer roles del usuario
          if (user.userRoles) {
            userDto.roles = user.userRoles.map((ur) => ur.role.nombre);
          }

          return userDto;
        });

        // Calcular estadísticas
        personaDto.totalUsuarios = persona.usuarios.length;
        personaDto.usuariosActivos = persona.usuarios.filter(
          (user) => user.habilitado,
        ).length;
      } else {
        personaDto.usuarios = [];
        personaDto.totalUsuarios = 0;
        personaDto.usuariosActivos = 0;
      }

      return personaDto;
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener empresa por ID con sus usuarios',
    description:
      'Retorna los datos de una empresa específica junto con todos sus usuarios asociados, incluyendo roles y estado de cada usuario.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la empresa',
    example: 1,
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Empresa encontrada exitosamente',
    type: PersonaWithUsersResponseDto,
    example: {
      id: 1,
      nombreEmpresa: 'Empresa Ejemplo SAC',
      ruc: '20123456789',
      razonSocial: 'Empresa Ejemplo Sociedad Anónima Cerrada',
      telefono: '+51 999 888 777',
      direccion: 'Av. Principal 123, Lima',
      habilitado: true,
      createdAt: '2024-01-15T10:30:00Z',
      updatedAt: '2024-01-15T10:30:00Z',
      totalUsuarios: 2,
      usuariosActivos: 2,
      usuarios: [
        {
          id: 1,
          nombre: 'Juan Pérez',
          email: 'juan.perez@empresa.com',
          habilitado: true,
          esPrincipal: true,
          roles: ['Administrador'],
        },
        {
          id: 2,
          nombre: 'María García',
          email: 'maria.garcia@empresa.com',
          habilitado: true,
          esPrincipal: false,
          roles: ['Contador'],
        },
      ],
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa no encontrada',
  })
  @ApiResponse({
    status: 400,
    description: 'ID de empresa inválido',
  })
  async findByIdWithUsers(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PersonaWithUsersResponseDto | null> {
    const persona = await this.personaService.findByIdWithUsers(id);

    if (!persona) {
      return null;
    }

    const personaDto = plainToInstance(PersonaWithUsersResponseDto, persona, {
      excludeExtraneousValues: true,
    });

    // Mapear usuarios con sus roles
    if (persona.usuarios) {
      personaDto.usuarios = persona.usuarios.map((user) => {
        const userDto = plainToInstance(UserInPersonaResponseDto, user, {
          excludeExtraneousValues: true,
        });

        // Extraer roles del usuario
        if (user.userRoles) {
          userDto.roles = user.userRoles.map((ur) => ur.role.nombre);
        }

        return userDto;
      });

      // Calcular estadísticas
      personaDto.totalUsuarios = persona.usuarios.length;
      personaDto.usuariosActivos = persona.usuarios.filter(
        (user) => user.habilitado,
      ).length;
    } else {
      personaDto.usuarios = [];
      personaDto.totalUsuarios = 0;
      personaDto.usuariosActivos = 0;
    }

    return personaDto;
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar datos de empresa',
    description:
      'Actualiza los datos básicos de una empresa (nombre, RUC, razón social, teléfono, dirección). No afecta a los usuarios asociados.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la empresa a actualizar',
    example: 1,
    type: 'number',
  })
  @ApiBody({
    type: UpdatePersonaDto,
    examples: {
      actualizacionCompleta: {
        summary: 'Actualización completa de empresa',
        value: {
          nombreEmpresa: 'Nueva Empresa Actualizada S.A.C.',
          ruc: '20987654321',
          razonSocial: 'NUEVA EMPRESA ACTUALIZADA SOCIEDAD ANONIMA CERRADA',
          telefono: '+51 999 777 888',
          direccion: 'Av. Actualizada 456, San Isidro, Lima',
        },
      },
      actualizacionParcial: {
        summary: 'Actualización parcial (solo teléfono y dirección)',
        value: {
          telefono: '+51 999 555 444',
          direccion: 'Nueva dirección empresarial',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Empresa actualizada exitosamente',
    type: PersonaWithUsersResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa no encontrada',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos',
  })
  async updatePersona(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePersonaDto: UpdatePersonaDto,
  ): Promise<PersonaWithUsersResponseDto> {
    await this.personaService.update(id, updatePersonaDto);
    const result = await this.findByIdWithUsers(id);
    if (!result) {
      throw new Error('Empresa no encontrada después de la actualización');
    }
    return result;
  }

  @Patch(':id/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Desactivar empresa y todos sus usuarios',
    description:
      'Desactiva una empresa específica y automáticamente desactiva todos los usuarios asociados a ella. Esta operación cambia el estado "habilitado" a false tanto para la empresa como para todos sus usuarios.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la empresa a desactivar',
    example: 1,
    type: 'number',
  })
  @ApiResponse({
    status: 204,
    description: 'Empresa y usuarios desactivados exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa no encontrada',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Empresa con ID 1 no encontrada',
        },
        error: {
          type: 'string',
          example: 'Not Found',
        },
        statusCode: {
          type: 'number',
          example: 404,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'ID de empresa inválido',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Validation failed (numeric string is expected)',
        },
        error: {
          type: 'string',
          example: 'Bad Request',
        },
        statusCode: {
          type: 'number',
          example: 400,
        },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Error interno del servidor',
        },
        error: {
          type: 'string',
          example: 'Internal Server Error',
        },
        statusCode: {
          type: 'number',
          example: 500,
        },
      },
    },
  })
  async disablePersonaAndUsers(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    try {
      await this.personaService.disablePersonaAndUsers(id);
    } catch (error) {
      if (error.message.includes('no encontrada')) {
        throw new Error(`Empresa con ID ${id} no encontrada`);
      }
      throw error;
    }
  }

  @Patch(':id/enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Activar empresa y todos sus usuarios',
    description:
      'Activa una empresa específica y automáticamente activa todos los usuarios asociados a ella. Esta operación cambia el estado "habilitado" a true tanto para la empresa como para todos sus usuarios.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la empresa a activar',
    example: 1,
    type: 'number',
  })
  @ApiResponse({
    status: 204,
    description: 'Empresa y usuarios activados exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Empresa no encontrada',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Empresa con ID 1 no encontrada',
        },
        error: {
          type: 'string',
          example: 'Not Found',
        },
        statusCode: {
          type: 'number',
          example: 404,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'ID de empresa inválido',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Validation failed (numeric string is expected)',
        },
        error: {
          type: 'string',
          example: 'Bad Request',
        },
        statusCode: {
          type: 'number',
          example: 400,
        },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Error interno del servidor',
        },
        error: {
          type: 'string',
          example: 'Internal Server Error',
        },
        statusCode: {
          type: 'number',
          example: 500,
        },
      },
    },
  })
  async enablePersonaAndUsers(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    try {
      await this.personaService.enablePersonaAndUsers(id);
    } catch (error) {
      if (error.message.includes('no encontrada')) {
        throw new Error(`Empresa con ID ${id} no encontrada`);
      }
      throw error;
    }
  }
}
