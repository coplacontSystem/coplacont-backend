import { fechaLocal } from '../../comprobantes/service/reglas-registro';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PeriodoContable } from '../entities/periodo-contable.entity';
import { ConfiguracionPeriodo } from '../entities/configuracion-periodo.entity';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';
import {
  CreatePeriodoContableDto,
  UpdatePeriodoContableDto,
  ResponsePeriodoContableDto,
  CerrarPeriodoDto,
} from '../dto';
import { UpdateConfiguracionDto } from '../dto/update-configuracion.dto';

/**
 * activo: recibe compras y ventas · reabierto: activo tras reabrirse
 * futuro: creado a la espera de que cierre el activo · pendiente: sin cerrar
 * ni activo, con movimientos o anterior al activo · cerrado: bloqueado
 */
export type EstadoPeriodo =
  | 'activo'
  | 'reabierto'
  | 'futuro'
  | 'pendiente'
  | 'cerrado';

export interface PeriodoResumen {
  id: number;
  año: number;
  fechaInicio: string;
  fechaFin: string;
  estado: EstadoPeriodo;
  metodoValoracion: MetodoValoracion;
  fechaCierre: string | null;
  cerradoPor: string | null;
  movimientos: number;
  puedeCerrar: boolean;
  puedeReabrir: boolean;
}

/**
 * Servicio para gestionar períodos contables
 * Maneja la creación, actualización, cierre y validación de períodos
 */
@Injectable()
export class PeriodoContableService {
  constructor(
    @InjectRepository(PeriodoContable)
    private readonly periodoRepository: Repository<PeriodoContable>,
    @InjectRepository(ConfiguracionPeriodo)
    private readonly configuracionRepository: Repository<ConfiguracionPeriodo>,
  ) {}

  /**
   * Crear un nuevo período contable para una empresa específica
   */
  async crear(
    personaId: number,
    createDto: CreatePeriodoContableDto,
  ): Promise<ResponsePeriodoContableDto> {
    // Verificar que no exista ya un período para ese año y persona
    const periodoExistente = await this.periodoRepository.findOne({
      where: {
        año: createDto.año,
        persona: { id: personaId },
      },
    });

    if (periodoExistente) {
      throw new ConflictException(
        `Ya existe un período contable para el año ${createDto.año}`,
      );
    }

    // Obtener configuración de la persona
    const configuracion = await this.obtenerConfiguracion(personaId);

    // Calcular fechas si no se proporcionan
    let fechaInicio: Date;
    let fechaFin: Date;

    if (createDto.fechaInicio && createDto.fechaFin) {
      fechaInicio = fechaLocal(createDto.fechaInicio);
      fechaFin = fechaLocal(createDto.fechaFin);
    } else {
      fechaInicio = configuracion.calcularFechaInicioPeriodo(createDto.año);
      fechaFin = configuracion.calcularFechaFinPeriodo(fechaInicio);
    }

    // Validar fechas
    if (fechaInicio >= fechaFin) {
      throw new BadRequestException(
        'La fecha de inicio debe ser anterior a la fecha de fin',
      );
    }
    const [cruce] = await this.periodoRepository.query(
      `SELECT "año" FROM periodo_contable
        WHERE id_persona = $1 AND "fechaInicio" <= $3 AND "fechaFin" >= $2
        LIMIT 1`,
      [personaId, fechaInicio, fechaFin],
    );
    if (cruce) {
      throw new BadRequestException(
        `Las fechas se cruzan con el período ${cruce.año}`,
      );
    }

    // Si ya hay un período abierto en uso, el nuevo espera a que se cierre
    const activo = await this.periodoRepository.findOne({
      where: { persona: { id: personaId }, activo: true, cerrado: false },
    });
    const metodo =
      createDto.metodoValoracion ?? configuracion.metodoCalculoCosto;
    if (!activo) {
      await this.desactivarPeriodoActivo(personaId);
      await this.fijarMetodoEmpresa(personaId, metodo);
    }

    const nuevoPeriodo = this.periodoRepository.create({
      año: createDto.año,
      fechaInicio,
      fechaFin,
      observaciones: createDto.observaciones,
      persona: { id: personaId },
      activo: !activo,
      cerrado: false,
      // El período se valoriza con el método elegido al crearlo
      metodoValoracion: metodo,
    });

    const periodoGuardado = await this.periodoRepository.save(nuevoPeriodo);
    return this.mapearAResponse(await this.obtenerPorId(periodoGuardado.id));
  }

