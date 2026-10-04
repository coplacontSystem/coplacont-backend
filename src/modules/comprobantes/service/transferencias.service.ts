import { BadRequestException, Injectable } from '@nestjs/common';
import { runInTransaction } from 'typeorm-transactional';
import { TipoMovimiento } from 'src/modules/movimientos/enum/tipo-movimiento.enum';
import {
  bloquearInventarios,
  fechaContable,
  ymd,
  ymdContable,
} from './reglas-registro';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
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
import { PertenenciaService } from 'src/common/pertenencia.service';
import {
  CatalogoService,
  COMPROBANTE,
  OPERACION,
} from 'src/common/catalogo.service';
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
    private readonly pertenencia: PertenenciaService,
    private readonly catalogo: CatalogoService,
  ) {}

  async registerTransfer(
    dto: CreateTransferenciaDto,
    personaId: number,
  ): Promise<ResponseTransferenciaDto> {
    // Almacenes y productos deben pertenecer a la empresa del usuario
    await this.pertenencia.almacenes(
      [dto.idAlmacenOrigen, dto.idAlmacenDestino],
      personaId,
    );
    await this.pertenencia.productos(
      (dto.detalles ?? []).map((d) => d.idProducto),
      personaId,
    );

    // Todo en una transacción: salida del origen y entrada al destino o nada
    return runInTransaction(async () => {
      const periodoActivoDto =
        await this.periodoContableService.obtenerPeriodoActivo(personaId);
      const periodoActual = await this.periodoContableService.obtenerPorId(
        periodoActivoDto.id,
      );

      const fechaEmision = fechaContable(dto.fechaEmision);
      if (
        ymdContable(fechaEmision) < ymd(periodoActual.fechaInicio) ||
        ymdContable(fechaEmision) > ymd(periodoActual.fechaFin)
      ) {
        throw new BadRequestException(
          'La fecha de emisión está fuera del período contable vigente',
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
        where: {
          idTablaDetalle: await this.catalogo.operacion(
            OPERACION.TRANSFERENCIA_INGRESO,
          ),
        },
      });

      const tipoOperacionSalida = await this.tablaDetalleRepository.findOne({
        where: {
          idTablaDetalle: await this.catalogo.operacion(
            OPERACION.TRANSFERENCIA_SALIDA,
          ),
        },
      });

      const tipoComprobanteEspecial = await this.tablaDetalleRepository.findOne(
        {
          where: {
            idTablaDetalle: await this.catalogo.comprobante(
              COMPROBANTE.DOCUMENTO_INTERNO,
            ),
          },
        },
      );

      if (
        !tipoOperacionEntrada ||
        !tipoOperacionSalida ||
        !tipoComprobanteEspecial
      ) {
        throw new Error(
          'No se encontraron tipos de operación o comprobante para transferencia',
        );
      }

      // Dentro de runInTransaction este manager usa la transacción
      const manager = this.dataSource.manager;

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

      // Serializa con otros registros sobre los mismos inventarios. El stock
      // del origen (en la fecha y después) lo valida el motor al costear la salida.
      await bloquearInventarios(manager, [
        ...inventariosOrigen.map((i) => i.id),
        ...inventariosDestino.map((i) => i.id),
      ]);

      const correlativoSalida = await this.findOrCreateCorrelativo(
        manager,
        tipoOperacionSalida.idTablaDetalle,
        personaId,
      );
      correlativoSalida.ultimoNumero += 1;
      await manager.save(correlativoSalida);

      const fechaEmisionSalida = fechaEmision;
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
          'SALIDA',
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
          TipoMovimiento.SALIDA,
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

      const fechaEmisionEntrada = fechaEmision;
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
          'ENTRADA',
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
          TipoMovimiento.ENTRADA,
        );
      await this.movimientoService.createWithManager(
        movimientoEntradaDto,
        manager,
      );

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
    });
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
        // Una fila por transferencia: el comprobante de ingreso al almacén destino
        tipoOperacion: {
          idTablaDetalle: await this.catalogo.operacion(
            OPERACION.TRANSFERENCIA_INGRESO,
          ),
        },
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
