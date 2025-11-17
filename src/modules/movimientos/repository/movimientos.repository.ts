import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Movimiento } from '../entities/movimiento.entity';
import { MovimientoDetalle } from '../entities/movimiento-detalle.entity';
import { DetalleSalida } from '../entities/detalle-salida.entity';
import { CreateMovimientoDto } from '../dto/create-movimiento.dto';
import { TipoMovimiento } from '../enum/tipo-movimiento.enum';
import { EstadoMovimiento } from '../enum/estado-movimiento.enum';
import { Producto } from '../../productos/entities/producto.entity';
import { Almacen } from 'src/modules/almacen/entities/almacen.entity';
import { Inventario, InventarioLote } from 'src/modules/inventario/entities';
import { Comprobante } from 'src/modules/comprobantes/entities/comprobante';
import { StockCalculationService } from 'src/modules/inventario/service/stock-calculation.service';
import { StockCacheService } from 'src/modules/inventario/service/stock-cache.service';

/**
 * Repositorio para encapsular la lógica de acceso a datos de movimientos
 */
@Injectable()
export class MovimientosRepository {
  constructor(
    @InjectRepository(Movimiento)
    private readonly movimientoRepository: Repository<Movimiento>,
    @InjectRepository(MovimientoDetalle)
    private readonly movimientoDetalleRepository: Repository<MovimientoDetalle>,
    @InjectRepository(DetalleSalida)
    private readonly detalleSalidaRepository: Repository<DetalleSalida>,
    @InjectRepository(Producto)
    private readonly productoRepository: Repository<Producto>,
    @InjectRepository(Almacen)
    private readonly almacenRepository: Repository<Almacen>,
    @InjectRepository(Inventario)
    private readonly inventarioRepository: Repository<Inventario>,
    @InjectRepository(InventarioLote)
    private readonly inventarioLoteRepository: Repository<InventarioLote>,
    private readonly dataSource: DataSource,
    private readonly stockCalculationService: StockCalculationService,
    private readonly stockCacheService: StockCacheService,
  ) {}

  /**
   * Crear un nuevo movimiento con sus detalles
   */
  async create(createMovimientoDto: CreateMovimientoDto): Promise<Movimiento> {
    return await this.dataSource.transaction(async (manager) => {
      return await this.createWithManager(createMovimientoDto, manager);
    });
  }

  /**
   * Crear un nuevo movimiento con sus detalles usando un EntityManager específico
   * Útil para transacciones anidadas
   */
  async createWithManager(
    createMovimientoDto: CreateMovimientoDto,
    manager: EntityManager,
  ): Promise<Movimiento> {
    // Resolver códigos de Tabla 12 (tipo operación) y Tabla 10 (tipo comprobante) desde el comprobante relacionado
    let codigoTabla12: string | undefined;
    let codigoTabla10: string | undefined;
    let numeroDocumento: string | undefined =
      createMovimientoDto.numeroDocumento;

    if (createMovimientoDto.idComprobante) {
      const comprobante = await manager.findOne(Comprobante, {
        where: { idComprobante: createMovimientoDto.idComprobante },
        relations: ['tipoOperacion', 'tipoComprobante'],
      });

      if (comprobante) {
        codigoTabla12 = comprobante.tipoOperacion?.codigo;
        codigoTabla10 = comprobante.tipoComprobante?.codigo;
        if (!numeroDocumento && comprobante.serie && comprobante.numero) {
          numeroDocumento = `${comprobante.serie}-${comprobante.numero}`;
        }
      }
    }

    // Crear el movimiento principal con códigos y número de documento resueltos
    const movimiento = manager.create(Movimiento, {
      tipo: createMovimientoDto.tipo,
      fecha: new Date(createMovimientoDto.fecha),
      numeroDocumento,
      observaciones: createMovimientoDto.observaciones,
      estado: createMovimientoDto.estado,
      idComprobante: createMovimientoDto.idComprobante,
      codigoTabla12,
      codigoTabla10,
    });

    const savedMovimiento = await manager.save(Movimiento, movimiento);

    // Crear los detalles
    const detalles: MovimientoDetalle[] = [];
    for (const detalle of createMovimientoDto.detalles) {
      const movimientoDetalle = manager.create(MovimientoDetalle, {
        idMovimiento: savedMovimiento.id,
        idInventario: detalle.idInventario,
        cantidad: detalle.cantidad,
        idLote: detalle.idLote,
      });

      const savedDetalle = await manager.save(
        MovimientoDetalle,
        movimientoDetalle,
      );
      detalles.push(savedDetalle);

      // Si hay detalles de salida, crearlos
      if (detalle.detallesSalida && detalle.detallesSalida.length > 0) {
        for (const detalleSalida of detalle.detallesSalida) {
          const detalleSalidaEntity = manager.create(DetalleSalida, {
            idMovimientoDetalle: savedDetalle.id,
            idLote: detalleSalida.idLote,
            costoUnitarioDeLote: detalleSalida.costoUnitarioDeLote,
            cantidad: detalleSalida.cantidad,
          });

          await manager.save(DetalleSalida, detalleSalidaEntity);
        }
      }
    }

    // Retornar el movimiento con sus detalles
    const result = await manager.findOne(Movimiento, {
      where: { id: savedMovimiento.id },
      relations: [
        'detalles',
        'detalles.inventario',
        'detalles.inventario.producto',
        'detalles.inventario.almacen',
        'detalles.detallesSalida',
        'comprobante',
      ],
    });

    if (!result) {
      throw new Error('Error al crear el movimiento');
    }

    return result;
  }