  /**
   * Obtener todos los períodos de una persona
   */
  async obtenerPorPersona(
    idPersona: number,
  ): Promise<ResponsePeriodoContableDto[]> {
    const periodos = await this.periodoRepository.find({
      where: { persona: { id: idPersona } },
      relations: ['persona'],
      order: { año: 'DESC' },
    });

    return periodos.map((periodo) => this.mapearAResponse(periodo));
  }

  /**
   * Obtener período activo de una persona
   */
  async obtenerPeriodoActivo(
    idPersona: number,
  ): Promise<ResponsePeriodoContableDto> {
    const periodo = await this.periodoRepository.findOne({
      where: {
        persona: { id: idPersona },
        activo: true,
      },
      relations: ['persona'],
    });

    if (!periodo) {
      throw new NotFoundException(
        'No se encontró un período activo para esta persona',
      );
    }

    return this.mapearAResponse(periodo);
  }

  /**
   * Obtener período por ID
   */
  async obtenerPorId(id: number): Promise<PeriodoContable> {
    const periodo = await this.periodoRepository.findOne({
      where: { id },
      relations: ['persona'],
    });

    if (!periodo) {
      throw new NotFoundException('Período contable no encontrado');
    }

    return periodo;
  }

  /**
   * Obtener período por ID verificando que pertenezca a una persona específica
   */
  async obtenerPorIdYPersona(
    id: number,
    personaId: number,
  ): Promise<ResponsePeriodoContableDto> {
    const periodo = await this.periodoRepository.findOne({
      where: {
        id,
        persona: { id: personaId },
      },
      relations: ['persona'],
    });

    if (!periodo) {
      throw new NotFoundException(
        'Período contable no encontrado o no pertenece a su empresa',
      );
    }

    return this.mapearAResponse(periodo);
  }

  /**
   * Actualizar un período contable
   */
  async actualizar(
    id: number,
    updateDto: UpdatePeriodoContableDto,
  ): Promise<ResponsePeriodoContableDto> {
    const periodo = await this.obtenerPorId(id);

    // Verificar que el período no esté cerrado
    if (periodo.cerrado) {
      throw new BadRequestException('No se puede modificar un período cerrado');
    }

    // Validar fechas si se proporcionan
    if (updateDto.fechaInicio && updateDto.fechaFin) {
      const fechaInicio = fechaLocal(updateDto.fechaInicio);
      const fechaFin = fechaLocal(updateDto.fechaFin);

      if (fechaInicio >= fechaFin) {
        throw new BadRequestException(
          'La fecha de inicio debe ser anterior a la fecha de fin',
        );
      }
    }

    // Si se activa este período, desactivar otros
    if (updateDto.activo === true && !periodo.activo) {
      await this.desactivarPeriodoActivo(periodo.persona.id);
    }

    // Actualizar período
    Object.assign(periodo, updateDto);

    if (updateDto.fechaInicio) {
      periodo.fechaInicio = fechaLocal(updateDto.fechaInicio);
    }
    if (updateDto.fechaFin) {
      periodo.fechaFin = fechaLocal(updateDto.fechaFin);
    }

    const periodoActualizado = await this.periodoRepository.save(periodo);
    return this.mapearAResponse(periodoActualizado);
  }

