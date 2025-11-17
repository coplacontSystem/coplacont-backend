import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Entidad } from '../entities';
import {
  CreateEntidadDto,
  UpdateEntidadDto,
  ActivateRoleDto,
  EntidadResponseDto,
  ApiResponseDto,
} from '../dto';

@Injectable()
export class EntidadService {
  constructor(
    @InjectRepository(Entidad)
    private readonly personRepository: Repository<Entidad>,
  ) {}

  /**
   * Crea una nueva persona
   * @param createPersonDto - Datos para crear la persona
   * @param personaId - ID de la persona (empresa) a la que pertenece
   * @returns Respuesta con la persona creada o error
   */
  async create(
    createPersonDto: CreateEntidadDto,
    personaId: number,
  ): Promise<ApiResponseDto<EntidadResponseDto>> {
    try {
      const existingPerson = await this.personRepository.findOne({
        where: {
          numeroDocumento: createPersonDto.numeroDocumento,
          persona: { id: personaId },
        },
      });
      if (existingPerson) {
        const wantsCliente = createPersonDto.esCliente === true;
        const wantsProveedor = createPersonDto.esProveedor === false;
        const isCurrentlyCliente = existingPerson.esCliente === true;
        const isCurrentlyProveedor = existingPerson.esProveedor === true;

        if (
          wantsCliente &&
          wantsProveedor &&
          !isCurrentlyCliente &&
          isCurrentlyProveedor
        ) {
          existingPerson.esCliente = true;
          const updatedPerson =
            await this.personRepository.save(existingPerson);
          const responseDto = this.mapToResponseDto(updatedPerson);
          return ApiResponseDto.success(
            'Entidad actualizada exitosamente',
            responseDto,
          );
        }

        return ApiResponseDto.error(
          `Ya existe una entidad con el número de documento ${createPersonDto.numeroDocumento} en esta empresa`,
        );
      }

      const person = this.personRepository.create({
        ...createPersonDto,
        persona: { id: personaId },
      });
      const savedPerson = await this.personRepository.save(person);
      const responseDto = this.mapToResponseDto(savedPerson);

      return ApiResponseDto.success('Entidad creada exitosamente', responseDto);
    } catch (error) {
      return ApiResponseDto.error(
        'Error al crear la entidad: ' + error.message,
      );
    }
  }

  /**
   * Obtiene todas las personas de una empresa específica
   * @param personaId - ID de la persona (empresa)
   * @param includeInactive - Si es true, incluye personas inactivas. Por defecto false (solo activas)
   * @returns Respuesta con lista de personas
   */
  async findAll(
    personaId: number,
    includeInactive: boolean = false,
  ): Promise<ApiResponseDto<EntidadResponseDto[]>> {
    try {
      const whereCondition: any = { persona: { id: personaId } };
      if (!includeInactive) {
        whereCondition.activo = true;
      }

      const persons = await this.personRepository.find({
        where: whereCondition,
        order: { createdAt: 'DESC' },
      });

      const responseDtos = persons.map((person) =>
        this.mapToResponseDto(person),
      );
      return ApiResponseDto.success(
        'Entidades obtenidas exitosamente',
        responseDtos,
      );
    } catch (error) {
      return ApiResponseDto.error(
        'Error al obtener las entidades: ' + error.message,
      );
    }
  }

  /**
   * Busca una persona por ID dentro de una empresa específica
   * @param id - ID de la persona
   * @param personaId - ID de la persona (empresa)
   * @returns Respuesta con la persona encontrada o error
   */
  async findById(
    id: number,
    personaId: number,
  ): Promise<ApiResponseDto<EntidadResponseDto>> {
    try {
      const person = await this.personRepository.findOne({
        where: { id, persona: { id: personaId }, activo: true },
      });

      if (!person) {
        return ApiResponseDto.error(
          `Entidad con ID ${id} no encontrada en esta empresa`,
        );
      }

      const responseDto = this.mapToResponseDto(person);
      return ApiResponseDto.success(
        'Entidad encontrada exitosamente',
        responseDto,
      );
    } catch (error) {
      return ApiResponseDto.error(
        'Error al buscar la entidad: ' + error.message,
      );
    }
  }