  /**
   * Buscar movimiento por ID
   */
  async findById(id: number): Promise<Movimiento | null> {
    return await this.movimientoRepository.findOne({
      where: { id },
      relations: [
        'detalles',
        'detalles.inventario',
        'detalles.inventario.producto',
        'detalles.inventario.almacen',
        'detalles.detallesSalida',
        'comprobante',
      ],
    });
  }

  /**
   * Buscar todos los movimientos
   */
  async findAll(personaId?: number): Promise<Movimiento[]> {
    const queryBuilder = this.movimientoRepository
      .createQueryBuilder('movimiento')
      .leftJoinAndSelect('movimiento.detalles', 'detalles')
      .leftJoinAndSelect('detalles.inventario', 'inventario')
      .leftJoinAndSelect('inventario.producto', 'producto')
      .leftJoinAndSelect('inventario.almacen', 'almacen')
      .leftJoinAndSelect('detalles.detallesSalida', 'detallesSalida')
      .leftJoinAndSelect('movimiento.comprobante', 'comprobante');

    if (personaId) {
      queryBuilder.andWhere('comprobante.id_persona = :personaId', {
        personaId,
      });
    }

    return await queryBuilder
      .orderBy('movimiento.fechaCreacion', 'DESC')
      .getMany();
  }

  /**
   * Buscar movimientos por tipo
   */
  async findByTipo(
    tipo: TipoMovimiento,
    personaId?: number,
  ): Promise<Movimiento[]> {
    const queryBuilder = this.movimientoRepository
      .createQueryBuilder('movimiento')
      .leftJoinAndSelect('movimiento.detalles', 'detalles')
      .leftJoinAndSelect('detalles.inventario', 'inventario')
      .leftJoinAndSelect('inventario.producto', 'producto')
      .leftJoinAndSelect('inventario.almacen', 'almacen')
      .leftJoinAndSelect('detalles.detallesSalida', 'detallesSalida')
      .leftJoinAndSelect('movimiento.comprobante', 'comprobante')
      .where('movimiento.tipo = :tipo', { tipo });

    if (personaId) {
      queryBuilder.andWhere('comprobante.id_persona = :personaId', {
        personaId,
      });
    }

    return await queryBuilder
      .orderBy('movimiento.fechaCreacion', 'DESC')
      .getMany();
  }

  /**
   * Buscar movimientos por estado
   */
  async findByEstado(
    estado: EstadoMovimiento,
    personaId?: number,
  ): Promise<Movimiento[]> {
    const queryBuilder = this.movimientoRepository
      .createQueryBuilder('movimiento')
      .leftJoinAndSelect('movimiento.detalles', 'detalles')
      .leftJoinAndSelect('detalles.inventario', 'inventario')
      .leftJoinAndSelect('inventario.producto', 'producto')
      .leftJoinAndSelect('inventario.almacen', 'almacen')
      .leftJoinAndSelect('detalles.detallesSalida', 'detallesSalida')
      .leftJoinAndSelect('movimiento.comprobante', 'comprobante')
      .where('movimiento.estado = :estado', { estado });

    if (personaId) {
      queryBuilder.andWhere('comprobante.id_persona = :personaId', {
        personaId,
      });
    }

    return await queryBuilder
      .orderBy('movimiento.fechaCreacion', 'DESC')
      .getMany();
  }

  /**
   * Buscar movimientos por comprobante
   */
  async findByComprobante(idComprobante: number): Promise<Movimiento[]> {
    return await this.movimientoRepository.find({
      where: { idComprobante },
      relations: [
        'detalles',
        'detalles.inventario',
        'detalles.inventario.producto',
        'detalles.inventario.almacen',
      ],
    });
  }

  /**
   * Actualizar estado del movimiento
   */
  async updateEstado(
    id: number,
    estado: EstadoMovimiento,
  ): Promise<Movimiento> {
    await this.movimientoRepository.update(id, { estado });
    const result = await this.findById(id);
    if (!result) {
      throw new Error('Movimiento no encontrado');
    }
    return result;
  }

  /**
   * Procesar movimiento (actualizar inventarios)
   */
  async procesarMovimiento(id: number): Promise<Movimiento> {
    return await this.dataSource.transaction(async (manager) => {
      const movimiento = await manager.findOne(Movimiento, {
        where: { id },
        relations: ['detalles'],
      });

      if (!movimiento) {
        throw new Error('Movimiento no encontrado');
      }

      // Procesar cada detalle
      for (const detalle of movimiento.detalles) {
        await this.procesarDetalleMovimiento(manager, detalle, movimiento.tipo);
      }

      // Actualizar estado
      await manager.update(Movimiento, id, {
        estado: EstadoMovimiento.PROCESADO,
      });

      const result = await manager.findOne(Movimiento, {
        where: { id },
        relations: [
          'detalles',
          'detalles.inventario',
          'detalles.inventario.producto',
          'detalles.inventario.almacen',
          'comprobante',
        ],
      });

      if (!result) {
        throw new Error('Error al procesar el movimiento');
      }

      return result;
    });
  }