  /**
   * Actualizar un período contable verificando que pertenezca a una persona específica
   */
  async actualizarPorPersona(
    id: number,
    personaId: number,
    updateDto: UpdatePeriodoContableDto,
  ): Promise<ResponsePeriodoContableDto> {
    const periodo = await this.periodoRepository.findOne({
      where: {
        id,
        persona: { id: personaId },
      },
      relations: ['persona'],
    });

    if (!periodo) {
      throw new NotFoundException(
        'Período contable no encontrado o no pertenece a su empresa',
      );
    }

    // Verificar que el período no esté cerrado
    if (periodo.cerrado) {
      throw new BadRequestException('No se puede modificar un período cerrado');
    }

    // Validar fechas si se proporcionan
    if (updateDto.fechaInicio && updateDto.fechaFin) {
      const fechaInicio = fechaLocal(updateDto.fechaInicio);
      const fechaFin = fechaLocal(updateDto.fechaFin);

      if (fechaInicio >= fechaFin) {
        throw new BadRequestException(
          'La fecha de inicio debe ser anterior a la fecha de fin',
        );
      }
    }

    // Si se activa este período, desactivar otros
    if (updateDto.activo === true && !periodo.activo) {
      await this.desactivarPeriodoActivo(periodo.persona.id);
    }

    // Actualizar período
    Object.assign(periodo, updateDto);

    if (updateDto.fechaInicio) {
      periodo.fechaInicio = fechaLocal(updateDto.fechaInicio);
    }
    if (updateDto.fechaFin) {
      periodo.fechaFin = fechaLocal(updateDto.fechaFin);
    }

    const periodoActualizado = await this.periodoRepository.save(periodo);
    return this.mapearAResponse(periodoActualizado);
  }

  /**
   * Cerrar un período contable
   */
  async cerrar(
    id: number,
    cerrarDto: CerrarPeriodoDto,
  ): Promise<ResponsePeriodoContableDto> {
    const periodo = await this.obtenerPorId(id);

    if (periodo.cerrado) {
      throw new BadRequestException('El período ya está cerrado');
    }

    // Actualizar período con información de cierre
    const eraActivo = periodo.activo;
    periodo.cerrado = true;
    periodo.activo = false;
    periodo.reabierto = false;
    periodo.fechaCierre = new Date();
    periodo.usuarioCierre = cerrarDto.usuarioCierre;

    if (cerrarDto.observacionesCierre) {
      periodo.observaciones = periodo.observaciones
        ? `${periodo.observaciones}\n\nCierre: ${cerrarDto.observacionesCierre}`
        : `Cierre: ${cerrarDto.observacionesCierre}`;
    }

    const periodoCerrado = await this.periodoRepository.save(periodo);
    if (eraActivo) {
      await this.activarSiguiente(periodo.persona.id, periodo.año);
    }
    return this.mapearAResponse(periodoCerrado);
  }

  /**
   * Cerrar un período contable verificando que pertenezca a una persona específica
   */
  async cerrarPorPersona(
    id: number,
    personaId: number,
    cerrarDto: CerrarPeriodoDto,
  ): Promise<ResponsePeriodoContableDto> {
    const periodo = await this.periodoRepository.findOne({
      where: {
        id,
        persona: { id: personaId },
      },
      relations: ['persona'],
    });

    if (!periodo) {
      throw new NotFoundException(
        'Período contable no encontrado o no pertenece a su empresa',
      );
    }

    if (periodo.cerrado) {
      throw new BadRequestException('El período ya está cerrado');
    }

    // Actualizar período con información de cierre
    const eraActivo = periodo.activo;
    periodo.cerrado = true;
    periodo.activo = false;
    periodo.reabierto = false;
    periodo.fechaCierre = new Date();
    periodo.usuarioCierre = cerrarDto.usuarioCierre;

    if (cerrarDto.observacionesCierre) {
      periodo.observaciones = periodo.observaciones
        ? `${periodo.observaciones}\n\nCierre: ${cerrarDto.observacionesCierre}`
        : `Cierre: ${cerrarDto.observacionesCierre}`;
    }

    const periodoCerrado = await this.periodoRepository.save(periodo);
    if (eraActivo) await this.activarSiguiente(personaId, periodo.año);
    return this.mapearAResponse(periodoCerrado);
  }

