import { listar, Pagina, PaginacionDto } from 'src/common/paginacion';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Repository, DataSource, Not, In, EntityManager } from 'typeorm';
import { Comprobante } from '../entities/comprobante';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateComprobanteDto } from '../dto/comprobante/create-comprobante.dto';
import { EntidadService } from 'src/modules/entidades/services';
import { ComprobanteDetalleService } from './comprobante-detalle.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ComprobanteTotalesService } from './comprobante-totales.service';
import { runInTransaction } from 'typeorm-transactional';
import { Moneda } from '../enum/tipo-moneda.enum';
import { TipoMovimiento } from 'src/modules/movimientos/enum/tipo-movimiento.enum';
import {
  bloquearInventarios,
  fechaContable,
  modoInventario,
  validarImportes,
  ymd,
  ymdContable,
} from './reglas-registro';
import { ResponseComprobanteDto } from '../dto/comprobante/response-comprobante.dto';
import { plainToInstance } from 'class-transformer';
import { TablaDetalle } from '../entities/tabla-detalle.entity';
import { Correlativo } from '../entities/correlativo';
import { MovimientosService } from 'src/modules/movimientos';
import { MovimientoFactory } from 'src/modules/movimientos/factory/MovimientoFactory';
import { LoteCreationService } from 'src/modules/inventario/service/lote-creation.service';
import { PeriodoContableService } from 'src/modules/periodos/service';
import { PersonaService } from 'src/modules/users/services/person.service';
import { PertenenciaService } from 'src/common/pertenencia.service';
import {
  CatalogoService,
  COMPROBANTE,
  OPERACION,
} from 'src/common/catalogo.service';
import { KardexMaterializadoService } from 'src/modules/inventario/valoracion/kardex-materializado.service';

