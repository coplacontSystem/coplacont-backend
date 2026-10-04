import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventarioLote } from '../entities/inventario-lote.entity';
import { Inventario } from '../entities/inventario.entity';
import { CreateInventarioLoteDto } from '../dto/inventario-lote/create-inventario-lote.dto';
import { UpdateInventarioLoteDto } from '../dto/inventario-lote/update-inventario-lote.dto';
import { StockCalculationService } from './stock-calculation.service';
import { KardexMaterializadoService } from '../valoracion/kardex-materializado.service';

/**
 * Servicio para la gestión de lotes de inventario
 * Maneja las operaciones CRUD y lógica de negocio relacionada con los lotes
 */
@Injectable()
export class InventarioLoteService {
  constructor(
    @InjectRepository(InventarioLote)
    private readonly inventarioLoteRepository: Repository<InventarioLote>,
    @InjectRepository(Inventario)
    private readonly inventarioRepository: Repository<Inventario>,
    private readonly stockCalculationService: StockCalculationService,
    private readonly kardex: KardexMaterializadoService,
  ) {}

  /**
   * Crear un nuevo lote de inventario
   * @param createInventarioLoteDto - Datos para crear el lote
   * @returns Lote creado
   */
  async create(
    createInventarioLoteDto: CreateInventarioLoteDto,
  ): Promise<InventarioLote> {
    const {
      idInventario,
      fechaIngreso,
      fechaVencimiento,
      cantidadInicial,
      // cantidadActual se calcula dinámicamente
      costoUnitario,
      numeroLote,
      observaciones,
      estado,
    } = createInventarioLoteDto;

    // Verificar que el inventario existe
    const inventario = await this.inventarioRepository.findOne({
      where: { id: idInventario },
      relations: ['almacen', 'producto'],
    });
    if (!inventario) {
      throw new NotFoundException(
        `Inventario con ID ${idInventario} no encontrado`,
      );
    }

    // La cantidad actual se calcula dinámicamente, no se valida aquí

    // Validar fecha de vencimiento si se proporciona
    if (fechaVencimiento) {
      const fechaVenc = new Date(fechaVencimiento);
      const fechaIng = new Date(fechaIngreso);
      if (fechaVenc <= fechaIng) {
        throw new BadRequestException(
          'La fecha de vencimiento debe ser posterior a la fecha de ingreso',
        );
      }
    }

    // Crear el nuevo lote
    const lote = this.inventarioLoteRepository.create({
      fechaIngreso: new Date(fechaIngreso),
      fechaVencimiento: fechaVencimiento
        ? new Date(fechaVencimiento)
        : undefined,
      cantidadInicial,
      // cantidadActual se calcula dinámicamente
      costoUnitario,
      numeroLote,
      observaciones,
      estado,
      inventario,
    });

    const loteGuardado = await this.inventarioLoteRepository.save(lote);
    // Un lote con cantidad inicial entra al kardex en su fecha de ingreso
    await this.kardex.marcarPendiente([inventario.id]);

    return loteGuardado;
  }

  /**
   * Obtener todos los lotes
   * @returns Lista de lotes
   */
  async findAll(): Promise<InventarioLote[]> {
    return await this.inventarioLoteRepository.find({
      relations: ['inventario', 'inventario.almacen', 'inventario.producto'],
      order: { fechaCreacion: 'DESC' },
    });
  }

  /**
   * Obtener un lote por ID
   * @param id - ID del lote
   * @returns Lote encontrado
   */
  async findOne(id: number): Promise<InventarioLote> {
    const lote = await this.inventarioLoteRepository.findOne({
      where: { id },
      relations: [
        'inventario',
        'inventario.almacen',
        'inventario.producto',
        'inventario.producto.categoria',
      ],
    });

    if (!lote) {
      throw new NotFoundException(`Lote con ID ${id} no encontrado`);
    }

    return lote;
  }

  /**
   * Obtener lotes por inventario
   * @param idInventario - ID del inventario
   * @returns Lista de lotes del inventario
   */
  async findByInventario(idInventario: number): Promise<InventarioLote[]> {
    const inventario = await this.inventarioRepository.findOne({
      where: { id: idInventario },
    });
    if (!inventario) {
      throw new NotFoundException(
        `Inventario con ID ${idInventario} no encontrado`,
      );
    }

    return await this.inventarioLoteRepository.find({
      where: { inventario: { id: idInventario } },
      relations: ['inventario', 'inventario.almacen', 'inventario.producto'],
      order: { fechaIngreso: 'ASC' },
    });
  }

  /**
   * Obtener lotes activos (con cantidad > 0)
   * @param idInventario - ID del inventario (opcional)
   * @returns Lista de lotes activos
   */
  async findActiveLotes(idInventario?: number): Promise<InventarioLote[]> {
    const queryBuilder = this.inventarioLoteRepository
      .createQueryBuilder('lote')
      .leftJoinAndSelect('lote.inventario', 'inventario')
      .leftJoinAndSelect('inventario.almacen', 'almacen')
      .leftJoinAndSelect('inventario.producto', 'producto')
      .where('lote.cantidadActual > 0')
      .andWhere('lote.estado = :estado', { estado: true });

    if (idInventario) {
      queryBuilder.andWhere('inventario.id = :idInventario', { idInventario });
    }

    return await queryBuilder.orderBy('lote.fechaIngreso', 'ASC').getMany();
  }

