import { Injectable, OnModuleInit } from '@nestjs/common';
import { Repository, DataSource, Not, In, EntityManager } from 'typeorm';
import { Comprobante } from '../entities/comprobante';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateComprobanteDto } from '../dto/comprobante/create-comprobante.dto';
import { EntidadService } from 'src/modules/entidades/services';
import { ComprobanteDetalleService } from './comprobante-detalle.service';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ComprobanteTotalesService } from './comprobante-totales.service';
import { ResponseComprobanteDto } from '../dto/comprobante/response-comprobante.dto';
import { plainToInstance } from 'class-transformer';
import { TablaDetalle } from '../entities/tabla-detalle.entity';
import { Correlativo } from '../entities/correlativo';
import { MovimientosService } from 'src/modules/movimientos';
import { MovimientoFactory } from 'src/modules/movimientos/factory/MovimientoFactory';
import { LoteCreationService } from 'src/modules/inventario/service/lote-creation.service';
import { PeriodoContableService } from 'src/modules/periodos/service';
import { PersonaService } from 'src/modules/users/services/person.service';

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
   * Registra un nuevo comprobante con sus detalles y movimientos asociados
   * @param createComprobanteDto - Datos del comprobante a crear
   * @param personaId - ID de la persona/empresa propietaria
   */
  async register(
    createComprobanteDto: CreateComprobanteDto,
    personaId: number,
  ): Promise<ResponseComprobanteDto> {
    /**
     * Registra un comprobante. Si existen detalles, calcula y guarda totales a partir de ellos.
     * Si no existen detalles (operaciones distintas a venta/compra), registra los totales
     * usando el campo `total` proporcionado en el payload.
     */
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      //Verificar que comprobante este dentro del PERIODO
      const periodoActivoDto =
        await this.periodoContableService.obtenerPeriodoActivo(personaId);
      const periodoActicoDePersona =
        await this.periodoContableService.obtenerPorId(periodoActivoDto.id);

      const fechaEmisionParsed = new Date(createComprobanteDto.fechaEmision);
      const ahora = new Date();
      const fechaEmisionFinal = new Date(
        fechaEmisionParsed.getUTCFullYear(),
        fechaEmisionParsed.getUTCMonth(),
        fechaEmisionParsed.getUTCDate(),
        ahora.getHours(),
        ahora.getMinutes(),
        ahora.getSeconds(),
        ahora.getMilliseconds(),
      );

      if (
        fechaEmisionFinal < new Date(periodoActicoDePersona.fechaInicio) ||
        fechaEmisionFinal > new Date(periodoActicoDePersona.fechaFin)
      ) {
        throw new BadRequestException({
          message:
            'La fecha de emisión del comprobante está fuera del período contable vigente',
          fechaEmision: fechaEmisionFinal.toISOString(),
          periodo: {
            inicio: new Date(periodoActicoDePersona.fechaInicio).toISOString(),
            fin: new Date(periodoActicoDePersona.fechaFin).toISOString(),
          },
        });
      }

      // Obtener METODO DE VALUACION CONFIGURADO
      const configuracionPeriodo =
        await this.periodoContableService.obtenerConfiguracion(personaId);
      const metodoValoracionFinal = configuracionPeriodo.metodoCalculoCosto;

      // CLIENTE/PROVEEDOR relacionado al comprobante
      const entidad = await this.entidadService.findEntity(
        createComprobanteDto.idPersona,
      );

      // PERSONA quien crea el comprobante
      const persona = await this.personaService.findById(personaId);
      if (!persona) {
        throw new Error(`Persona con ID ${personaId} no encontrada`);
      }

      // Obtener las entidades TablaDetalle para las relaciones
      const tipoOperacion = await this.tablaDetalleRepository.findOne({
        where: { idTablaDetalle: createComprobanteDto.idTipoOperacion },
      });
      if (!tipoOperacion) {
        throw new Error(
          `Tipo de operación con ID ${createComprobanteDto.idTipoOperacion} no encontrado`,
        );
      }

      const tipoComprobante = await this.tablaDetalleRepository.findOne({
        where: { idTablaDetalle: createComprobanteDto.idTipoComprobante },
      });
      if (!tipoComprobante) {
        throw new Error(
          `Tipo de comprobante con ID ${createComprobanteDto.idTipoComprobante} no encontrado`,
        );
      }

      // Asignación de CORRELATIVO
      const correlativo = await this.findOrCreateCorrelativo(
        createComprobanteDto.idTipoOperacion,
        personaId,
        queryRunner.manager,
      );
      correlativo.ultimoNumero += 1;
      await queryRunner.manager.save(correlativo);

      // Si existe comprobante afecto (notas), cargarlo
      let comprobanteAfecto: Comprobante | null = null;
      if (createComprobanteDto.idComprobanteAfecto) {
        comprobanteAfecto = await this.comprobanteRepository.findOne({
          where: { idComprobante: createComprobanteDto.idComprobanteAfecto },
          relations: ['tipoOperacion'],
        });
      }

      // Crea instancia de COMPROBANTE
      const comprobante = queryRunner.manager.create(Comprobante, {
        fechaEmision: fechaEmisionFinal,
        moneda: createComprobanteDto.moneda,
        tipoCambio: createComprobanteDto.tipoCambio,
        serie: createComprobanteDto.serie,
        numero: createComprobanteDto.numero,
        fechaVencimiento: createComprobanteDto.fechaVencimiento,
      });

      //Asignamos ENTIDAD, PERSONA, RELACIONES y CORRELATIVO
      comprobante.periodoContable = periodoActicoDePersona;
      comprobante.entidad = entidad;
      comprobante.persona = persona;
      comprobante.tipoOperacion = tipoOperacion;
      comprobante.tipoComprobante = tipoComprobante;
      comprobante.correlativo = `CORR-${correlativo.ultimoNumero}`;
      if (comprobanteAfecto) comprobante.comprobanteAfecto = comprobanteAfecto;

      // Guarda el COMPROBANTE
      const comprobanteSaved = await queryRunner.manager.save(comprobante);

      let costosUnitarios: number[] = [];
      let precioYcantidadPorLote: {
        idLote: number;
        costoUnitarioDeLote: number;
        cantidad: number;
      }[] = [];

      //verificamos DETALLES
      if (this.existDetails(createComprobanteDto)) {
        // Registra DETALLES DE COMPROBANTE
        const detallesSaved = await this.comprobanteDetalleService.register(
          comprobanteSaved.idComprobante,
          createComprobanteDto.detalles!,
          queryRunner.manager,
        );
        comprobanteSaved.detalles = detallesSaved;
        // Procesar lotes en función del tipo de operación y método de valoración
        // Determinar modo de operación para procesar lotes (COMPRA/VENTA) considerando notas
        let modoOperacionParaLote =
          tipoOperacion.codigo === '02'
            ? 'COMPRA'
            : tipoOperacion.codigo === '01'
              ? 'VENTA'
              : tipoOperacion.descripcion;
        if (['07', '08'].includes(tipoOperacion.codigo)) {
          const esNotaCredito = tipoOperacion.codigo === '07';
          const afectoCodigo = comprobanteAfecto?.tipoOperacion?.codigo;
          if (afectoCodigo === '01') {
            // Nota sobre VENTA
            modoOperacionParaLote = esNotaCredito ? 'COMPRA' : 'VENTA';
          } else if (afectoCodigo === '02') {
            // Nota sobre COMPRA
            modoOperacionParaLote = esNotaCredito ? 'VENTA' : 'COMPRA';
          }
        }

        const { costoUnitario, lotes } =
          await this.loteCreationService.procesarLotesComprobante(
            detallesSaved,
            modoOperacionParaLote,
            metodoValoracionFinal,
            fechaEmisionFinal,
          );

        costosUnitarios = costoUnitario;
        precioYcantidadPorLote = lotes;

        // Validar que los lotes se crearon correctamente para compras
        if (tipoOperacion.codigo === '02') {
          // Código "02" para COMPRA
          const lotesValidos =
            await this.loteCreationService.validarLotesCompra(detallesSaved);
          if (!lotesValidos) {
            throw new Error(
              'Error al crear los lotes para la compra. Verifique los logs para más detalles.',
            );
          }
        }
      } else {
        // No hay detalles: registrar totales usando el total enviado en el payload
        await this.comprobanteTotalesService.registerFromTotal(
          comprobanteSaved.idComprobante,
          Number(createComprobanteDto.total ?? 0),
          queryRunner.manager,
        );
      }

      // Cargar las relaciones necesarias para el MovimientoFactory DESPUÉS de guardar los detalles
      const comprobanteConRelaciones = await queryRunner.manager.findOne(
        Comprobante,
        {
          where: { idComprobante: comprobanteSaved.idComprobante },
          relations: [
            'tipoOperacion',
            'tipoComprobante',
            'detalles',
            'detalles.inventario',
            'detalles.inventario.producto',
            'comprobanteAfecto',
            'comprobanteAfecto.tipoOperacion',
          ],
        },
      );

      if (!comprobanteConRelaciones) {
        throw new Error('Error al cargar el comprobante con sus relaciones');
      }

      // Solo crear movimientos si hay detalles y la operación es VENTA ("01") o COMPRA ("02")
      const tieneDetalles =
        comprobanteConRelaciones.detalles &&
        comprobanteConRelaciones.detalles.length > 0;
      const esOperacionKardex = ['01', '02', '07', '08'].includes(
        comprobanteConRelaciones.tipoOperacion?.codigo,
      );

      if (tieneDetalles && esOperacionKardex) {
        const movimientoDto =
          this.movimientoFactory.createMovimientoFromComprobante(
            comprobanteConRelaciones,
            costosUnitarios,
            precioYcantidadPorLote,
          );
        await this.movimientoService.createWithManager(
          movimientoDto,
          queryRunner.manager,
        );
      }

      await queryRunner.commitTransaction();
      // Cargar comprobante con relaciones completas y devolver DTO
      const savedWithRelations = await this.comprobanteRepository.findOne({
        where: { idComprobante: comprobanteSaved.idComprobante },
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

      if (!savedWithRelations) {
        throw new Error('Error al cargar el comprobante creado');
      }

      return plainToInstance(ResponseComprobanteDto, savedWithRelations, {
        excludeExtraneousValues: true,
      });
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      if (error && typeof error === 'object' && 'status' in error) {
        throw error;
      }
      throw new InternalServerErrorException({
        message: 'Error al registrar el comprobante',
        detalle: error?.message || 'Error desconocido',
      });
    } finally {
      await queryRunner.release();
    }
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
  async findAll(personaId: number): Promise<ResponseComprobanteDto[]> {
    const comprobantes = await this.comprobanteRepository.find({
      where: {
        persona: { id: personaId },
        // Excluir COMPRA (idTablaDetalle: 13) y VENTA (idTablaDetalle: 12)
        tipoOperacion: { idTablaDetalle: Not(In([12, 13])) },
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
    });
    return plainToInstance(ResponseComprobanteDto, comprobantes, {
      excludeExtraneousValues: true,
    });
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
