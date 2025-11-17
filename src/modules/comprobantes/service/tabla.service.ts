import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { Tabla } from '../entities/tabla.entity';
import { TablaDetalle } from '../entities/tabla-detalle.entity';
import { TablaResponseDto } from '../dto/tabla/tabla-response.dto';
import { TablaDetalleResponseDto } from '../dto/tabla/tabla-detalle-response.dto';

/**
 * Servicio para gestionar las tablas maestras del sistema
 * Proporciona métodos para obtener tablas y sus detalles
 */
@Injectable()
export class TablaService {
  constructor(
    @InjectRepository(Tabla)
    private readonly tablaRepository: Repository<Tabla>,
    @InjectRepository(TablaDetalle)
    private readonly tablaDetalleRepository: Repository<TablaDetalle>,
  ) {}

  /**
   * Obtiene todas las tablas disponibles
   * @returns Promise<TablaResponseDto[]> Lista de todas las tablas
   */
  async findAll(): Promise<TablaResponseDto[]> {
    const tablas = await this.tablaRepository.find({
      where: { activo: true },
      relations: ['detalles'],
      order: { numeroTabla: 'ASC' },
    });

    return plainToInstance(TablaResponseDto, tablas, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Obtiene una tabla específica por su número
   * @param numeroTabla - Número de la tabla (ej: "12")
   * @returns Promise<TablaResponseDto> Tabla con sus detalles
   */
  async findByNumero(numeroTabla: string): Promise<TablaResponseDto> {
    const tabla = await this.tablaRepository.findOne({
      where: { numeroTabla, activo: true },
      relations: ['detalles'],
    });

    if (!tabla) {
      throw new NotFoundException(`No se encontró la tabla ${numeroTabla}`);
    }

    // Filtrar solo detalles activos
    tabla.detalles = tabla.detalles.filter((detalle) => detalle.activo);

    return plainToInstance(TablaResponseDto, tabla, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Obtiene solo los detalles de una tabla específica
   * @param numeroTabla - Número de la tabla (ej: "12")
   * @returns Promise<TablaDetalleResponseDto[]> Lista de detalles de la tabla
   */
  async findDetallesByNumero(
    numeroTabla: string,
  ): Promise<TablaDetalleResponseDto[]> {
    const tabla = await this.tablaRepository.findOne({
      where: { numeroTabla, activo: true },
      relations: ['detalles'],
    });

    if (!tabla) {
      throw new NotFoundException(`No se encontró la tabla ${numeroTabla}`);
    }

    // Filtrar solo detalles activos
    const detallesActivos = tabla.detalles.filter((detalle) => detalle.activo);

    return plainToInstance(TablaDetalleResponseDto, detallesActivos, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Obtiene un detalle específico por código y número de tabla
   * @param numeroTabla - Número de la tabla (ej: "12")
   * @param codigo - Código del detalle (ej: "01")
   * @returns Promise<TablaDetalleResponseDto> Detalle específico
   */
  async findDetalleByCodigo(
    numeroTabla: string,
    codigo: string,
  ): Promise<TablaDetalleResponseDto> {
    const detalle = await this.tablaDetalleRepository.findOne({
      where: {
        tabla: { numeroTabla },
        codigo,
        activo: true,
      },
      relations: ['tabla'],
    });

    if (!detalle) {
      throw new NotFoundException(
        `No se encontró el detalle con código ${codigo} en la tabla ${numeroTabla}`,
      );
    }

    return plainToInstance(TablaDetalleResponseDto, detalle, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Verifica si existe una tabla específica
   * @param numeroTabla - Número de la tabla
   * @returns Promise<boolean> True si existe, false si no
   */
  async existeTabla(numeroTabla: string): Promise<boolean> {
    const count = await this.tablaRepository.count({
      where: { numeroTabla, activo: true },
    });
    return count > 0;
  }

  /**
   * Obtiene múltiples detalles por una lista de IDs (idTablaDetalle)
   * @param ids Lista de IDs de detalles
   * @returns Lista de detalles activos correspondientes
   */
  async findDetallesByIds(ids: number[]): Promise<TablaDetalleResponseDto[]> {
    if (!ids || ids.length === 0) {
      return [];
    }

    const detalles = await this.tablaDetalleRepository.find({
      where: { idTablaDetalle: In(ids), activo: true },
    });

    return plainToInstance(TablaDetalleResponseDto, detalles, {
      excludeExtraneousValues: true,
    });
  }
}
