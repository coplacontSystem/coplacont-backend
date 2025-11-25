import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import {
  CreateInventarioDto,
  UpdateInventarioDto,
  ResponseInventarioDto,
} from '../dto';
import { ResponseProductoDto } from 'src/modules/productos/dto/response-producto.dto';
import { InventarioRepository } from '../repository';
import { Inventario } from '../entities';
import { StockCalculationService } from './stock-calculation.service';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { MovimientoDetalle } from '../../movimientos/entities/movimiento-detalle.entity';
import { Movimiento } from '../../movimientos/entities/movimiento.entity';
import { TipoMovimiento } from '../../movimientos/enum/tipo-movimiento.enum';
import { EstadoMovimiento } from '../../movimientos/enum/estado-movimiento.enum';
import { InventarioLoteService } from './inventario-lote.service';
import { PeriodoContableService } from 'src/modules/periodos/service';
import { StockCacheService } from './stock-cache.service';
import { UpdateInventarioLoteDto } from '../dto/inventario-lote/update-inventario-lote.dto';

@Injectable()
export class InventarioService {
  constructor(
    private readonly inventarioRepository: InventarioRepository,
    private readonly stockCalculationService: StockCalculationService,
    @InjectRepository(MovimientoDetalle)
    private readonly movimientoDetalleRepository: Repository<MovimientoDetalle>,
    @InjectRepository(Movimiento)
    private readonly movimientoRepository: Repository<Movimiento>,
    private readonly inventarioLoteService: InventarioLoteService,
    private readonly periodoContableService: PeriodoContableService,
    private readonly stockCacheService: StockCacheService,
  ) {}

  private readonly logger = new Logger(InventarioService.name);

