import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { MovimientosRepository } from '../repository/movimientos.repository';
import { CreateMovimientoDto } from '../dto/create-movimiento.dto';
import { ResponseMovimientoDto } from '../dto/response-movimiento.dto';
import { TipoMovimiento } from '../enum/tipo-movimiento.enum';
import { EstadoMovimiento } from '../enum/estado-movimiento.enum';

/**
 * Servicio para la gestión de movimientos de inventario
 */
@Injectable()
export class MovimientosService {
  private readonly logger = new Logger(MovimientosService.name);

  constructor(private readonly movimientosRepository: MovimientosRepository) {}

  /**
   * Crear un nuevo movimiento
   */
  async create(
    createMovimientoDto: CreateMovimientoDto,
  ): Promise<ResponseMovimientoDto> {
    // Validar que existan los productos y almacenes
    await this.validateDetalles(createMovimientoDto.detalles);

    // Crear el movimiento
    const movimiento =
      await this.movimientosRepository.create(createMovimientoDto);
    return this.mapToResponseDto(movimiento);
  }

  /**
   * Crear un nuevo movimiento usando un EntityManager específico
   * Útil para transacciones anidadas
   */
  async createWithManager(
    createMovimientoDto: CreateMovimientoDto,
    manager: any,
  ): Promise<ResponseMovimientoDto> {
    // Validar que existan los productos y almacenes
    await this.validateDetalles(createMovimientoDto.detalles);

    // Crear el movimiento usando el EntityManager proporcionado
    const movimiento = await this.movimientosRepository.createWithManager(
      createMovimientoDto,
      manager,
    );
    return this.mapToResponseDto(movimiento);
  }

  /**
   * Buscar todos los movimientos
   */
  async findAll(personaId?: number): Promise<ResponseMovimientoDto[]> {
    const movimientos = await this.movimientosRepository.findAll(personaId);
    return movimientos.map((movimiento) => this.mapToResponseDto(movimiento));
  }

  /**
   * Buscar movimiento por ID
   */
  async findOne(id: number): Promise<ResponseMovimientoDto> {
    const movimiento = await this.movimientosRepository.findById(id);
    if (!movimiento) {
      throw new NotFoundException(`Movimiento con ID ${id} no encontrado`);
    }
    return this.mapToResponseDto(movimiento);
  }

  /**
   * Buscar movimientos por tipo
   */
  async findByTipo(
    tipo: TipoMovimiento,
    personaId?: number,
  ): Promise<ResponseMovimientoDto[]> {
    const movimientos = await this.movimientosRepository.findByTipo(
      tipo,
      personaId,
    );
    return movimientos.map((movimiento) => this.mapToResponseDto(movimiento));
  }

  /**
   * Buscar movimientos por estado
   */
  async findByEstado(
    estado: EstadoMovimiento,
    personaId?: number,
  ): Promise<ResponseMovimientoDto[]> {
    const movimientos = await this.movimientosRepository.findByEstado(
      estado,
      personaId,
    );
    return movimientos.map((movimiento) => this.mapToResponseDto(movimiento));
  }

  /**
   * Buscar movimientos por comprobante
   */
  async findByComprobante(
    idComprobante: number,
  ): Promise<ResponseMovimientoDto[]> {
    const movimientos =
      await this.movimientosRepository.findByComprobante(idComprobante);
    return movimientos.map((movimiento) => this.mapToResponseDto(movimiento));
  }

  /**
   * Actualizar estado del movimiento
   */
  async updateEstado(
    id: number,
    estado: EstadoMovimiento,
  ): Promise<ResponseMovimientoDto> {
    const movimiento = await this.movimientosRepository.findById(id);
    if (!movimiento) {
      throw new NotFoundException(`Movimiento con ID ${id} no encontrado`);
    }

    const updatedMovimiento = await this.movimientosRepository.updateEstado(
      id,
      estado,
    );
    return this.mapToResponseDto(updatedMovimiento);
  }

  /**
   * Cancelar movimiento
   */
  async cancelarMovimiento(id: number): Promise<ResponseMovimientoDto> {
    const movimiento = await this.movimientosRepository.findById(id);
    if (!movimiento) {
      throw new NotFoundException(`Movimiento con ID ${id} no encontrado`);
    }

    if (movimiento.estado === EstadoMovimiento.PROCESADO) {
      throw new BadRequestException(
        'No se puede cancelar un movimiento ya procesado',
      );
    }

    const cancelledMovimiento = await this.movimientosRepository.updateEstado(
      id,
      EstadoMovimiento.CANCELADO,
    );
    return this.mapToResponseDto(cancelledMovimiento);
  }

  /**
   * Eliminar movimiento
   */
  async remove(id: number): Promise<void> {
    const movimiento = await this.movimientosRepository.findById(id);
    if (!movimiento) {
      throw new NotFoundException(`Movimiento con ID ${id} no encontrado`);
    }

    if (movimiento.estado === EstadoMovimiento.PROCESADO) {
      throw new BadRequestException(
        'No se puede eliminar un movimiento ya procesado',
      );
    }

    await this.movimientosRepository.remove(id);
  }

  /**
   * Validar que existan los inventarios en los detalles
   */
  private async validateDetalles(detalles: any[]): Promise<void> {
    for (const detalle of detalles) {
      // Validar inventario
      const inventario = await this.movimientosRepository.findInventarioById(
        detalle.idInventario,
      );
      if (!inventario) {
        throw new NotFoundException(
          `Inventario con ID ${detalle.idInventario} no encontrado`,
        );
      }

      // Validar lote si se especifica
      if (detalle.idLote) {
        const lote = await this.movimientosRepository.findLoteById(
          detalle.idLote,
        );
        if (!lote) {
          throw new NotFoundException(
            `Lote con ID ${detalle.idLote} no encontrado`,
          );
        }
      }
    }
  }

  /**
   * Mapear entidad a DTO de respuesta
   */
  private mapToResponseDto(movimiento: any): ResponseMovimientoDto {
    return plainToInstance(ResponseMovimientoDto, movimiento, {
      excludeExtraneousValues: true,
    });
  }
}