  /**
   * Obtener lotes próximos a vencer
   * @param dias - Días de anticipación (por defecto 30)
   * @param idInventario - ID del inventario (opcional)
   * @returns Lista de lotes próximos a vencer
   */
  async findLotesProximosVencer(
    dias: number = 30,
    idInventario?: number,
  ): Promise<InventarioLote[]> {
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() + dias);

    const queryBuilder = this.inventarioLoteRepository
      .createQueryBuilder('lote')
      .leftJoinAndSelect('lote.inventario', 'inventario')
      .leftJoinAndSelect('inventario.almacen', 'almacen')
      .leftJoinAndSelect('inventario.producto', 'producto')
      .where('lote.fechaVencimiento IS NOT NULL')
      .andWhere('lote.fechaVencimiento <= :fechaLimite', { fechaLimite })
      .andWhere('lote.cantidadActual > 0')
      .andWhere('lote.estado = :estado', { estado: true });

    if (idInventario) {
      queryBuilder.andWhere('inventario.id = :idInventario', { idInventario });
    }

    return await queryBuilder.orderBy('lote.fechaVencimiento', 'ASC').getMany();
  }

  /**
   * Obtener lotes vencidos
   * @param idInventario - ID del inventario (opcional)
   * @returns Lista de lotes vencidos
   */
  async findLotesVencidos(idInventario?: number): Promise<InventarioLote[]> {
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999); // Final del día

    const queryBuilder = this.inventarioLoteRepository
      .createQueryBuilder('lote')
      .leftJoinAndSelect('lote.inventario', 'inventario')
      .leftJoinAndSelect('inventario.almacen', 'almacen')
      .leftJoinAndSelect('inventario.producto', 'producto')
      .where('lote.fechaVencimiento IS NOT NULL')
      .andWhere('lote.fechaVencimiento < :hoy', { hoy })
      .andWhere('lote.cantidadActual > 0')
      .andWhere('lote.estado = :estado', { estado: true });

    if (idInventario) {
      queryBuilder.andWhere('inventario.id = :idInventario', { idInventario });
    }

    return await queryBuilder.orderBy('lote.fechaVencimiento', 'ASC').getMany();
  }

  /**
   * Buscar lotes por número de lote
   * @param numeroLote - Número de lote a buscar
   * @returns Lista de lotes encontrados
   */
  async findByNumeroLote(numeroLote: string): Promise<InventarioLote[]> {
    return await this.inventarioLoteRepository.find({
      where: { numeroLote },
      relations: ['inventario', 'inventario.almacen', 'inventario.producto'],
      order: { fechaCreacion: 'DESC' },
    });
  }

  /**
   * Actualizar un lote
   * @param id - ID del lote
   * @param updateInventarioLoteDto - Datos para actualizar
   * @returns Lote actualizado
   */
  async update(
    id: number,
    updateInventarioLoteDto: UpdateInventarioLoteDto,
  ): Promise<InventarioLote> {
    const lote = await this.findOne(id);
    const {
      fechaIngreso,
      fechaVencimiento,
      cantidadInicial,
      // cantidadActual se calcula dinámicamente
      costoUnitario,
      numeroLote,
      observaciones,
      estado,
    } = updateInventarioLoteDto;

    // cantidadActual se calcula dinámicamente

    // Validaciones
    if (cantidadInicial !== undefined) {
      // Validación de cantidad inicial (cantidadActual se calcula dinámicamente)
      if (cantidadInicial < 0) {
        throw new BadRequestException(
          'La cantidad inicial no puede ser negativa',
        );
      }
    }

    if (fechaVencimiento && fechaIngreso) {
      const fechaVenc = new Date(fechaVencimiento);
      const fechaIng = new Date(fechaIngreso);
      if (fechaVenc <= fechaIng) {
        throw new BadRequestException(
          'La fecha de vencimiento debe ser posterior a la fecha de ingreso',
        );
      }
    } else if (fechaVencimiento && !fechaIngreso) {
      const fechaVenc = new Date(fechaVencimiento);
      if (fechaVenc <= lote.fechaIngreso) {
        throw new BadRequestException(
          'La fecha de vencimiento debe ser posterior a la fecha de ingreso',
        );
      }
    }

    // Actualizar campos
    if (fechaIngreso) lote.fechaIngreso = new Date(fechaIngreso);
    if (fechaVencimiento !== undefined) {
      lote.fechaVencimiento = fechaVencimiento
        ? new Date(fechaVencimiento)
        : undefined;
    }
    if (cantidadInicial !== undefined) lote.cantidadInicial = cantidadInicial;
    // cantidadActual se calcula dinámicamente, no se actualiza directamente
    if (costoUnitario !== undefined) lote.costoUnitario = costoUnitario;
    if (numeroLote !== undefined) lote.numeroLote = numeroLote;
    if (observaciones !== undefined) lote.observaciones = observaciones;
    if (estado !== undefined) lote.estado = estado;

    const loteActualizado = await this.inventarioLoteRepository.save(lote);
    // Cantidad, costo o fecha del lote cambian el kardex
    await this.kardex.marcarPendiente([lote.inventario.id]);

    return loteActualizado;
  }

  /**
   * Consumir cantidad de un lote (método FIFO)
   * @param idInventario - ID del inventario
   * @param cantidad - Cantidad a consumir
   * @returns Información del consumo realizado
   */
  async consumirStock(
    idInventario: number,
    cantidad: number,
  ): Promise<{
    lotes: any[];
    cantidadConsumida: number;
    costoPromedio: number;
  }> {
    if (cantidad <= 0) {
      throw new BadRequestException('La cantidad a consumir debe ser positiva');
    }

    // Obtener lotes activos ordenados por FIFO (primero en entrar, primero en salir)
    const lotes = await this.inventarioLoteRepository.find({
      where: {
        inventario: { id: idInventario },
        estado: true,
      },
      order: { fechaIngreso: 'ASC' },
      relations: ['inventario'],
    });

    if (lotes.length === 0) {
      throw new BadRequestException('No hay lotes disponibles para consumir');
    }

    let cantidadRestante = cantidad;
    let costoTotal = 0;
    let cantidadTotalConsumida = 0;
    const lotesAfectados: Array<{
      id: number;
      numeroLote?: string;
      cantidadConsumida: number;
      costoUnitario: number;
      costoTotal: number;
    }> = [];

    for (const lote of lotes) {
      if (cantidadRestante <= 0) break;

      // Calcular stock actual del lote dinámicamente
      const stockLote = await this.stockCalculationService.calcularStockLote(
        lote.id,
      );
      if (!stockLote) continue; // Si no hay stock, continuar con el siguiente lote
      const cantidadAConsumir = Math.min(
        cantidadRestante,
        stockLote.cantidadActual,
      );
      const costoLote = cantidadAConsumir * lote.costoUnitario;

      // El stock se actualiza a través de movimientos, no directamente en el lote

      // Registrar información del consumo
      lotesAfectados.push({
        id: lote.id,
        numeroLote: lote.numeroLote,
        cantidadConsumida: cantidadAConsumir,
        costoUnitario: lote.costoUnitario,
        costoTotal: costoLote,
      });

      cantidadRestante -= cantidadAConsumir;
      costoTotal += costoLote;
      cantidadTotalConsumida += cantidadAConsumir;
    }

    if (cantidadRestante > 0) {
      throw new BadRequestException(
        `No hay suficiente stock. Disponible: ${cantidadTotalConsumida}, Solicitado: ${cantidad}`,
      );
    }

    // El stock del inventario se calcula dinámicamente, no se actualiza directamente

    const costoPromedio =
      cantidadTotalConsumida > 0 ? costoTotal / cantidadTotalConsumida : 0;

    return {
      lotes: lotesAfectados,
      cantidadConsumida: cantidadTotalConsumida,
      costoPromedio: parseFloat(costoPromedio.toFixed(4)),
    };
  }

  /**
   * Eliminar un lote (soft delete)
   * @param id - ID del lote
   * @returns Resultado de la eliminación
   */
  async remove(id: number): Promise<{ message: string }> {
    const lote = await this.findOne(id);

    // Actualizar el stock del inventario restando la cantidad actual del lote
    // Calcular stock actual del lote dinámicamente
    // Stock del lote se calcula dinámicamente cuando se solicita

    // Soft delete: marcar como inactivo
    lote.estado = false;
    await this.inventarioLoteRepository.save(lote);

    // Nota: El stock del inventario se calcula dinámicamente, no necesita actualización directa

    return { message: `Lote con ID ${id} eliminado correctamente` };
  }

  /**
   * Obtener costo promedio ponderado de un inventario
   * @param idInventario - ID del inventario
   * @returns Costo promedio ponderado
   */
  async getCostoPromedioPonderado(idInventario: number): Promise<number> {
    const lotes = await this.inventarioLoteRepository.find({
      where: {
        inventario: { id: idInventario },
        estado: true,
      },
    });

    if (lotes.length === 0) {
      return 0;
    }

    let costoTotal = 0;
    let cantidadTotal = 0;

    for (const lote of lotes) {
      // Convertir strings a números para asegurar cálculos correctos
      // Calcular cantidad actual del lote dinámicamente
      const stockLote = await this.stockCalculationService.calcularStockLote(
        lote.id,
      );
      const cantidad = stockLote?.cantidadActual || 0;
      const costo = parseFloat(lote.costoUnitario.toString());

      costoTotal += cantidad * costo;
      cantidadTotal += cantidad;
    }
    console.log('Dentro de la funcion para promedio ponderado:', cantidadTotal);
    return cantidadTotal > 0
      ? parseFloat((costoTotal / cantidadTotal).toFixed(4))
      : 0;
  }
}