  /**
   * Obtiene todas las personas que son clientes de una empresa específica
   * @param personaId - ID de la persona (empresa)
   * @param includeInactive - Si es true, incluye clientes inactivos. Por defecto false (solo activos)
   * @returns Respuesta con lista de clientes
   */
  async findClients(
    personaId: number,
    includeInactive: boolean = false,
  ): Promise<ApiResponseDto<EntidadResponseDto[]>> {
    try {
      const whereCondition: any = {
        persona: { id: personaId },
        esCliente: true,
      };
      if (!includeInactive) {
        whereCondition.activo = true;
      }

      const clients = await this.personRepository.find({
        where: whereCondition,
        order: { createdAt: 'DESC' },
      });

      const responseDtos = clients.map((client) =>
        this.mapToResponseDto(client),
      );
      return ApiResponseDto.success(
        'Clientes obtenidos exitosamente',
        responseDtos,
      );
    } catch (error) {
      return ApiResponseDto.error(
        'Error al obtener los clientes: ' + error.message,
      );
    }
  }

  /**
   * Obtiene todas las personas que son proveedores de una empresa específica
   * @param personaId - ID de la persona (empresa)
   * @param includeInactive - Si es true, incluye proveedores inactivos. Por defecto false (solo activos)
   * @returns Respuesta con lista de proveedores
   */
  async findProviders(
    personaId: number,
    includeInactive: boolean = false,
  ): Promise<ApiResponseDto<EntidadResponseDto[]>> {
    try {
      const whereCondition: any = {
        persona: { id: personaId },
        esProveedor: true,
      };
      if (!includeInactive) {
        whereCondition.activo = true;
      }

      const providers = await this.personRepository.find({
        where: whereCondition,
        order: { createdAt: 'DESC' },
      });

      const responseDtos = providers.map((provider) =>
        this.mapToResponseDto(provider),
      );
      return ApiResponseDto.success(
        'Proveedores obtenidos exitosamente',
        responseDtos,
      );
    } catch (error) {
      return ApiResponseDto.error(
        'Error al obtener los proveedores: ' + error.message,
      );
    }
  }

  /**
   * Actualiza los datos principales de una persona
   * @param id - ID de la persona
   * @param personaId - ID de la persona (empresa)
   * @param updatePersonDto - Datos a actualizar
   * @returns Respuesta con la persona actualizada o error
   */
  async update(
    id: number,
    personaId: number,
    updatePersonDto: UpdateEntidadDto,
  ): Promise<ApiResponseDto<EntidadResponseDto>> {
    try {
      const person = await this.personRepository.findOne({
        where: { id, persona: { id: personaId }, activo: true },
      });

      if (!person) {
        return ApiResponseDto.error(
          `Entidad con ID ${id} no encontrada en esta empresa`,
        );
      }

      // Actualizar solo los campos proporcionados
      Object.assign(person, updatePersonDto);

      const updatedPerson = await this.personRepository.save(person);
      const responseDto = this.mapToResponseDto(updatedPerson);
      return ApiResponseDto.success(
        'Entidad actualizada exitosamente',
        responseDto,
      );
    } catch (error) {
      return ApiResponseDto.error(
        'Error al actualizar la entidad: ' + error.message,
      );
    }
  }

  /**
   * Activa un rol específico para una persona (solo activación permitida)
   * @param id - ID de la persona
   * @param personaId - ID de la persona (empresa)
   * @param activateRoleDto - Datos del rol a activar
   * @returns Respuesta con la persona con el rol activado o error
   */
  async activateRole(
    id: number,
    personaId: number,
    activateRoleDto: ActivateRoleDto,
  ): Promise<ApiResponseDto<EntidadResponseDto>> {
    try {
      const person = await this.personRepository.findOne({
        where: { id, persona: { id: personaId }, activo: true },
      });

      if (!person) {
        return ApiResponseDto.error(
          `Entidad con ID ${id} no encontrada en esta empresa`,
        );
      }

      // Validar que solo se esté activando (no desactivando)
      if (!activateRoleDto.isCliente && !activateRoleDto.isProveedor) {
        return ApiResponseDto.error(
          'Solo se permite activar roles, no desactivar',
        );
      }

      // Activar los roles especificados
      if (activateRoleDto.isCliente !== undefined) {
        person.esCliente = activateRoleDto.isCliente;
      }
      if (activateRoleDto.isProveedor !== undefined) {
        person.esProveedor = activateRoleDto.isProveedor;
      }

      const updatedPerson = await this.personRepository.save(person);
      const responseDto = this.mapToResponseDto(updatedPerson);
      return ApiResponseDto.success('Rol activado exitosamente', responseDto);
    } catch (error) {
      return ApiResponseDto.error('Error al activar el rol: ' + error.message);
    }
  }