  /**
   * Obtiene la fecha hasta basada en el período contable activo del usuario
   * Si no se puede obtener el período, usa la fecha actual. Normaliza a fin de día (23:59:59.999).
   * @param personaId ID de la empresa
   * @returns Fecha hasta normalizada para cálculo de stock
   */
  private async getFechaHastaParaPersona(personaId?: number): Promise<Date> {
    try {
      if (typeof personaId === 'number') {
        const periodoActivo =
          await this.periodoContableService.obtenerPeriodoActivo(personaId);
        const fechaFin = new Date(periodoActivo.fechaFin);
        fechaFin.setHours(23, 59, 59, 999);
        return fechaFin;
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo obtener período activo para personaId=${personaId}; usando fecha actual; error=${error}`,
      );
    }
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);
    return hoy;
  }

  async create(
    createInventarioDto: CreateInventarioDto,
    personaId?: number,
  ): Promise<ResponseInventarioDto> {
    const { idAlmacen, idProducto, stockInicial, precioUnitario } =
      createInventarioDto;

    await this.validateAlmacenExists(idAlmacen);
    await this.validateProductoExists(idProducto);
    await this.validateInventarioNotExists(idAlmacen, idProducto);

    const almacen = await this.inventarioRepository.findAlmacenById(idAlmacen);
    const producto =
      await this.inventarioRepository.findProductoById(idProducto);

    const inventario = await this.inventarioRepository.create({
      almacen: almacen!,
      producto: producto!,
    });

    // Si se proporcionó stock inicial y precio, registrar lote de entrada
    if (
      stockInicial &&
      precioUnitario &&
      stockInicial > 0 &&
      precioUnitario > 0
    ) {
      let fechaIngresoStr = new Date().toISOString().split('T')[0];
      let fechaMovimientoDate = new Date();
      if (typeof personaId === 'number') {
        try {
          const periodoActivo =
            await this.periodoContableService.obtenerPeriodoActivo(personaId);
          console.log('ESTE ES EL PERIODO ACTIVO', periodoActivo);
          const year = Number(
            (periodoActivo as any)['año'] ??
              new Date(periodoActivo.fechaInicio).getFullYear(),
          );
          fechaIngresoStr = `${String(year).padStart(4, '0')}-01-01`;
          fechaMovimientoDate = new Date(year, 0, 1, 0, 0, 0, 0);
        } catch (error) {
          this.logger.warn(
            `No se pudo obtener período activo para personaId=${personaId}; usando fecha actual,${error}`,
          );
        }
      }

      const lote = await this.inventarioLoteService.create({
        idInventario: inventario.id,
        fechaIngreso: fechaIngresoStr,
        cantidadInicial: stockInicial,
        costoUnitario: precioUnitario,
      });

      const movimiento = this.movimientoRepository.create({
        tipo: TipoMovimiento.ENTRADA,
        fecha: fechaMovimientoDate,
        numeroDocumento: 'INV-INIT',
        observaciones: 'Stock inicial de inventario',
        estado: EstadoMovimiento.PROCESADO,
        idComprobante: undefined,
      });
      const savedMovimiento = await this.movimientoRepository.save(movimiento);

      const detalle = this.movimientoDetalleRepository.create({
        idMovimiento: savedMovimiento.id,
        idInventario: inventario.id,
        idLote: lote.id,
        cantidad: stockInicial,
      });
      await this.movimientoDetalleRepository.save(detalle);
    }

    return this.mapToResponseDto(inventario);
  }

  /**
   * Obtiene todos los inventarios con stock calculado dinámicamente
   * El stock se calcula sumando todas las compras y restando todas las ventas
   * @param personaId - ID de la empresa (opcional, requerido para cálculo de stock)
   * @returns Promise<ResponseInventarioDto[]> Lista de inventarios con stock actual
   */
  async findAll(personaId?: number): Promise<ResponseInventarioDto[]> {
    const inventarios = await this.inventarioRepository.findAll(personaId);

    const inventariosWithStock = await Promise.all(
      inventarios.map(async (inventario) => {
        this.logger.log(
          `🔍 [STOCK-TRACE] Calculando stock para Inventario=${inventario.id} Producto=${inventario.producto?.nombre} Almacen=${inventario.almacen?.nombre}`,
        );
        const fechaHasta = await this.getFechaHastaParaPersona(personaId);
        const stockResult =
          await this.stockCalculationService.calcularStockInventario(
            inventario.id,
            fechaHasta,
          );
        const stockActual = stockResult?.stockActual ?? 0;
        this.logger.log(
          `✅ [STOCK-TRACE] Resultado Inventario=${inventario.id} Stock=${stockActual} CostoPromedio=${stockResult?.costoPromedioActual ?? 0} Lotes=${stockResult?.lotes?.length ?? 0}`,
        );
        return this.mapToResponseDto(inventario, stockActual);
      }),
    );

    return inventariosWithStock;
  }

  /**
   * Obtiene un inventario específico con stock calculado dinámicamente
   * @param id - ID del inventario
   * @param personaId - ID de la empresa (opcional, requerido para cálculo de stock)
   * @returns Promise<ResponseInventarioDto> Inventario con stock actual
   */
  async findOne(id: number): Promise<ResponseInventarioDto> {
    const inventario = await this.inventarioRepository.findById(id);
    if (!inventario) {
      throw new NotFoundException(`Inventario con ID ${id} no encontrado`);
    }

    this.logger.log(
      `🔍 [STOCK-TRACE] Calculando stock para Inventario=${inventario.id} Producto=${inventario.producto?.nombre} Almacen=${inventario.almacen?.nombre}`,
    );
    const stockResult =
      await this.stockCalculationService.calcularStockInventario(
        inventario.id,
        new Date(),
      );
    const stockActual = stockResult?.stockActual;
    this.logger.log(
      `✅ [STOCK-TRACE] Resultado Inventario=${inventario.id} Stock=${stockActual ?? 0} CostoPromedio=${stockResult?.costoPromedioActual ?? 0} Lotes=${stockResult?.lotes?.length ?? 0}`,
    );
    return this.mapToResponseDto(inventario, stockActual);
  }

  async findByAlmacen(
    idAlmacen: number,
    personaId?: number,
  ): Promise<ResponseInventarioDto[]> {
    await this.validateAlmacenExists(idAlmacen);
    const inventarios = await this.inventarioRepository.findByAlmacen(
      idAlmacen,
      personaId,
    );
    const inventariosWithStock = await Promise.all(
      inventarios.map(async (inventario) => {
        this.logger.log(
          `🔍 [STOCK-TRACE] Calculando stock para Inventario=${inventario.id} Producto=${inventario.producto?.nombre} Almacen=${inventario.almacen?.nombre}`,
        );
        const fechaHasta = await this.getFechaHastaParaPersona(personaId);
        const stockResult =
          await this.stockCalculationService.calcularStockInventario(
            inventario.id,
            fechaHasta,
          );
        const stockActual = stockResult?.stockActual ?? 0;
        this.logger.log(
          `✅ [STOCK-TRACE] Resultado Inventario=${inventario.id} Stock=${stockActual} CostoPromedio=${stockResult?.costoPromedioActual ?? 0} Lotes=${stockResult?.lotes?.length ?? 0}`,
        );
        return this.mapToResponseDto(inventario, stockActual);
      }),
    );
    return inventariosWithStock;
  }

  async findByProducto(
    idProducto: number,
    personaId?: number,
  ): Promise<ResponseInventarioDto[]> {
    await this.validateProductoExists(idProducto);
    const inventarios = await this.inventarioRepository.findByProducto(
      idProducto,
      personaId,
    );
    const inventariosWithStock = await Promise.all(
      inventarios.map(async (inventario) => {
        this.logger.log(
          `🔍 [STOCK-TRACE] Calculando stock para Inventario=${inventario.id} Producto=${inventario.producto?.nombre} Almacen=${inventario.almacen?.nombre}`,
        );
        const fechaHasta = await this.getFechaHastaParaPersona(personaId);
        const stockResult =
          await this.stockCalculationService.calcularStockInventario(
            inventario.id,
            fechaHasta,
          );
        const stockActual = stockResult?.stockActual ?? 0;
        this.logger.log(
          `✅ [STOCK-TRACE] Resultado Inventario=${inventario.id} Stock=${stockActual} CostoPromedio=${stockResult?.costoPromedioActual ?? 0} Lotes=${stockResult?.lotes?.length ?? 0}`,
        );
        return this.mapToResponseDto(inventario, stockActual);
      }),
    );
    return inventariosWithStock;
  }

  /**
   * Obtiene la información del inventario inicial (lote y movimiento) para un inventario
   * Incluye cantidad y precio del lote inicial y el detalle de movimiento asociado (INV-INIT)
   */
  async getInventarioInicial(idInventario: number): Promise<{
    lote: {
      id: number;
      fechaIngreso: Date;
      cantidadInicial: number;
      costoUnitario: number;
    } | null;
    movimiento: { id: number; fecha: Date; numeroDocumento: string } | null;
    detalle: { id: number; cantidad: number } | null;
  }> {
    const detalle = await this.movimientoDetalleRepository
      .createQueryBuilder('detalle')
      .leftJoinAndSelect('detalle.movimiento', 'movimiento')
      .where('detalle.idInventario = :idInventario', { idInventario })
      .andWhere('movimiento.numeroDocumento = :doc', { doc: 'INV-INIT' })
      .getOne();

    if (!detalle) {
      return { lote: null, movimiento: null, detalle: null };
    }

    const movimiento = detalle.movimiento;
    let lote = null as {
      id: number;
      fechaIngreso: Date;
      cantidadInicial: number;
      costoUnitario: number;
    } | null;
    if (detalle.idLote) {
      const l = await this.inventarioLoteService.findOne(detalle.idLote);
      lote = {
        id: l.id,
        fechaIngreso: l.fechaIngreso,
        cantidadInicial: Number(l.cantidadInicial),
        costoUnitario: Number(l.costoUnitario),
      };
    }

    return {
      lote,
      movimiento: movimiento
        ? {
            id: movimiento.id,
            fecha: movimiento.fecha,
            numeroDocumento: movimiento.numeroDocumento,
          }
        : null,
      detalle: { id: detalle.id, cantidad: Number(detalle.cantidad) },
    };
  }

  /**
   * Actualiza el inventario inicial (cantidad y/o precio) sincronizando lote y detalle de movimiento
   * Solo afecta el movimiento "INV-INIT" asociado al inventario
   */
  async updateInventarioInicial(
    idInventario: number,
    data: { cantidadInicial?: number; costoUnitario?: number },
  ): Promise<{
    lote: {
      id: number;
      fechaIngreso: Date;
      cantidadInicial: number;
      costoUnitario: number;
    } | null;
    movimiento: { id: number; fecha: Date; numeroDocumento: string } | null;
    detalle: { id: number; cantidad: number } | null;
  }> {
    const detalle = await this.movimientoDetalleRepository
      .createQueryBuilder('detalle')
      .leftJoinAndSelect('detalle.movimiento', 'movimiento')
      .where('detalle.idInventario = :idInventario', { idInventario })
      .andWhere('movimiento.numeroDocumento = :doc', { doc: 'INV-INIT' })
      .getOne();

    if (!detalle) {
      throw new NotFoundException(
        'No se encontró movimiento de inventario inicial (INV-INIT) para este inventario',
      );
    }

    let updatedLote = null as {
      id: number;
      fechaIngreso: Date;
      cantidadInicial: number;
      costoUnitario: number;
    } | null;

    if (detalle.idLote) {
      const updateDto: UpdateInventarioLoteDto = {};
      if (typeof data.cantidadInicial === 'number') {
        updateDto.cantidadInicial = data.cantidadInicial;
      }
      if (typeof data.costoUnitario === 'number') {
        updateDto.costoUnitario = data.costoUnitario;
      }
      if (Object.keys(updateDto).length > 0) {
        const lote = await this.inventarioLoteService.update(
          detalle.idLote,
          updateDto,
        );
        updatedLote = {
          id: lote.id,
          fechaIngreso: lote.fechaIngreso,
          cantidadInicial: Number(lote.cantidadInicial),
          costoUnitario: Number(lote.costoUnitario),
        };
      } else {
        const lote = await this.inventarioLoteService.findOne(detalle.idLote);
        updatedLote = {
          id: lote.id,
          fechaIngreso: lote.fechaIngreso,
          cantidadInicial: Number(lote.cantidadInicial),
          costoUnitario: Number(lote.costoUnitario),
        };
      }
    }

    if (typeof data.cantidadInicial === 'number') {
      detalle.cantidad = data.cantidadInicial;
      await this.movimientoDetalleRepository.save(detalle);
    }

    // Invalidar caché de stock para reflejar el cambio
    this.stockCacheService.invalidateInventario(idInventario);

    const movimiento = detalle.movimiento;
    return {
      lote: updatedLote,
      movimiento: movimiento
        ? {
            id: movimiento.id,
            fecha: movimiento.fecha,
            numeroDocumento: movimiento.numeroDocumento,
          }
        : null,
      detalle: { id: detalle.id, cantidad: Number(detalle.cantidad) },
    };
  }

  /**
   * Obtiene inventarios de dos almacenes filtrando por productos comunes entre ambos
   * @param idAlmacen1 - ID del primer almacén
   * @param idAlmacen2 - ID del segundo almacén
   * @param personaId - ID de la empresa (opcional, usado para cálculo de stock y filtro)
   * @returns Lista de inventarios de ambos almacenes, solo para productos presentes en ambos
   */
  async findCommonByAlmacenes(
    idAlmacen1: number,
    idAlmacen2: number,
    personaId?: number,
  ): Promise<ResponseProductoDto[]> {
    await this.validateAlmacenExists(idAlmacen1);
    await this.validateAlmacenExists(idAlmacen2);

    const [invAlm1, invAlm2] = await Promise.all([
      this.inventarioRepository.findByAlmacen(idAlmacen1, personaId),
      this.inventarioRepository.findByAlmacen(idAlmacen2, personaId),
    ]);

    const productosAlm1 = new Set(invAlm1.map((i) => i.producto.id));
    const productosAlm2 = new Set(invAlm2.map((i) => i.producto.id));
    const comunes = new Set(
      [...productosAlm1].filter((id) => productosAlm2.has(id)),
    );

    const productosMap = new Map<number, (typeof invAlm1)[0]['producto']>();
    for (const inv of invAlm1) {
      if (comunes.has(inv.producto.id))
        productosMap.set(inv.producto.id, inv.producto);
    }
    for (const inv of invAlm2) {
      if (comunes.has(inv.producto.id))
        productosMap.set(inv.producto.id, inv.producto);
    }

    const productosComunes = Array.from(productosMap.values());
    return productosComunes.map((producto) =>
      plainToInstance(ResponseProductoDto, producto, {
        excludeExtraneousValues: true,
      }),
    );
  }

  async findByAlmacenAndProducto(
    idAlmacen: number,
    idProducto: number,
  ): Promise<ResponseInventarioDto> {
    const inventario = await this.inventarioRepository.findByAlmacenAndProducto(
      idAlmacen,
      idProducto,
    );
    if (!inventario) {
      throw new NotFoundException(
        `No se encontró inventario para el producto ${idProducto} en el almacén ${idAlmacen}`,
      );
    }
    return this.mapToResponseDto(inventario);
  }

  async findLowStock(idAlmacen?: number): Promise<ResponseInventarioDto[]> {
    const inventarios = await this.inventarioRepository.findLowStock(idAlmacen);
    return inventarios.map((inventario) => this.mapToResponseDto(inventario));
  }

  async update(
    id: number,
    updateInventarioDto: UpdateInventarioDto,
  ): Promise<ResponseInventarioDto> {
    const inventario = await this.getInventarioById(id);
    const { idAlmacen, idProducto } = updateInventarioDto;

    await this.validateUpdateData(inventario, idAlmacen, idProducto, id);

    if (idAlmacen && idAlmacen !== inventario.almacen.id) {
      const almacen =
        await this.inventarioRepository.findAlmacenById(idAlmacen);
      inventario.almacen = almacen!;
    }

    if (idProducto && idProducto !== inventario.producto.id) {
      const producto =
        await this.inventarioRepository.findProductoById(idProducto);
      inventario.producto = producto!;
    }

    // stockActual ahora se calcula dinámicamente, no se actualiza directamente

    const updatedInventario =
      await this.inventarioRepository.update(inventario);
    return this.mapToResponseDto(updatedInventario);
  }

  async updateStock(
    id: number,
    cantidad: number,
  ): Promise<ResponseInventarioDto> {
    const inventario = await this.getInventarioById(id);

    // Calcular stock actual dinámicamente
    const stockResult =
      await this.stockCalculationService.calcularStockInventario(id);
    const stockActual = stockResult?.stockActual || 0;
    const nuevoStock = stockActual + cantidad;

    if (nuevoStock < 0) {
      throw new BadRequestException(
        `No hay suficiente stock. Stock actual: ${stockActual}, cantidad solicitada: ${Math.abs(cantidad)}`,
      );
    }

    // Nota: Con el nuevo sistema, el stock se actualiza a través de movimientos
    // Este método podría necesitar crear un movimiento de ajuste en lugar de actualizar directamente
    const updatedInventario =
      await this.inventarioRepository.update(inventario);
    return this.mapToResponseDto(updatedInventario);
  }

  async getResumenByAlmacen(idAlmacen: number): Promise<any> {
    const inventarios =
      await this.inventarioRepository.findByAlmacen(idAlmacen);

    const totalProductos = inventarios.length;

    // Calcular estadísticas usando stock dinámico
    let stockBajo = 0;
    let sinStock = 0;
    let valorTotal = 0;

    for (const inv of inventarios) {
      const stockResult =
        await this.stockCalculationService.calcularStockInventario(inv.id);
      const stockActual = stockResult?.stockActual || 0;

      if (stockActual <= inv.producto.stockMinimo) stockBajo++;
      if (stockActual === 0) sinStock++;
      valorTotal += stockActual * (inv.producto.precio || 0);
    }

    return {
      almacen: inventarios[0]?.almacen || null,
      totalProductos,
      stockBajo,
      sinStock,
      valorTotal: parseFloat(valorTotal.toFixed(2)),
    };
  }

  /**
   * Calcula el stock actual de un inventario basándose en compras y ventas
   * @param inventarioId - ID del inventario
   * @param personaId - ID de la empresa
   * @returns Promise<number> Stock actual calculado
   */
  async calculateStock(
    inventarioId: number,
    personaId: number,
  ): Promise<number> {
    // Obtener todas las entradas (ENTRADA) para este inventario
    const entradas = await this.movimientoDetalleRepository
      .createQueryBuilder('detalle')
      .leftJoin('detalle.movimiento', 'movimiento')
      .leftJoin('movimiento.comprobante', 'comprobante')
      .leftJoin('comprobante.persona', 'persona')
      .select('SUM(detalle.cantidad)', 'totalEntradas')
      .where('detalle.idInventario = :inventarioId', { inventarioId })
      .andWhere('movimiento.tipo = :tipoEntrada', {
        tipoEntrada: TipoMovimiento.ENTRADA,
      })
      .andWhere('persona.id = :personaId', { personaId })
      .getRawOne<{ totalEntradas: string | number | null }>();

    // Obtener todas las salidas (SALIDA) para este inventario
    const salidas = await this.movimientoDetalleRepository
      .createQueryBuilder('detalle')
      .leftJoin('detalle.movimiento', 'movimiento')
      .leftJoin('movimiento.comprobante', 'comprobante')
      .leftJoin('comprobante.persona', 'persona')
      .select('SUM(detalle.cantidad)', 'totalSalidas')
      .where('detalle.idInventario = :inventarioId', { inventarioId })
      .andWhere('movimiento.tipo = :tipoSalida', {
        tipoSalida: TipoMovimiento.SALIDA,
      })
      .andWhere('persona.id = :personaId', { personaId })
      .getRawOne<{ totalSalidas: string | number | null }>();

    // Obtener todos los ajustes para este inventario
    const ajustes = await this.movimientoDetalleRepository
      .createQueryBuilder('detalle')
      .leftJoin('detalle.movimiento', 'movimiento')
      .leftJoin('movimiento.comprobante', 'comprobante')
      .leftJoin('comprobante.persona', 'persona')
      .select('SUM(detalle.cantidad)', 'totalAjustes')
      .where('detalle.idInventario = :inventarioId', { inventarioId })
      .andWhere('movimiento.tipo = :tipoAjuste', {
        tipoAjuste: TipoMovimiento.AJUSTE,
      })
      .andWhere('persona.id = :personaId', { personaId })
      .getRawOne<{ totalAjustes: string | number | null }>();

    const totalEntradas = parseFloat(String(entradas?.totalEntradas ?? 0)) || 0;
    const totalSalidas = parseFloat(String(salidas?.totalSalidas ?? 0)) || 0;
    const totalAjustes = parseFloat(String(ajustes?.totalAjustes ?? 0)) || 0;

    // Stock = Entradas - Salidas + Ajustes
    return totalEntradas - totalSalidas + totalAjustes;
  }

  private async validateAlmacenExists(idAlmacen: number): Promise<void> {
    const almacen = await this.inventarioRepository.findAlmacenById(idAlmacen);
    if (!almacen) {
      throw new NotFoundException(
        `Almacén con ID ${idAlmacen} no encontrado o inactivo`,
      );
    }
  }

  private async validateProductoExists(idProducto: number): Promise<void> {
    const producto =
      await this.inventarioRepository.findProductoById(idProducto);
    if (!producto) {
      throw new NotFoundException(
        `Producto con ID ${idProducto} no encontrado o inactivo`,
      );
    }
  }

  private async validateInventarioNotExists(
    idAlmacen: number,
    idProducto: number,
  ): Promise<void> {
    const exists = await this.inventarioRepository.existsByAlmacenAndProducto(
      idAlmacen,
      idProducto,
    );
    if (exists) {
      throw new ConflictException(
        `Ya existe un registro de inventario para el producto ${idProducto} en el almacén ${idAlmacen}`,
      );
    }
  }

  private async getInventarioById(id: number): Promise<Inventario> {
    const inventario = await this.inventarioRepository.findById(id);
    if (!inventario) {
      throw new NotFoundException(`Inventario con ID ${id} no encontrado`);
    }
    return inventario;
  }

  private async validateUpdateData(
    inventario: Inventario,
    idAlmacen?: number,
    idProducto?: number,
    excludeId?: number,
  ): Promise<void> {
    if (idAlmacen && idAlmacen !== inventario.almacen.id) {
      await this.validateAlmacenExists(idAlmacen);
    }

    if (idProducto && idProducto !== inventario.producto.id) {
      await this.validateProductoExists(idProducto);
    }

    if (
      (idAlmacen && idAlmacen !== inventario.almacen.id) ||
      (idProducto && idProducto !== inventario.producto.id)
    ) {
      const finalAlmacenId = idAlmacen || inventario.almacen.id;
      const finalProductoId = idProducto || inventario.producto.id;

      const exists =
        await this.inventarioRepository.existsByAlmacenAndProductoExcludingId(
          finalAlmacenId,
          finalProductoId,
          excludeId!,
        );

      if (exists) {
        throw new ConflictException(
          'Ya existe un registro de inventario para esta combinación de almacén y producto',
        );
      }
    }
  }

  private validateStockValue(stock: number): void {
    if (stock < 0) {
      throw new BadRequestException('El stock no puede ser negativo');
    }
  }

  private mapToResponseDto(
    inventario: Inventario,
    stockActual?: number,
  ): ResponseInventarioDto {
    const dto = plainToInstance(ResponseInventarioDto, inventario, {
      excludeExtraneousValues: true,
    });

    // Agregar el stock calculado dinámicamente si se proporciona
    if (stockActual !== undefined) {
      dto.stockActual = stockActual;
    }

    return dto;
  }
}
