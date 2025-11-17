import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, In } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { CreateTransferenciaDto } from '../dto/transferencia/create-transferencia.dto';
import { ResponseTransferenciaDto } from '../dto/transferencia/response-transferencia.dto';
import { ResponseComprobanteDto } from '../dto/comprobante/response-comprobante.dto';
import { Comprobante } from '../entities/comprobante';
import { TablaDetalle } from '../entities/tabla-detalle.entity';
import { Correlativo } from '../entities/correlativo';
import { ComprobanteDetalleService } from './comprobante-detalle.service';
import { PersonaService } from 'src/modules/users/services/person.service';
import { LoteCreationService } from 'src/modules/inventario/service/lote-creation.service';
import { PeriodoContableService } from 'src/modules/periodos/service';
import { MovimientosService } from 'src/modules/movimientos';
import { MovimientoFactory } from 'src/modules/movimientos/factory/MovimientoFactory';
import { Inventario } from 'src/modules/inventario/entities';
import { Almacen } from 'src/modules/almacen/entities/almacen.entity';
import { Producto } from 'src/modules/productos/entities/producto.entity';
import { CreateComprobanteDetalleDto } from '../dto/comprobante-detalle/create-comprobante-detalle.dto';

@Injectable()
export class TransferenciasService {
  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepository: Repository<Comprobante>,
    @InjectRepository(TablaDetalle)
    private readonly tablaDetalleRepository: Repository<TablaDetalle>,
    @InjectRepository(Correlativo)
    private readonly correlativoRepository: Repository<Correlativo>,
    private readonly comprobanteDetalleService: ComprobanteDetalleService,
    private readonly personaService: PersonaService,
    private readonly periodoContableService: PeriodoContableService,
    private readonly loteCreationService: LoteCreationService,
    private readonly movimientoService: MovimientosService,
    private readonly movimientoFactory: MovimientoFactory,
    private readonly dataSource: DataSource,
  ) {}

  async registerTransfer(
    dto: CreateTransferenciaDto,
    personaId: number,
  ): Promise<ResponseTransferenciaDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const periodoActivoDto =
        await this.periodoContableService.obtenerPeriodoActivo(personaId);
      const periodoActual = await this.periodoContableService.obtenerPorId(
        periodoActivoDto.id,
      );

      const fechaEmision = new Date(dto.fechaEmision);
      if (
        fechaEmision < new Date(periodoActual.fechaInicio) ||
        fechaEmision > new Date(periodoActual.fechaFin)
      ) {
        throw new Error(
          'Fecha de emision del comprobante no esta dentro del periodo contable de la persona',
        );
      }

      const persona = await this.personaService.findById(personaId);
      if (!persona) {
        throw new Error(`Persona con ID ${personaId} no encontrada`);
      }

      const metodoValoracion = (
        await this.periodoContableService.obtenerConfiguracion(personaId)
      ).metodoCalculoCosto;

      const tipoOperacionEntrada = await this.tablaDetalleRepository.findOne({
        where: { idTablaDetalle: 30 },
      });
      console.log('tipoOperacionEntrada', tipoOperacionEntrada);
      const tipoOperacionSalida = await this.tablaDetalleRepository.findOne({
        where: { idTablaDetalle: 31 },
      });
      console.log('tipoOperacionSalida', tipoOperacionSalida);
      const tipoComprobanteEspecial = await this.tablaDetalleRepository.findOne(
        { where: { idTablaDetalle: 29 } },
      );
      console.log('tipoComprobanteEspecial', tipoComprobanteEspecial);

      if (
        !tipoOperacionEntrada ||
        !tipoOperacionSalida ||
        !tipoComprobanteEspecial
      ) {
        throw new Error(
          'No se encontraron tipos de operación o comprobante para transferencia',
        );
      }

      const manager = queryRunner.manager;

      const inventariosOrigen = await this.mapInventarios(
        manager,
        dto.idAlmacenOrigen,
        dto.detalles,
      );
      const inventariosDestino = await this.mapInventarios(
        manager,
        dto.idAlmacenDestino,
        dto.detalles,
      );

      const correlativoSalida = await this.findOrCreateCorrelativo(
        manager,
        tipoOperacionSalida.idTablaDetalle,
        personaId,
      );
      correlativoSalida.ultimoNumero += 1;
      await manager.save(correlativoSalida);

      const fechaSalidaParsed = new Date(dto.fechaEmision);
      const ahoraSalida = new Date();
      const fechaEmisionSalida = new Date(
        fechaSalidaParsed.getUTCFullYear(),
        fechaSalidaParsed.getUTCMonth(),
        fechaSalidaParsed.getUTCDate(),
        ahoraSalida.getHours(),
        ahoraSalida.getMinutes(),
        ahoraSalida.getSeconds(),
        ahoraSalida.getMilliseconds(),
      );
      const comprobanteSalida = manager.create(Comprobante, {
        fechaEmision: fechaEmisionSalida,
        moneda: dto.moneda,
        tipoCambio: dto.tipoCambio,
        serie: dto.serie,
        numero: dto.numero,
        fechaVencimiento: dto.fechaVencimiento,
      });
      comprobanteSalida.periodoContable = periodoActual;
      comprobanteSalida.persona = persona;
      comprobanteSalida.tipoOperacion = tipoOperacionSalida;
      comprobanteSalida.tipoComprobante = tipoComprobanteEspecial;
      comprobanteSalida.correlativo = `CORR-${correlativoSalida.ultimoNumero}`;

      const comprobanteSalidaSaved = await manager.save(comprobanteSalida);

      const detallesSalida: CreateComprobanteDetalleDto[] = dto.detalles.map(
        (d, i) => {
          const inv = inventariosOrigen[i];
          const unidad = (inv.producto?.unidadMedida || 'UND')
            .toString()
            .trim()
            .slice(0, 10);
          const descripcion = (
            d.descripcion?.trim() || 'Transferencia entre almacenes - SALIDA'
          ).slice(0, 255);
          return {
            idInventario: inv.id,
            cantidad: d.cantidad,
            unidadMedida: unidad,
            precioUnitario: 0,
            subtotal: 0,
            igv: 0,
            isc: 0,
            total: 0,
            descripcion,
          } as CreateComprobanteDetalleDto;
        },
      );

      const detallesSalidaSaved = await this.comprobanteDetalleService.register(
        comprobanteSalidaSaved.idComprobante,
        detallesSalida,
        manager,
      );

      const procesadoSalida =
        await this.loteCreationService.procesarLotesComprobante(
          detallesSalidaSaved,
          tipoOperacionSalida.descripcion,
          metodoValoracion,
          fechaEmision,
        );

      const comprobanteSalidaConRel = await manager.findOne(Comprobante, {
        where: { idComprobante: comprobanteSalidaSaved.idComprobante },
        relations: [
          'tipoOperacion',
          'tipoComprobante',
          'detalles',
          'detalles.inventario',
          'detalles.inventario.producto',
        ],
      });

      if (!comprobanteSalidaConRel) {
        throw new Error('Error al cargar comprobante de salida');
      }

      const movimientoSalidaDto =
        this.movimientoFactory.createMovimientoFromComprobante(
          comprobanteSalidaConRel,
          procesadoSalida.costoUnitario,
          procesadoSalida.lotes,
        );
      await this.movimientoService.createWithManager(
        movimientoSalidaDto,
        manager,
      );

      const correlativoEntrada = await this.findOrCreateCorrelativo(
        manager,
        tipoOperacionEntrada.idTablaDetalle,
        personaId,
      );
      correlativoEntrada.ultimoNumero += 1;
      await manager.save(correlativoEntrada);

      const fechaEntradaParsed = new Date(dto.fechaEmision);
      const ahoraEntrada = new Date();
      const fechaEmisionEntrada = new Date(
        fechaEntradaParsed.getUTCFullYear(),
        fechaEntradaParsed.getUTCMonth(),
        fechaEntradaParsed.getUTCDate(),
        ahoraEntrada.getHours(),
        ahoraEntrada.getMinutes(),
        ahoraEntrada.getSeconds(),
        ahoraEntrada.getMilliseconds(),
      );
      const comprobanteEntrada = manager.create(Comprobante, {
        fechaEmision: fechaEmisionEntrada,
        moneda: dto.moneda,
        tipoCambio: dto.tipoCambio,
        serie: dto.serie,
        numero: dto.numero,
        fechaVencimiento: dto.fechaVencimiento,
      });
      comprobanteEntrada.periodoContable = periodoActual;
      comprobanteEntrada.persona = persona;
      comprobanteEntrada.tipoOperacion = tipoOperacionEntrada;
      comprobanteEntrada.tipoComprobante = tipoComprobanteEspecial;
      comprobanteEntrada.correlativo = `CORR-${correlativoEntrada.ultimoNumero}`;

      const comprobanteEntradaSaved = await manager.save(comprobanteEntrada);

      const costosUnitariosEntrada = procesadoSalida.costoUnitario;
      const detallesEntrada: CreateComprobanteDetalleDto[] = dto.detalles.map(
        (d, i) => {
          const inv = inventariosDestino[i];
          const precioUnit = Number(costosUnitariosEntrada[i] || 0);
          const subtotal = Number((precioUnit * d.cantidad).toFixed(8));
          const unidad = (inv.producto?.unidadMedida || 'UND')
            .toString()
            .trim()
            .slice(0, 10);
          const descripcion = (
            d.descripcion?.trim() || 'Transferencia entre almacenes - ENTRADA'
          ).slice(0, 255);
          return {
            idInventario: inv.id,
            cantidad: d.cantidad,
            unidadMedida: unidad,
            precioUnitario: precioUnit,
            subtotal,
            igv: 0,
            isc: 0,
            total: subtotal,
            descripcion,
          } as CreateComprobanteDetalleDto;
        },
      );

      const detallesEntradaSaved =
        await this.comprobanteDetalleService.register(
          comprobanteEntradaSaved.idComprobante,
          detallesEntrada,
          manager,
        );

      const procesadoEntrada =
        await this.loteCreationService.procesarLotesComprobante(
          detallesEntradaSaved,
          'COMPRA',
          metodoValoracion,
          fechaEmision,
        );

      const comprobanteEntradaConRel = await manager.findOne(Comprobante, {
        where: { idComprobante: comprobanteEntradaSaved.idComprobante },
        relations: [
          'tipoOperacion',
          'tipoComprobante',
          'detalles',
          'detalles.inventario',
          'detalles.inventario.producto',
        ],
      });

      if (!comprobanteEntradaConRel) {
        throw new Error('Error al cargar comprobante de entrada');
      }

      const movimientoEntradaDto =
        this.movimientoFactory.createMovimientoFromComprobante(
          comprobanteEntradaConRel,
          procesadoEntrada.costoUnitario,
          procesadoEntrada.lotes,
        );
      await this.movimientoService.createWithManager(
        movimientoEntradaDto,
        manager,
      );

      await queryRunner.commitTransaction();

      const salidaWithRelations = await this.comprobanteRepository.findOne({
        where: { idComprobante: comprobanteSalidaSaved.idComprobante },
        relations: [
          'totales',
          'persona',
          'entidad',
          'tipoOperacion',
          'tipoComprobante',
          'detalles',
          'detalles.inventario',
          'detalles.inventario.producto',
        ],
      });
      const entradaWithRelations = await this.comprobanteRepository.findOne({
        where: { idComprobante: comprobanteEntradaSaved.idComprobante },
        relations: [
          'totales',
          'persona',
          'entidad',
          'tipoOperacion',
          'tipoComprobante',
          'detalles',
          'detalles.inventario',
          'detalles.inventario.producto',
        ],
      });

      if (!salidaWithRelations || !entradaWithRelations) {
        throw new Error('Error al cargar comprobantes creados');
      }

      const response: ResponseTransferenciaDto = plainToInstance(
        ResponseTransferenciaDto,
        {
          comprobanteSalida: plainToInstance(
            ResponseComprobanteDto,
            salidaWithRelations,
            { excludeExtraneousValues: true },
          ),
          comprobanteEntrada: plainToInstance(
            ResponseComprobanteDto,
            entradaWithRelations,
            { excludeExtraneousValues: true },
          ),
        },
        { excludeExtraneousValues: true },
      );

      return response;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async findOrCreateCorrelativo(
    manager: EntityManager,
    idTipoOperacion: number,
    personaId: number,
  ): Promise<Correlativo> {
    const repository = manager.getRepository(Correlativo);
    const queryBuilder = repository
      .createQueryBuilder('c')
      .setLock('pessimistic_write');
    let correlativo = await queryBuilder
      .where('c.tipo = :tipo AND c.personaId = :personaId', {
        tipo: idTipoOperacion.toString(),
        personaId,
      })
      .getOne();

    if (!correlativo) {
      correlativo = repository.create({
        tipo: idTipoOperacion.toString(),
        personaId,
        ultimoNumero: 0,
      });
      await repository.save(correlativo);
    }
    return correlativo;
  }

  private async mapInventarios(
    manager: EntityManager,
    idAlmacen: number,
    detalles: { idProducto: number; cantidad: number }[],
  ): Promise<Inventario[]> {
    const inventarioRepo = manager.getRepository(Inventario);
    const almacenRepo = manager.getRepository(Almacen);
    const productoRepo = manager.getRepository(Producto);

    const almacen = await almacenRepo.findOne({ where: { id: idAlmacen } });
    if (!almacen) {
      throw new Error(`Almacén no encontrado: ${idAlmacen}`);
    }

    const result: Inventario[] = [];

    for (const d of detalles) {
      const producto = await productoRepo.findOne({
        where: { id: d.idProducto },
      });
      if (!producto) {
        throw new Error(`Producto no encontrado: ${d.idProducto}`);
      }

      let inventario = await inventarioRepo.findOne({
        where: { almacen: { id: idAlmacen }, producto: { id: d.idProducto } },
        relations: ['almacen', 'producto'],
      });

      if (!inventario) {
        inventario = inventarioRepo.create({ almacen, producto });
        inventario = await inventarioRepo.save(inventario);
      }

      result.push(inventario);
    }

    return result;
  }

  async findAll(personaId: number): Promise<ResponseComprobanteDto[]> {
    const comprobantes = await this.comprobanteRepository.find({
      where: {
        persona: { id: personaId },
        tipoOperacion: { idTablaDetalle: In([29, 30]) },
      },
      relations: [
        'totales',
        'persona',
        'entidad',
        'tipoOperacion',
        'tipoComprobante',
        'detalles',
        'detalles.inventario',
        'detalles.inventario.producto',
      ],
      order: { fechaRegistro: 'DESC' },
    });
    return plainToInstance(ResponseComprobanteDto, comprobantes, {
      excludeExtraneousValues: true,
    });
  }
}
