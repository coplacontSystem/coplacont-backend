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

    // Desactivar período activo anterior si existe
    await this.desactivarPeriodoActivo(personaId);

    // Crear nuevo período
    const nuevoPeriodo = this.periodoRepository.create({
      año: createDto.año,
      fechaInicio,
      fechaFin,
      observaciones: createDto.observaciones,
      persona: { id: personaId },
      activo: true,
      cerrado: false,
      // El período se valoriza con el método vigente al crearlo
      metodoValoracion: configuracion.metodoCalculoCosto,
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
    periodo.cerrado = true;
    periodo.fechaCierre = new Date();
    periodo.usuarioCierre = cerrarDto.usuarioCierre;

    if (cerrarDto.observacionesCierre) {
      periodo.observaciones = periodo.observaciones
        ? `${periodo.observaciones}\n\nCierre: ${cerrarDto.observacionesCierre}`
        : `Cierre: ${cerrarDto.observacionesCierre}`;
    }

    const periodoCerrado = await this.periodoRepository.save(periodo);
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
    periodo.cerrado = true;
    periodo.fechaCierre = new Date();
    periodo.usuarioCierre = cerrarDto.usuarioCierre;

    if (cerrarDto.observacionesCierre) {
      periodo.observaciones = periodo.observaciones
        ? `${periodo.observaciones}\n\nCierre: ${cerrarDto.observacionesCierre}`
        : `Cierre: ${cerrarDto.observacionesCierre}`;
    }

    const periodoCerrado = await this.periodoRepository.save(periodo);
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

    // Reabrir período
    periodo.cerrado = false;
    periodo.fechaCierre = undefined;
    periodo.usuarioCierre = undefined;

    const periodoReabierto = await this.periodoRepository.save(periodo);
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
