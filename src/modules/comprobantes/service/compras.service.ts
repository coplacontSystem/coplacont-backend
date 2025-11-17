import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Comprobante } from '../entities/comprobante';
import { TablaDetalle } from '../entities/tabla-detalle.entity';
import { ResponseComprobanteDto } from '../dto/comprobante/response-comprobante.dto';

@Injectable()
export class ComprasService {
  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepository: Repository<Comprobante>,
    @InjectRepository(TablaDetalle)
    private readonly tablaDetalleRepository: Repository<TablaDetalle>,
  ) {}

  /**
   * Obtiene todos los comprobantes de tipo COMPRA filtrados por empresa
   * @param personaId ID de la empresa (Persona)
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes de compra
   */
  async findAll(personaId: number): Promise<ResponseComprobanteDto[]> {
    // Usar directamente el idTablaDetalle para COMPRA (13) de la Tabla 12
    const comprobantes = await this.comprobanteRepository.find({
      where: {
        tipoOperacion: { idTablaDetalle: 14 }, // ID 13 para COMPRA en Tabla 12
        persona: { id: personaId },
      },
      relations: [
        'totales',
        'persona',
        'detalles',
        'detalles.inventario',
        'entidad',
        'tipoOperacion',
        'tipoComprobante',
      ],
      order: { fechaRegistro: 'DESC' },
    });
    return plainToInstance(ResponseComprobanteDto, comprobantes, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Busca un comprobante de compra por su ID filtrado por empresa
   * @param id - ID del comprobante
   * @param personaId - ID de la empresa (Persona)
   * @returns Promise<ResponseComprobanteDto | null> Comprobante encontrado o null
   */
  async findById(
    id: number,
    personaId: number,
  ): Promise<ResponseComprobanteDto | null> {
    // Buscar el TablaDetalle para COMPRA (código "02")
    const tipoCompra = await this.tablaDetalleRepository.findOne({
      where: { codigo: '02' }, // Código "02" para COMPRA
    });

    if (!tipoCompra) {
      throw new Error(
        'No se encontró el tipo de operación COMPRA en la tabla de detalles',
      );
    }

    const comprobante = await this.comprobanteRepository.findOne({
      where: {
        idComprobante: id,
        tipoOperacion: { idTablaDetalle: tipoCompra.idTablaDetalle },
        persona: { id: personaId },
      },
      relations: [
        'totales',
        'persona',
        'detalles',
        'detalles.inventario',
        'entidad',
        'tipoOperacion',
        'tipoComprobante',
      ],
    });

    if (!comprobante) {
      return null;
    }

    return plainToInstance(ResponseComprobanteDto, comprobante, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Busca comprobantes de compra por rango de fechas filtrados por empresa
   * @param fechaInicio - Fecha de inicio del rango
   * @param fechaFin - Fecha de fin del rango
   * @param personaId - ID de la empresa (Persona)
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes en el rango
   */
  async findByDateRange(
    fechaInicio: Date,
    fechaFin: Date,
    personaId: number,
  ): Promise<ResponseComprobanteDto[]> {
    // Buscar el TablaDetalle para COMPRA (código "02")
    const tipoCompra = await this.tablaDetalleRepository.findOne({
      where: { codigo: '02' }, // Código "02" para COMPRA
    });

    if (!tipoCompra) {
      throw new Error(
        'No se encontró el tipo de operación COMPRA en la tabla de detalles',
      );
    }

    const comprobantes = await this.comprobanteRepository
      .createQueryBuilder('comprobante')
      .leftJoinAndSelect('comprobante.totales', 'totales')
      .leftJoinAndSelect('comprobante.persona', 'persona')
      .leftJoinAndSelect('comprobante.detalles', 'detalles')
      .leftJoinAndSelect('detalles.inventario', 'inventario')
      .leftJoinAndSelect('comprobante.tipoOperacion', 'tipoOperacion')
      .leftJoinAndSelect('comprobante.tipoComprobante', 'tipoComprobante')
      .where('comprobante.tipoOperacion.idTablaDetalle = :tipoId', {
        tipoId: tipoCompra.idTablaDetalle,
      })
      .andWhere('comprobante.fechaEmision >= :fechaInicio', { fechaInicio })
      .andWhere('comprobante.fechaEmision <= :fechaFin', { fechaFin })
      .andWhere('persona.id = :personaId', { personaId })
      .orderBy('comprobante.fechaRegistro', 'DESC')
      .getMany();

    return plainToInstance(ResponseComprobanteDto, comprobantes, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Busca comprobantes de compra por proveedor filtrados por empresa
   * @param proveedorId - ID del proveedor
   * @param personaId - ID de la empresa (Persona)
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes del proveedor
   */
  async findByProveedor(
    proveedorId: number,
    personaId: number,
  ): Promise<ResponseComprobanteDto[]> {
    // Buscar el TablaDetalle para COMPRA (código "02")
    const tipoCompra = await this.tablaDetalleRepository.findOne({
      where: { codigo: '02' }, // Código "02" para COMPRA
    });

    if (!tipoCompra) {
      throw new Error(
        'No se encontró el tipo de operación COMPRA en la tabla de detalles',
      );
    }

    const comprobantes = await this.comprobanteRepository
      .createQueryBuilder('comprobante')
      .leftJoinAndSelect('comprobante.totales', 'totales')
      .leftJoinAndSelect('comprobante.persona', 'persona')
      .leftJoinAndSelect('comprobante.entidad', 'entidad')
      .leftJoinAndSelect('comprobante.detalles', 'detalles')
      .leftJoinAndSelect('detalles.inventario', 'inventario')
      .leftJoinAndSelect('comprobante.tipoOperacion', 'tipoOperacion')
      .leftJoinAndSelect('comprobante.tipoComprobante', 'tipoComprobante')
      .where('comprobante.tipoOperacion.idTablaDetalle = :tipoId', {
        tipoId: tipoCompra.idTablaDetalle,
      })
      .andWhere('persona.id = :personaId', { personaId })
      .andWhere('entidad.id = :proveedorId', { proveedorId })
      .orderBy('comprobante.fechaRegistro', 'DESC')
      .getMany();

    return plainToInstance(ResponseComprobanteDto, comprobantes, {
      excludeExtraneousValues: true,
    });
  }
}