  /**
   * Reabrir un período contable
   */
  async reabrir(id: number): Promise<ResponsePeriodoContableDto> {
    const periodo = await this.obtenerPorId(id);

    if (!periodo.cerrado) {
      throw new BadRequestException('El período no está cerrado');
    }

    // Reabrir período
    periodo.cerrado = false;
    periodo.fechaCierre = undefined;
    periodo.usuarioCierre = undefined;

    const periodoReabierto = await this.periodoRepository.save(periodo);
    return this.mapearAResponse(periodoReabierto);
  }

  /**
   * Reabrir un período contable verificando que pertenezca a una persona específica
   */
  async reabrirPorPersona(
    id: number,
    personaId: number,
  ): Promise<ResponsePeriodoContableDto> {
    const periodo = await this.periodoRepository.findOne({
      where: {
        id,
        persona: { id: personaId },
      },
      relations: ['persona'],
    });

    if (!periodo) {
      throw new NotFoundException(
        'Período contable no encontrado o no pertenece a su empresa',
      );
    }

    if (!periodo.cerrado) {
      throw new BadRequestException('El período no está cerrado');
    }

    // Solo el último cerrado, y de uno en uno
    const ultimoCerrado = await this.periodoRepository.findOne({
      where: { persona: { id: personaId }, cerrado: true },
      order: { año: 'DESC' },
    });
    if (ultimoCerrado?.id !== periodo.id) {
      throw new BadRequestException(
        'Solo se puede reabrir el último período cerrado',
      );
    }
    const otroReabierto = await this.periodoRepository.findOne({
      where: { persona: { id: personaId }, reabierto: true },
    });
    if (otroReabierto) {
      throw new BadRequestException(
        `Cierra primero el período ${otroReabierto.año}, que está reabierto`,
      );
    }

    // El reabierto pasa a ser el activo hasta que se vuelva a cerrar
    await this.desactivarPeriodoActivo(personaId);
    periodo.cerrado = false;
    periodo.activo = true;
    periodo.reabierto = true;
    periodo.fechaCierre = undefined;
    periodo.usuarioCierre = undefined;

    const periodoReabierto = await this.periodoRepository.save(periodo);
    if (periodo.metodoValoracion) {
      await this.fijarMetodoEmpresa(personaId, periodo.metodoValoracion);
    }
    return this.mapearAResponse(periodoReabierto);
  }

  /**
   * Eliminar un período contable
   */
  async eliminar(id: number): Promise<void> {
    const periodo = await this.obtenerPorId(id);

    if (periodo.cerrado) {
      throw new BadRequestException('No se puede eliminar un período cerrado');
    }

    // Verificar que no tenga comprobantes asociados
    const tieneComprobantes = await this.verificarComprobantesAsociados(id);
    if (tieneComprobantes) {
      throw new BadRequestException(
        'No se puede eliminar un período que tiene comprobantes asociados',
      );
    }

    await this.periodoRepository.remove(periodo);
  }

  /**
   * Eliminar un período contable verificando que pertenezca a una persona específica
   */
  async eliminarPorPersona(id: number, personaId: number): Promise<void> {
    const periodo = await this.periodoRepository.findOne({
      where: {
        id,
        persona: { id: personaId },
      },
      relations: ['persona'],
    });

    if (!periodo) {
      throw new NotFoundException(
        'Período contable no encontrado o no pertenece a su empresa',
      );
    }

    if (periodo.cerrado) {
      throw new BadRequestException('No se puede eliminar un período cerrado');
    }

    // TODO: Verificar que no tenga comprobantes asociados
    // const tieneComprobantes = await this.verificarComprobantesAsociados(id);
    // if (tieneComprobantes) {
    //   throw new BadRequestException(
    //     'No se puede eliminar un período que tiene comprobantes asociados'
    //   );
    // }

    await this.periodoRepository.remove(periodo);
  }

