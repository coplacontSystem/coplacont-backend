import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Comprobante } from '../entities/comprobante';
import { TablaDetalle } from '../entities/tabla-detalle.entity';
import { ResponseComprobanteDto } from '../dto/comprobante/response-comprobante.dto';
import { ResponseComprobanteWithDetallesDto } from '../dto/comprobante/response-comprobante-with-detalles.dto';

@Injectable()
export class VentasService {
  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepository: Repository<Comprobante>,
    @InjectRepository(TablaDetalle)
    private readonly tablaDetalleRepository: Repository<TablaDetalle>,
  ) {}

  /**
   * Obtiene todos los comprobantes de tipo VENTA filtrados por empresa
   * @param personaId - ID de la empresa
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes de venta
   */
  async findAll(personaId: number): Promise<ResponseComprobanteDto[]> {
    // Usar directamente el idTablaDetalle para VENTA (12) de la Tabla 12
    const comprobantes = await this.comprobanteRepository.find({
      where: {
        tipoOperacion: { idTablaDetalle: 13 }, // ID 13 para VENTA en Tabla 12
        persona: { id: personaId },
      },
      relations: [
        'totales',
        'persona',
        'detalles',
        'entidad',
        'tipoOperacion',
        'tipoComprobante',
      ],
      order: { fechaRegistro: 'DESC' },
    });

    console.log(comprobantes);

    return plainToInstance(ResponseComprobanteDto, comprobantes, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Busca un comprobante de venta por su ID filtrado por empresa
   * @param id - ID del comprobante
   * @param personaId - ID de la empresa
   * @returns Promise<ResponseComprobanteWithDetallesDto | null> Comprobante encontrado o null
   */
  async findById(
    id: number,
    personaId: number,
  ): Promise<ResponseComprobanteWithDetallesDto | null> {
    // Buscar el TablaDetalle para VENTA (código "01")
    const tipoVenta = await this.tablaDetalleRepository.findOne({
      where: { codigo: '01' }, // Código "01" para VENTA
    });

    if (!tipoVenta) {
      throw new Error(
        'No se encontró el tipo de operación VENTA en la tabla de detalles',
      );
    }

    const comprobante = await this.comprobanteRepository.findOne({
      where: {
        idComprobante: id,
        tipoOperacion: { idTablaDetalle: tipoVenta.idTablaDetalle },
        persona: { id: personaId },
      },
      relations: [
        'totales',
        'persona',
        'detalles',
        'detalles.producto',
        'entidad',
        'tipoOperacion',
        'tipoComprobante',
      ],
    });

    if (!comprobante) {
      return null;
    }

    return plainToInstance(ResponseComprobanteWithDetallesDto, comprobante, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Busca comprobantes de venta por rango de fechas filtrados por empresa
   * @param fechaInicio - Fecha de inicio del rango
   * @param fechaFin - Fecha de fin del rango
   * @param personaId - ID de la empresa
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes en el rango
   */
  async findByDateRange(
    fechaInicio: Date,
    fechaFin: Date,
    personaId: number,
  ): Promise<ResponseComprobanteDto[]> {
    // Buscar el TablaDetalle para VENTA (código "01")
    const tipoVenta = await this.tablaDetalleRepository.findOne({
      where: { codigo: '01' }, // Código "01" para VENTA
    });

    if (!tipoVenta) {
      throw new Error(
        'No se encontró el tipo de operación VENTA en la tabla de detalles',
      );
    }

    const comprobantes = await this.comprobanteRepository
      .createQueryBuilder('comprobante')
      .leftJoinAndSelect('comprobante.totales', 'totales')
      .leftJoinAndSelect('comprobante.persona', 'persona')
      .leftJoinAndSelect('comprobante.entidad', 'entidad')
      .leftJoinAndSelect('comprobante.detalles', 'detalles')
      .leftJoinAndSelect('comprobante.tipoOperacion', 'tipoOperacion')
      .leftJoinAndSelect('comprobante.tipoComprobante', 'tipoComprobante')
      .where('comprobante.tipoOperacion.idTablaDetalle = :tipoId', {
        tipoId: tipoVenta.idTablaDetalle,
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
   * Busca comprobantes de venta por cliente filtrados por empresa
   * @param clienteId - ID del cliente
   * @param personaId - ID de la empresa
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes del cliente
   */
  async findByCliente(
    clienteId: number,
    personaId: number,
  ): Promise<ResponseComprobanteDto[]> {
    // Buscar el TablaDetalle para VENTA (código "01")
    const tipoVenta = await this.tablaDetalleRepository.findOne({
      where: { codigo: '01' }, // Código "01" para VENTA
    });

    if (!tipoVenta) {
      throw new Error(
        'No se encontró el tipo de operación VENTA en la tabla de detalles',
      );
    }

    const comprobantes = await this.comprobanteRepository
      .createQueryBuilder('comprobante')
      .leftJoinAndSelect('comprobante.totales', 'totales')
      .leftJoinAndSelect('comprobante.persona', 'persona')
      .leftJoinAndSelect('comprobante.entidad', 'entidad')
      .leftJoinAndSelect('comprobante.detalles', 'detalles')
      .leftJoinAndSelect('comprobante.tipoOperacion', 'tipoOperacion')
      .leftJoinAndSelect('comprobante.tipoComprobante', 'tipoComprobante')
      .where('comprobante.tipoOperacion.idTablaDetalle = :tipoId', {
        tipoId: tipoVenta.idTablaDetalle,
      })
      .andWhere('entidad.id = :clienteId', { clienteId })
      .andWhere('persona.id = :personaId', { personaId })
      .getMany();

    return plainToInstance(ResponseComprobanteDto, comprobantes, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Obtiene el total de ventas en un rango de fechas filtrado por empresa
   * @param fechaInicio - Fecha de inicio del rango
   * @param fechaFin - Fecha de fin del rango
   * @param personaId - ID de la empresa
   * @returns Promise<number> Total de ventas en el período
   */
  async getTotalVentasByDateRange(
    fechaInicio: Date,
    fechaFin: Date,
    personaId: number,
  ): Promise<number> {
    // Buscar el TablaDetalle para VENTA (código "01")
    const tipoVenta = await this.tablaDetalleRepository.findOne({
      where: { codigo: '01' }, // Código "01" para VENTA
    });

    if (!tipoVenta) {
      throw new Error(
        'No se encontró el tipo de operación VENTA en la tabla de detalles',
      );
    }

    const result = await this.comprobanteRepository
      .createQueryBuilder('comprobante')
      .leftJoin('comprobante.totales', 'totales')
      .leftJoin('comprobante.persona', 'persona')
      .leftJoin('comprobante.tipoOperacion', 'tipoOperacion')
      .select('SUM(totales.totalGeneral)', 'total')
      .where('tipoOperacion.idTablaDetalle = :tipoId', {
        tipoId: tipoVenta.idTablaDetalle,
      })
      .andWhere('comprobante.fechaEmision >= :fechaInicio', { fechaInicio })
      .andWhere('comprobante.fechaEmision <= :fechaFin', { fechaFin })
      .andWhere('persona.id = :personaId', { personaId })
      .getRawOne();

    return parseFloat(result.total) || 0;
  }
}