  /**
   * Procesar detalle de movimiento
   */
  private async procesarDetalleMovimiento(
    manager: any,
    detalle: MovimientoDetalle,
    tipoMovimiento: TipoMovimiento,
  ): Promise<void> {
    // Buscar inventario
    const inventario = await manager.findOne(Inventario, {
      where: { id: detalle.idInventario },
    });

    if (!inventario) {
      throw new Error(
        `Inventario con ID ${detalle.idInventario} no encontrado`,
      );
    }

    // Actualizar stock según tipo de movimiento
    switch (tipoMovimiento) {
      case TipoMovimiento.ENTRADA:
        await this.procesarEntrada(manager, inventario, detalle);
        break;
      case TipoMovimiento.SALIDA:
        await this.procesarSalida(manager, inventario, detalle);
        break;
      case TipoMovimiento.AJUSTE:
        await this.procesarAjuste(manager, inventario, detalle);
        break;
    }
  }

  /**
   * Procesar entrada de inventario
   */
  private async procesarEntrada(
    manager: any,
    inventario: Inventario,
    detalle: MovimientoDetalle,
  ): Promise<void> {
    // Crear lote para la entrada
    const lote = manager.create(InventarioLote, {
      inventario: inventario,
      numeroLote: `LOTE-${Date.now()}`,
      fechaVencimiento: null,
      cantidadInicial: detalle.cantidad,
      fechaIngreso: new Date(),
    });
    await manager.save(InventarioLote, lote);

    // Invalidar caché para recálculo dinámico
    this.stockCacheService.invalidateInventario(inventario.id);
  }

  /**
   * Procesar salida de inventario
   */
  private async procesarSalida(
    manager: any,
    inventario: Inventario,
    detalle: MovimientoDetalle,
  ): Promise<void> {
    // Verificar stock disponible usando cálculo dinámico
    const stockDisponible =
      await this.stockCalculationService.calcularStockInventario(inventario.id);
    if (!stockDisponible || stockDisponible.stockActual < detalle.cantidad) {
      throw new Error(
        `Stock insuficiente. Disponible: ${stockDisponible?.stockActual || 0}, Requerido: ${detalle.cantidad}`,
      );
    }

    // Si se especifica un lote, verificar stock del lote
    if (detalle.idLote) {
      const lote = await manager.findOne(InventarioLote, {
        where: { id: detalle.idLote },
      });

      if (!lote) {
        throw new Error('Lote no encontrado');
      }

      const stockLote = await this.stockCalculationService.calcularStockLote(
        detalle.idLote,
      );
      if (!stockLote || stockLote.cantidadActual < detalle.cantidad) {
        throw new Error(
          `Stock insuficiente en el lote. Disponible: ${stockLote?.cantidadActual || 0}, Requerido: ${detalle.cantidad}`,
        );
      }
    }

    // Invalidar caché para recálculo dinámico
    this.stockCacheService.invalidateInventario(inventario.id);
    if (detalle.idLote) {
      this.stockCacheService.invalidateLote(detalle.idLote);
    }
  }

  /**
   * Procesar ajuste de inventario
   */
  private async procesarAjuste(
    manager: any,
    inventario: Inventario,
    detalle: MovimientoDetalle,
  ): Promise<void> {
    // Para ajustes, crear un lote de ajuste
    const lote = manager.create(InventarioLote, {
      inventario: inventario,
      numeroLote: `AJUSTE-${Date.now()}`,
      fechaVencimiento: null,
      cantidadInicial: detalle.cantidad,
      fechaIngreso: new Date(),
    });
    await manager.save(InventarioLote, lote);

    // Invalidar caché para recálculo dinámico
    this.stockCacheService.invalidateInventario(inventario.id);
  }

  /**
   * Buscar producto por ID
   */
  async findProductoById(id: number): Promise<Producto | null> {
    return await this.productoRepository.findOne({ where: { id } });
  }

  /**
   * Buscar almacén por ID
   */
  async findAlmacenById(id: number): Promise<Almacen | null> {
    return await this.almacenRepository.findOne({ where: { id } });
  }

  /**
   * Buscar lote por ID
   */
  async findLoteById(id: number): Promise<InventarioLote | null> {
    return await this.inventarioLoteRepository.findOne({
      where: { id },
    });
  }

  async findInventarioById(id: number): Promise<Inventario | null> {
    return await this.inventarioRepository.findOne({
      where: { id },
    });
  }

  /**
   * Eliminar movimiento
   */
  async remove(id: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // Eliminar detalles primero
      await manager.delete(MovimientoDetalle, { idMovimiento: id });
      // Eliminar movimiento
      await manager.delete(Movimiento, { id });
    });
  }
}