  /**
   * Validar si una fecha está dentro del período activo
   */
  async validarFechaEnPeriodoActivo(
    idPersona: number,
    fecha: Date | string,
  ): Promise<{ valida: boolean; mensaje?: string; periodo?: PeriodoContable }> {
    try {
      // Asegurar que fecha sea un objeto Date válido
      let fechaDate: Date;
      if (typeof fecha === 'string') {
        fechaDate = new Date(fecha);
      } else if (fecha instanceof Date) {
        fechaDate = fecha;
      } else {
        throw new Error('El parámetro fecha debe ser un Date o string válido');
      }

      // Validar que la fecha sea válida
      if (isNaN(fechaDate.getTime())) {
        throw new Error('La fecha proporcionada no es válida');
      }

      const periodoActivo = await this.obtenerPeriodoActivo(idPersona);

      const periodo = await this.obtenerPorId(periodoActivo.id);

      // Verificar si el período está cerrado
      if (periodo.cerrado) {
        return {
          valida: false,
          mensaje: `El período ${periodo.getDescripcion()} está cerrado y no permite registrar nuevos comprobantes`,
          periodo,
        };
      }
      if (periodo.estaEnPeriodo(fechaDate)) {
        return { valida: true, periodo };
      }

      return {
        valida: false,
        mensaje: `La fecha ${fechaDate.toISOString().split('T')[0]} no está dentro del período activo ${periodo.getDescripcion()}`,
        periodo,
      };
    } catch (error) {
      void error;
      return {
        valida: false,
        mensaje: 'No hay un período activo configurado',
      };
    }
  }