@Injectable()
export class ComprobanteService implements OnModuleInit {
  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepository: Repository<Comprobante>,
    @InjectRepository(Correlativo)
    private readonly correlativoRepository: Repository<Correlativo>,
    @InjectRepository(TablaDetalle)
    private readonly tablaDetalleRepository: Repository<TablaDetalle>,
    private readonly comprobanteDetalleService: ComprobanteDetalleService,
    private readonly comprobanteTotalesService: ComprobanteTotalesService,
    private readonly personaService: PersonaService,
    private readonly entidadService: EntidadService,
    private readonly movimientoService: MovimientosService,
    private readonly movimientoFactory: MovimientoFactory,
    private readonly loteCreationService: LoteCreationService,
    private readonly periodoContableService: PeriodoContableService,
    private readonly dataSource: DataSource,
    private readonly pertenencia: PertenenciaService,
    private readonly catalogo: CatalogoService,
    private readonly kardex: KardexMaterializadoService,
  ) {}

  /**
   * Busca o crea un correlativo para una persona y tipo de operación específicos
   * @param idTipoOperacion - ID del tipo de operación en TablaDetalle
   * @param personaId - ID de la persona/empresa
   * @param manager - EntityManager de la transacción (opcional)
   * @returns Correlativo encontrado o creado
   */
  private async findOrCreateCorrelativo(
    idTipoOperacion: number,
    personaId: number,
    manager?: EntityManager,
  ) {
    // Validar que los parámetros requeridos no sean undefined o null
    if (idTipoOperacion === undefined || idTipoOperacion === null) {
      throw new Error(
        'idTipoOperacion es requerido y no puede ser undefined o null',
      );
    }
    if (personaId === undefined || personaId === null) {
      throw new Error('personaId es requerido y no puede ser undefined o null');
    }

    const repository: Repository<Correlativo> = manager
      ? manager.getRepository(Correlativo)
      : this.correlativoRepository;
    const queryBuilder = repository.createQueryBuilder('c');

    if (manager) {
      // Crea la fila si no existe sin chocar con otro registro concurrente,
      // y luego la bloquea hasta el fin de la transacción
      await manager.query(
        `INSERT INTO correlativos (tipo, "personaId", "ultimoNumero")
         VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
        [idTipoOperacion.toString(), personaId],
      );
      queryBuilder.setLock('pessimistic_write');
    }

    let correlativo = await queryBuilder
      .where('c.tipo = :tipo AND c.personaId = :personaId', {
        tipo: idTipoOperacion.toString(),
        personaId: personaId,
      })
      .getOne();

    if (!correlativo) {
      correlativo = repository.create({
        tipo: idTipoOperacion.toString(),
        personaId: personaId,
        ultimoNumero: 0,
      });
      await repository.save(correlativo);
    }
    return correlativo;
  }

  /**
   * Registra un comprobante con sus detalles, totales, lotes y movimiento de kardex.
   * Todo ocurre en una sola transacción: si algo falla no queda nada a medias.
   * Sin detalles (operaciones que no mueven inventario) se usa el campo `total`.
   */
  async register(
    dto: CreateComprobanteDto,
    personaId: number,
  ): Promise<ResponseComprobanteDto> {
    // Todo lo referenciado debe pertenecer a la empresa del usuario
    await this.pertenencia.entidades([dto.idPersona], personaId);
    await this.pertenencia.inventarios(
      (dto.detalles ?? []).map((d) => d.idInventario),
      personaId,
    );
    if (dto.idComprobanteAfecto) {
      await this.pertenencia.comprobantes([dto.idComprobanteAfecto], personaId);
    }
    if (this.existDetails(dto)) {
      validarImportes(dto.detalles!);
    }
    if (dto.moneda === Moneda.USD && !(Number(dto.tipoCambio) > 0)) {
      throw new BadRequestException(
        'El tipo de cambio es obligatorio para comprobantes en dólares',
      );
    }

    const idComprobante = await runInTransaction(() =>
      this.registrarEnTransaccion(dto, personaId),
    );

    const guardado = await this.comprobanteRepository.findOne({
      where: { idComprobante },
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
    return plainToInstance(ResponseComprobanteDto, guardado, {
      excludeExtraneousValues: true,
    });
  }

  /** Cuerpo transaccional de `register`. Devuelve el id del comprobante. */
  private async registrarEnTransaccion(
    dto: CreateComprobanteDto,
    personaId: number,
  ): Promise<number> {
    // Dentro de runInTransaction este manager (y los repositorios) usan la transacción
    const manager = this.dataSource.manager;

    // Período contable vigente
    const periodoActivoDto =
      await this.periodoContableService.obtenerPeriodoActivo(personaId);
    const periodo = await this.periodoContableService.obtenerPorId(
      periodoActivoDto.id,
    );
    const fecha = fechaContable(dto.fechaEmision);
    if (
      ymdContable(fecha) < ymd(periodo.fechaInicio) ||
      ymdContable(fecha) > ymd(periodo.fechaFin)
    ) {
      throw new BadRequestException({
        message:
          'La fecha de emisión del comprobante está fuera del período contable vigente',
        fechaEmision: ymdContable(fecha),
        periodo: {
          inicio: ymd(periodo.fechaInicio),
          fin: ymd(periodo.fechaFin),
        },
      });
    }
    const entidad = await this.entidadService.findEntity(dto.idPersona);
    const persona = await this.personaService.findById(personaId);

    // Tipo de operación de la Tabla 12 y tipo de comprobante de la Tabla 10
    const tipoOperacion = await this.tablaDetalleRepository.findOne({
      where: {
        idTablaDetalle: dto.idTipoOperacion,
        tabla: { numeroTabla: '12' },
      },
    });
    if (!tipoOperacion) {
      throw new BadRequestException(
        `Tipo de operación con ID ${dto.idTipoOperacion} no encontrado`,
      );
    }
    const tipoComprobante = await this.tablaDetalleRepository.findOne({
      where: {
        idTablaDetalle: dto.idTipoComprobante,
        tabla: { numeroTabla: '10' },
      },
    });
    if (!tipoComprobante) {
      throw new BadRequestException(
        `Tipo de comprobante con ID ${dto.idTipoComprobante} no encontrado`,
      );
    }

    // Un mismo documento (tipo, serie y número de la misma contraparte) no se registra dos veces
    const duplicado = await manager.findOne(Comprobante, {
      where: {
        persona: { id: personaId },
        entidad: { id: dto.idPersona },
        tipoOperacion: { idTablaDetalle: tipoOperacion.idTablaDetalle },
        tipoComprobante: { idTablaDetalle: tipoComprobante.idTablaDetalle },
        serie: dto.serie,
        numero: dto.numero,
      },
    });
    if (duplicado) {
      throw new ConflictException(
        `El comprobante ${dto.serie}-${dto.numero} ya está registrado (${duplicado.correlativo})`,
      );
    }

    // Comprobante afectado (notas de crédito/débito)
    let comprobanteAfecto: Comprobante | null = null;
    if (dto.idComprobanteAfecto) {
      comprobanteAfecto = await manager.findOne(Comprobante, {
        where: { idComprobante: dto.idComprobanteAfecto },
        relations: ['tipoOperacion'],
      });
    }

    const detalles = this.existDetails(dto) ? dto.detalles! : [];
    const modo =
      detalles.length > 0
        ? modoInventario(
            tipoOperacion.codigo,
            tipoComprobante.codigo,
            comprobanteAfecto?.tipoOperacion?.codigo,
          )
        : null;

    if (modo) {
      // Serializa los registros que tocan los mismos inventarios. El stock de
      // las salidas (en su fecha y después) lo valida el motor de valoración.
      await bloquearInventarios(
        manager,
        detalles.map((d) => d.idInventario),
      );
    }

    // Correlativo interno
    const correlativo = await this.findOrCreateCorrelativo(
      dto.idTipoOperacion,
      personaId,
      manager,
    );
    correlativo.ultimoNumero += 1;
    await manager.save(correlativo);

    const comprobante = manager.create(Comprobante, {
      fechaEmision: fecha,
      moneda: dto.moneda,
      tipoCambio: dto.tipoCambio,
      serie: dto.serie,
      numero: dto.numero,
      fechaVencimiento: dto.fechaVencimiento,
    });
    comprobante.periodoContable = periodo;
    comprobante.entidad = entidad;
    comprobante.persona = persona!;
    comprobante.tipoOperacion = tipoOperacion;
    comprobante.tipoComprobante = tipoComprobante;
    comprobante.correlativo = `CORR-${correlativo.ultimoNumero}`;
    if (comprobanteAfecto) comprobante.comprobanteAfecto = comprobanteAfecto;
    const guardado = await manager.save(comprobante);

    if (detalles.length === 0) {
      await this.comprobanteTotalesService.registerFromTotal(
        guardado.idComprobante,
        Number(dto.total ?? 0),
        manager,
      );
      return guardado.idComprobante;
    }

    const detallesGuardados = await this.comprobanteDetalleService.register(
      guardado.idComprobante,
      detalles,
      manager,
    );
    if (!modo) return guardado.idComprobante;

    // Lotes (entrada) o consumo de lotes (salida). El costo se guarda en soles.
    const factorCosto = dto.moneda === Moneda.USD ? Number(dto.tipoCambio) : 1;
    // Una devolución de venta reingresa al costo con que salió, no al precio
    const esDevolucionDeVenta =
      modo === 'ENTRADA' &&
      tipoComprobante.codigo === COMPROBANTE.NOTA_CREDITO &&
      comprobanteAfecto?.tipoOperacion?.codigo === OPERACION.VENTA;
    const costosEntrada = esDevolucionDeVenta
      ? await this.kardex.costoDeSalidaDe(
          comprobanteAfecto!.idComprobante,
          detalles.map((d) => d.idInventario),
        )
      : undefined;
    const { costoUnitario, lotes } =
      await this.loteCreationService.procesarLotesComprobante(
        detallesGuardados,
        modo,
        fecha,
        factorCosto,
        costosEntrada,
      );

    const conRelaciones = await manager.findOne(Comprobante, {
      where: { idComprobante: guardado.idComprobante },
      relations: [
        'tipoOperacion',
        'tipoComprobante',
        'detalles',
        'detalles.inventario',
        'detalles.inventario.producto',
      ],
    });
    const movimientoDto =
      this.movimientoFactory.createMovimientoFromComprobante(
        conRelaciones!,
        costoUnitario,
        lotes,
        modo === 'ENTRADA' ? TipoMovimiento.ENTRADA : TipoMovimiento.SALIDA,
      );
    await this.movimientoService.createWithManager(movimientoDto, manager);
    // Kardex materializado: recalcula desde el día del comprobante
    await this.kardex.recalcularDesde(
      detalles.map((d) => d.idInventario),
      ymdContable(fecha),
    );

    return guardado.idComprobante;
  }

  /**
   * Obtiene el siguiente correlativo para una persona y tipo de operación
   * @param idTipoOperacion - ID del tipo de operación en TablaDetalle
   * @param personaId - ID de la persona/empresa
   * @returns Siguiente correlativo disponible
   */
  async getNextCorrelativo(
    idTipoOperacion: number,
    personaId: number,
  ): Promise<{ correlativo: string }> {
    const correlativo = await this.findOrCreateCorrelativo(
      idTipoOperacion,
      personaId,
    );
    return { correlativo: `corr-${correlativo.ultimoNumero + 1}` };
  }

  /**
   * Obtiene todos los comprobantes registrados para la empresa del usuario,
   * excluyendo los tipos de operación COMPRA y VENTA.
   * Incluye totales, persona/entidad, tipos y detalles asociados.
   * Ordena por `fechaEmision` e `idComprobante` de forma descendente.
   *
   * @param personaId ID de la empresa (Persona) del usuario autenticado
   * @returns Lista de comprobantes de la empresa
   */
  async findAll(
    personaId: number,
    paginacion?: PaginacionDto,
  ): Promise<ResponseComprobanteDto[] | Pagina<ResponseComprobanteDto>> {
    return listar(
      this.comprobanteRepository,
      {
        where: {
          persona: { id: personaId },
          // Compras, ventas y transferencias tienen sus propios listados
          tipoOperacion: {
            idTablaDetalle: Not(
              In([
                await this.catalogo.operacion(OPERACION.VENTA),
                await this.catalogo.operacion(OPERACION.COMPRA),
                await this.catalogo.operacion(OPERACION.TRANSFERENCIA_INGRESO),
                await this.catalogo.operacion(OPERACION.TRANSFERENCIA_SALIDA),
              ]),
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
        ],
        order: { fechaEmision: 'DESC', idComprobante: 'DESC' },
      },
      paginacion,
      (filas) =>
        plainToInstance(ResponseComprobanteDto, filas, {
          excludeExtraneousValues: true,
        }),
    );
  }

  existDetails(createComprobanteDto: CreateComprobanteDto): boolean {
    return (
      createComprobanteDto.detalles !== undefined &&
      createComprobanteDto.detalles !== null &&
      Array.isArray(createComprobanteDto.detalles) &&
      createComprobanteDto.detalles.length > 0
    );
  }

  /**
   * Obtiene el período contable activo para una persona
   * @param personaId ID de la persona/empresa
   * @returns Período contable activo o null si no existe
   */
  async obtenerPeriodoActivo(personaId: number) {
    return await this.periodoContableService.obtenerPeriodoActivo(personaId);
  }

  async onModuleInit(): Promise<void> {
    // Backfill de fechaEmision nula usando fechaRegistro para evitar problemas de NOT NULL
    await this.comprobanteRepository
      .createQueryBuilder()
      .update(Comprobante)
      .set({ fechaEmision: () => '"fechaRegistro"' })
      .where('"fechaEmision" IS NULL')
      .execute();
  }
}