  /**
   * Realiza soft delete de una persona (marca como inactiva)
   * @param id ID de la persona
   * @param personaId - ID de la persona (empresa)
   * @returns Respuesta de confirmación o error
   */
  async softDelete(
    id: number,
    personaId: number,
  ): Promise<ApiResponseDto<null>> {
    try {
      const person = await this.personRepository.findOne({
        where: { id, persona: { id: personaId }, activo: true },
      });

      if (!person) {
        return ApiResponseDto.error('Entidad no encontrada en esta empresa');
      }

      person.activo = false;
      await this.personRepository.save(person);
      return ApiResponseDto.success('Entidad eliminada exitosamente', null);
    } catch (error) {
      return ApiResponseDto.error(
        'Error al eliminar la entidad: ' + error.message,
      );
    }
  }

  /**
   * Restaura una persona eliminada (soft delete)
   * @param id ID de la persona
   * @param personaId - ID de la persona (empresa)
   * @returns Respuesta con la persona restaurada o error
   */
  async restore(
    id: number,
    personaId: number,
  ): Promise<ApiResponseDto<EntidadResponseDto>> {
    try {
      const person = await this.personRepository.findOne({
        where: { id, persona: { id: personaId }, activo: false },
      });

      if (!person) {
        return ApiResponseDto.error(
          'Entidad no encontrada o ya está activa en esta empresa',
        );
      }

      person.activo = true;
      const restoredPerson = await this.personRepository.save(person);
      const responseDto = this.mapToResponseDto(restoredPerson);
      return ApiResponseDto.success(
        'Entidad restaurada exitosamente',
        responseDto,
      );
    } catch (error) {
      return ApiResponseDto.error(
        'Error al restaurar la entidad: ' + error.message,
      );
    }
  }

  /**
   * Busca personas por número de documento dentro de una empresa específica
   * @param documentNumber Número de documento
   * @param personaId - ID de la persona (empresa)
   * @returns Respuesta con la persona encontrada o error
   */
  async findByDocumentNumber(
    documentNumber: string,
    personaId: number,
  ): Promise<ApiResponseDto<EntidadResponseDto>> {
    try {
      const person = await this.personRepository.findOne({
        where: {
          numeroDocumento: documentNumber,
          persona: { id: personaId },
          activo: true,
        },
      });

      if (!person) {
        return ApiResponseDto.error(
          `Entidad con número de documento ${documentNumber} no encontrada en esta empresa`,
        );
      }

      const responseDto = this.mapToResponseDto(person);
      return ApiResponseDto.success(
        'Entidad encontrada exitosamente',
        responseDto,
      );
    } catch (error) {
      return ApiResponseDto.error(
        'Error al buscar la entidad: ' + error.message,
      );
    }
  }

  async findEntity(id: number): Promise<Entidad> {
    const person = await this.personRepository.findOne({ where: { id } });

    if (!person) {
      throw new NotFoundException(`La persona con id ${id} no existe`);
    }

    return person;
  }

  /**
   * Mapea una entidad Person a PersonResponseDto
   * @param entidad - Entidad Person
   * @returns PersonResponseDto
   */
  private mapToResponseDto(entidad: Entidad): EntidadResponseDto {
    const dto = new EntidadResponseDto();
    dto.id = entidad.id;
    dto.esProveedor = entidad.esProveedor;
    dto.esCliente = entidad.esCliente;
    dto.tipo = entidad.tipo;
    dto.numeroDocumento = entidad.numeroDocumento;
    dto.nombre = entidad.nombre;
    dto.apellidoMaterno = entidad.apellidoMaterno;
    dto.apellidoPaterno = entidad.apellidoPaterno;
    dto.razonSocial = entidad.razonSocial;
    dto.activo = entidad.activo;
    dto.direccion = entidad.direccion;
    dto.telefono = entidad.telefono;
    dto.nombreCompleto = entidad.nombreCompletoMostrado;
    dto.createdAt = entidad.createdAt;
    dto.updatedAt = entidad.updatedAt;
    return dto;
  }
}