  /**
   * Validar movimiento retroactivo
   */
  async validarMovimientoRetroactivo(
    idPersona: number,
    fecha: Date | string,
  ): Promise<{ permitido: boolean; mensaje?: string }> {
    const configuracion = await this.obtenerConfiguracion(idPersona);
    const hoy = new Date();

    // Asegurar que fecha sea un objeto Date válido
    let fechaDate: Date;
    if (typeof fecha === 'string') {
      fechaDate = new Date(fecha);
    } else if (fecha instanceof Date) {
      fechaDate = fecha;
    } else {
      throw new Error('El parámetro fecha debe ser un Date o string válido');
    }

    // Validar que la fecha sea válida
    if (isNaN(fechaDate.getTime())) {
      throw new Error('La fecha proporcionada no es válida');
    }

    const diasDiferencia = Math.floor(
      (hoy.getTime() - fechaDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (!configuracion.permiteRetroactivo(diasDiferencia)) {
      return {
        permitido: false,
        mensaje: `No se permiten movimientos retroactivos de más de ${configuracion.diasLimiteRetroactivo} días`,
      };
    }

    return { permitido: true };
  }

  /**
   * Obtener configuración de período para una persona
   */
  async obtenerConfiguracion(idPersona: number): Promise<ConfiguracionPeriodo> {
    let configuracion = await this.configuracionRepository.findOne({
      where: { persona: { id: idPersona }, activa: true },
    });

    // Si no existe configuración, crear una por defecto
    if (!configuracion) {
      configuracion = this.configuracionRepository.create({
        persona: { id: idPersona },
        duracionMeses: 12,
        mesInicio: 1,
        diasLimiteRetroactivo: 30,
        recalculoAutomaticoKardex: true,
        activa: true,
      });
      configuracion = await this.configuracionRepository.save(configuracion);
    }

    return configuracion;
  }

  /**
   * Verificar si un período tiene comprobantes asociados
   */
  private async verificarComprobantesAsociados(
    periodoId: number,
  ): Promise<boolean> {
    const periodo = await this.periodoRepository.findOne({
      where: { id: periodoId },
      relations: ['comprobantes'],
    });

    return !!(periodo?.comprobantes && periodo.comprobantes.length > 0);
  }

  /**
   * Validar si se puede cambiar el método de valoración
   * @param personaId ID de la persona/empresa
   * @param nuevoMetodo Nuevo método de valoración
   * @throws BadRequestException si hay movimientos en el período activo
   */
  async validarCambioMetodoValoracion(personaId: number): Promise<void> {
    const periodoActivo = await this.obtenerPeriodoActivo(personaId);
    if (!periodoActivo) {
      throw new BadRequestException('No hay un período activo configurado');
    }
    // Solo al inicio del ejercicio: si el período ya tiene movimientos de
    // inventario, cambiar el método revalorizaría lo ya registrado
    const [conMovimientos] = await this.periodoRepository.query(
      `SELECT 1
         FROM periodo_contable p
         JOIN almacen a ON a.id_persona = p.id_persona
         JOIN inventario i ON i.id_almacen = a.id
         JOIN movimiento_detalles md ON md.id_inventario = i.id
         JOIN movimientos m ON m.id = md.id_movimiento AND m.estado = 'PROCESADO'
        WHERE p.id = $1
          AND m.fecha >= p."fechaInicio" AND m.fecha < p."fechaFin" + 1
        LIMIT 1`,
      [periodoActivo.id],
    );
    if (conMovimientos) {
      throw new BadRequestException(
        `El método de valoración solo se puede cambiar al inicio del ejercicio: ` +
          `el período ${periodoActivo.año} ya tiene movimientos de inventario`,
      );
    }
  }

  /**
   * Actualizar método de valoración en la configuración
   * @param personaId ID de la persona/empresa
   * @param nuevoMetodo Nuevo método de valoración
   */
  async actualizarMetodoValoracion(
    personaId: number,
    nuevoMetodo: MetodoValoracion,
  ): Promise<ConfiguracionPeriodo> {
    // Validar que se pueda cambiar
    await this.validarCambioMetodoValoracion(personaId);

    const configuracion = await this.obtenerConfiguracion(personaId);
    const periodoActivo = await this.obtenerPeriodoActivo(personaId);

    // Los demás períodos conservan el método con que se valorizaron
    await this.periodoRepository.query(
      `UPDATE periodo_contable SET "metodoValoracion" = $2
        WHERE id_persona = $1 AND "metodoValoracion" IS NULL AND id <> $3`,
      [personaId, configuracion.metodoCalculoCosto, periodoActivo.id],
    );
    await this.periodoRepository.update(periodoActivo.id, {
      metodoValoracion: nuevoMetodo,
    });

    configuracion.metodoCalculoCosto = nuevoMetodo;
    return await this.configuracionRepository.save(configuracion);
  }

  /** Períodos de la empresa con su estado y lo que se puede hacer con cada uno */
  async resumenPorPersona(personaId: number): Promise<PeriodoResumen[]> {
    const filas: {
      id: number;
      año: number;
      inicio: string;
      fin: string;
      activo: boolean;
      cerrado: boolean;
      reabierto: boolean;
      metodo: MetodoValoracion;
      fechaCierre: Date | null;
      cerrado_por: string | null;
      movimientos: string;
    }[] = await this.periodoRepository.query(
      `SELECT p.id, p."año", p.activo, p.cerrado, p.reabierto, p."fechaCierre",
              to_char(p."fechaInicio", 'YYYY-MM-DD') AS inicio,
              to_char(p."fechaFin", 'YYYY-MM-DD') AS fin,
              COALESCE(p."metodoValoracion"::text, cfg."metodoCalculoCosto"::text,
                       'promedio') AS metodo,
              COALESCE(u.nombre, p."usuarioCierre") AS cerrado_por,
              (SELECT COUNT(DISTINCT m.id)
                 FROM movimientos m
                 JOIN movimiento_detalles md ON md.id_movimiento = m.id
                 JOIN inventario i ON i.id = md.id_inventario
                 JOIN almacen a ON a.id = i.id_almacen
                WHERE a.id_persona = p.id_persona AND m.estado = 'PROCESADO'
                  AND m.fecha >= p."fechaInicio" AND m.fecha < p."fechaFin" + 1
              ) AS movimientos
         FROM periodo_contable p
         LEFT JOIN configuracion_periodo cfg
                ON cfg.id_persona = p.id_persona AND cfg.activa
         LEFT JOIN "user" u ON u.email = p."usuarioCierre"
        WHERE p.id_persona = $1
        ORDER BY p."año" DESC`,
      [personaId],
    );
    const activo = filas.find((f) => f.activo && !f.cerrado);
    const ultimoCerrado = filas.find((f) => f.cerrado);
    const hayReabierto = filas.some((f) => f.reabierto && !f.cerrado);
    return filas.map((f) => {
      const movimientos = Number(f.movimientos);
      let estado: EstadoPeriodo;
      if (f.cerrado) estado = 'cerrado';
      else if (f.activo) estado = f.reabierto ? 'reabierto' : 'activo';
      else if (movimientos === 0 && (!activo || f.año > activo.año))
        estado = 'futuro';
      else estado = 'pendiente';
      return {
        id: f.id,
        año: f.año,
        fechaInicio: f.inicio,
        fechaFin: f.fin,
        estado,
        metodoValoracion: f.metodo,
        fechaCierre: f.fechaCierre
          ? new Date(f.fechaCierre).toISOString()
          : null,
        cerradoPor: f.cerrado_por,
        movimientos,
        puedeCerrar: estado !== 'cerrado' && estado !== 'futuro',
        puedeReabrir: f.id === ultimoCerrado?.id && !hayReabierto,
      };
    });
  }

  /** Reglas del período más el estado del método de valoración */
  async configuracionCompleta(personaId: number) {
    const config = await this.obtenerConfiguracion(personaId);
    const activo = (await this.resumenPorPersona(personaId)).find(
      (p) => p.estado === 'activo' || p.estado === 'reabierto',
    );
    return {
      metodoValoracion: activo?.metodoValoracion ?? config.metodoCalculoCosto,
      duracionMeses: config.duracionMeses,
      mesInicio: config.mesInicio,
      diasLimiteRetroactivo: config.diasLimiteRetroactivo,
      recalculoAutomaticoKardex: config.recalculoAutomaticoKardex,
      requiereAutorizacionRetroactivo: config.requiereAutorizacionRetroactivo,
      cierreAutomatico: config.cierreAutomatico,
      diasParaCierreAutomatico: config.diasParaCierreAutomatico,
      notificarProximoCierre: config.notificarProximoCierre,
      diasNotificacionCierre: config.diasNotificacionCierre,
      permitirMovimientosPeriodoCerrado:
        config.permitirMovimientosPeriodoCerrado,
      // Solo se cambia mientras el período activo no tenga movimientos
      metodoBloqueado: !activo || activo.movimientos > 0,
      periodoActivo: activo
        ? { id: activo.id, año: activo.año, movimientos: activo.movimientos }
        : null,
    };
  }

  async actualizarConfiguracion(
    personaId: number,
    dto: UpdateConfiguracionDto,
  ) {
    const config = await this.obtenerConfiguracion(personaId);
    const campos: (keyof UpdateConfiguracionDto)[] = [
      'mesInicio',
      'diasLimiteRetroactivo',
      'requiereAutorizacionRetroactivo',
      'cierreAutomatico',
      'diasParaCierreAutomatico',
      'notificarProximoCierre',
      'diasNotificacionCierre',
      'permitirMovimientosPeriodoCerrado',
    ];
    for (const campo of campos) {
      if (dto[campo] !== undefined) (config as any)[campo] = dto[campo];
    }
    await this.configuracionRepository.save(config);
    return this.configuracionCompleta(personaId);
  }

  /** Activa el siguiente período sin cerrar, si no queda otro activo */
  private async activarSiguiente(personaId: number, año: number) {
    const hayActivo = await this.periodoRepository.findOne({
      where: { persona: { id: personaId }, activo: true },
    });
    if (hayActivo) return;
    const [siguiente] = await this.periodoRepository.query(
      `SELECT id, "metodoValoracion" FROM periodo_contable
        WHERE id_persona = $1 AND NOT cerrado AND "año" > $2
        ORDER BY "año" LIMIT 1`,
      [personaId, año],
    );
    if (!siguiente) return;
    await this.periodoRepository.update(siguiente.id, { activo: true });
    if (siguiente.metodoValoracion) {
      await this.fijarMetodoEmpresa(personaId, siguiente.metodoValoracion);
    }
  }

  /**
   * Cambia el método vigente de la empresa sin revalorizar otros períodos:
   * los que aún usan el de la configuración se quedan con el actual.
   */
  private async fijarMetodoEmpresa(
    personaId: number,
    metodo: MetodoValoracion,
  ) {
    const config = await this.obtenerConfiguracion(personaId);
    if (config.metodoCalculoCosto === metodo) return;
    await this.periodoRepository.query(
      `UPDATE periodo_contable SET "metodoValoracion" = $2
        WHERE id_persona = $1 AND "metodoValoracion" IS NULL`,
      [personaId, config.metodoCalculoCosto],
    );
    config.metodoCalculoCosto = metodo;
    await this.configuracionRepository.save(config);
  }

  /**
   * Desactivar período activo actual
   */
  private async desactivarPeriodoActivo(idPersona: number): Promise<void> {
    await this.periodoRepository.update(
      { persona: { id: idPersona }, activo: true },
      { activo: false },
    );
  }

  /**
   * Mapear entidad a DTO de respuesta
   */
  private mapearAResponse(
    periodo: PeriodoContable,
  ): ResponsePeriodoContableDto {
    // Función auxiliar para manejar fechas que pueden ser Date o string
    const formatearFecha = (fecha: Date | string): string => {
      if (fecha instanceof Date) {
        return fecha.toISOString().split('T')[0];
      }
      // Si es string, asumimos que ya está en formato YYYY-MM-DD
      return String(fecha).split('T')[0];
    };

    const formatearFechaCompleta = (fecha: Date | string): string => {
      if (fecha instanceof Date) {
        return fecha.toISOString();
      }
      // Si es string, intentamos convertir a Date y luego a ISO
      return new Date(fecha).toISOString();
    };

    return {
      id: periodo.id,
      año: periodo.año,
      fechaInicio: formatearFecha(periodo.fechaInicio),
      fechaFin: formatearFecha(periodo.fechaFin),
      activo: periodo.activo,
      cerrado: periodo.cerrado,
      fechaCierre: periodo.fechaCierre
        ? formatearFechaCompleta(periodo.fechaCierre)
        : undefined,
      usuarioCierre: periodo.usuarioCierre,
      observaciones: periodo.observaciones,
      persona: {
        id: periodo.persona.id,
        razonSocial: periodo.persona.razonSocial,
        ruc: periodo.persona.ruc,
      },
      descripcion: `Período ${periodo.año} (${formatearFecha(periodo.fechaInicio)} - ${formatearFecha(periodo.fechaFin)})`,
      fechaCreacion: formatearFechaCompleta(periodo.fechaCreacion),
      fechaActualizacion: formatearFechaCompleta(periodo.fechaActualizacion),
    };
  }
}
