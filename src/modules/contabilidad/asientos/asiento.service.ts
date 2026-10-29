import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PlanContableService } from '../plan-contable.service';
import type {
  AsientoVista,
  GuardarAsientoDto,
  LineaAsientoDto,
  LineaVista,
  ListarAsientosQuery,
} from './asiento.types';
import type { Pagina } from 'src/common/paginacion';

type Fila = Record<string, any>;

const centimos = (n: number) => Math.round(Number(n) * 100);
const ddmmaaaa = (iso: string) => iso.split('-').reverse().join('/');
const iso = (d: Date | string) => new Date(d).toISOString();

interface Periodo {
  id: number;
  /** Plan de cuentas del período (o el de la empresa) */
  idPlan: number;
  año: number;
  cerrado: boolean;
}

/** Asiento automático armado a partir de una compra o venta */
export interface AsientoAutomatico {
  idComprobante: number;
  origen: 'compra' | 'venta';
  fecha: string;
  glosa: string;
  referencia: string;
  lineas: LineaAsientoDto[];
}

/**
 * Asientos contables (Libro Diario): manuales y automáticos de compras y
 * ventas (uno por comprobante), con el mismo modelo y numeración.
 */
@Injectable()
export class AsientoService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly plan: PlanContableService,
  ) {}

  /* ---------- Consultas ---------- */

  async listar(
    personaId: number,
    q: ListarAsientosQuery,
  ): Promise<Pagina<AsientoVista>> {
    const pagina = q.pagina ?? 1;
    const limite = q.limite ?? 50;
    const params: unknown[] = [personaId];
    const filtros: string[] = ['a.id_persona = $1'];
    const agregar = (sql: string, valor: unknown) => {
      params.push(valor);
      filtros.push(sql.replace('?', `$${params.length}`));
    };
    if (q.desde) agregar('a.fecha >= ?', q.desde);
    if (q.hasta) agregar('a.fecha <= ?', q.hasta);
    if (q.estado) agregar('a.estado = ?', q.estado);
    if (q.origen) agregar('a.origen = ?', q.origen);
    if (q.q) {
      const n = /^\d+$/.test(q.q) ? Number(q.q) : -1;
      params.push(`%${q.q.toLowerCase()}%`, n);
      filtros.push(
        `(lower(a.glosa) LIKE $${params.length - 1} OR lower(COALESCE(a.referencia, '')) LIKE $${params.length - 1} OR a.numero = $${params.length})`,
      );
    }
    if (q.cuenta) {
      agregar(
        `EXISTS (SELECT 1 FROM asiento_linea l JOIN cuenta_contable c ON c.id = l.id_cuenta
                  WHERE l.id_asiento = a.id AND c.codigo LIKE ?)`,
        `${q.cuenta}%`,
      );
    }
    params.push(limite, (pagina - 1) * limite);
    const filas = await this.dataSource.query(
      `SELECT a.*, to_char(a.fecha, 'YYYY-MM-DD') AS fecha_txt,
              p."año" AS periodo_anio, p.cerrado AS periodo_cerrado,
              (SELECT COUNT(*) FROM asiento_linea l WHERE l.id_asiento = a.id) AS lineas,
              COUNT(*) OVER () AS total
         FROM asiento_contable a
         JOIN periodo_contable p ON p.id = a.id_periodo
        WHERE ${filtros.join(' AND ')}
        ORDER BY a.fecha DESC, a.numero DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const permitir = await this.permiteCerrados(personaId);
    const total = Number(filas[0]?.total ?? 0);
    return {
      datos: filas.map((f: Fila) => this.vista(f, permitir)),
      total,
      pagina,
      limite,
      totalPaginas: Math.max(1, Math.ceil(total / limite)),
    };
  }

  async detalle(personaId: number, id: number): Promise<AsientoVista> {
    const [f] = await this.dataSource.query(
      `SELECT a.*, to_char(a.fecha, 'YYYY-MM-DD') AS fecha_txt,
              p."año" AS periodo_anio, p.cerrado AS periodo_cerrado,
              (SELECT COUNT(*) FROM asiento_linea l WHERE l.id_asiento = a.id) AS lineas
         FROM asiento_contable a
         JOIN periodo_contable p ON p.id = a.id_periodo
        WHERE a.id = $1 AND a.id_persona = $2`,
      [id, personaId],
    );
    if (!f) throw new NotFoundException('Asiento no encontrado');
    const lineas: Fila[] = await this.dataSource.query(
      `SELECT l.orden, l.id_cuenta, c.codigo, c.nombre, l.glosa, l.debe, l.haber
         FROM asiento_linea l JOIN cuenta_contable c ON c.id = l.id_cuenta
        WHERE l.id_asiento = $1 ORDER BY l.orden`,
      [id],
    );
    return {
      ...this.vista(f, await this.permiteCerrados(personaId)),
      lineas: lineas.map(
        (l): LineaVista => ({
          orden: Number(l.orden),
          idCuenta: Number(l.id_cuenta),
          codigoCuenta: l.codigo,
          nombreCuenta: l.nombre,
          glosa: l.glosa ?? null,
          debe: Number(l.debe),
          haber: Number(l.haber),
        }),
      ),
    };
  }

  /* ---------- Escritura ---------- */

  async crear(personaId: number, dto: GuardarAsientoDto, usuario: string) {
    const id = await this.dataSource.transaction(async (m) => {
      const periodo = await this.periodoAbierto(m, personaId, dto.fecha);
      const lineas = await this.validarLineas(
        m,
        personaId,
        periodo.idPlan,
        dto.lineas,
      );
      const numero = await this.siguienteNumero(m, personaId, periodo.id);
      const total = lineas.reduce((s, l) => s + l.debe, 0);
      const [a] = await m.query(
        `INSERT INTO asiento_contable
           (id_persona, id_periodo, numero, fecha, glosa, referencia, origen, estado,
            total_debe, total_haber, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual', 'registrado', $7, $7, $8) RETURNING id`,
        [
          personaId,
          periodo.id,
          numero,
          dto.fecha,
          dto.glosa,
          dto.referencia || null,
          total,
          usuario,
        ],
      );
      await this.insertarLineas(m, Number(a.id), lineas);
      return Number(a.id);
    });
    return this.detalle(personaId, id);
  }

  async editar(
    personaId: number,
    id: number,
    dto: GuardarAsientoDto,
    usuario: string,
  ) {
    await this.dataSource.transaction(async (m) => {
      const actual = await this.editableOFalla(m, personaId, id);
      const periodo = await this.periodoAbierto(m, personaId, dto.fecha);
      const lineas = await this.validarLineas(
        m,
        personaId,
        periodo.idPlan,
        dto.lineas,
      );
      // Si la fecha cae en otro periodo, toma el número siguiente de ese periodo
      const numero =
        periodo.id === Number(actual.id_periodo)
          ? Number(actual.numero)
          : await this.siguienteNumero(m, personaId, periodo.id);
      const total = lineas.reduce((s, l) => s + l.debe, 0);
      await m.query(
        `UPDATE asiento_contable
            SET id_periodo = $2, numero = $3, fecha = $4, glosa = $5, referencia = $6,
                total_debe = $7, total_haber = $7, modificado_por = $8, fecha_actualizacion = now()
          WHERE id = $1`,
        [
          id,
          periodo.id,
          numero,
          dto.fecha,
          dto.glosa,
          dto.referencia || null,
          total,
          usuario,
        ],
      );
      await m.query(`DELETE FROM asiento_linea WHERE id_asiento = $1`, [id]);
      await this.insertarLineas(m, id, lineas);
    });
    return this.detalle(personaId, id);
  }

  async anular(personaId: number, id: number, motivo: string, usuario: string) {
    await this.dataSource.transaction(async (m) => {
      await this.editableOFalla(m, personaId, id);
      await m.query(
        `UPDATE asiento_contable
            SET estado = 'anulado', fecha_anulacion = now(), anulado_por = $2,
                motivo_anulacion = $3, fecha_actualizacion = now()
          WHERE id = $1`,
        [id, usuario, motivo],
      );
    });
    return this.detalle(personaId, id);
  }

  /**
   * Crea o actualiza el asiento automático de un comprobante. Conserva su
   * número si sigue en el mismo periodo; si estaba anulado, lo reactiva.
   */
  async guardarAutomatico(
    personaId: number,
    a: AsientoAutomatico,
    usuario: string,
  ): Promise<{ id: number; nuevo: boolean }> {
    return this.dataSource.transaction(async (m) => {
      const periodo = await this.periodoAbierto(m, personaId, a.fecha);
      const lineas = await this.validarLineas(
        m,
        personaId,
        periodo.idPlan,
        a.lineas,
      );
      const total = lineas.reduce((s, l) => s + l.debe, 0);
      const [actual] = await m.query(
        `SELECT id, id_periodo, numero FROM asiento_contable
          WHERE id_persona = $1 AND id_comprobante = $2`,
        [personaId, a.idComprobante],
      );
      if (actual) {
        const id = Number(actual.id);
        const numero =
          periodo.id === Number(actual.id_periodo)
            ? Number(actual.numero)
            : await this.siguienteNumero(m, personaId, periodo.id);
        await m.query(
          `UPDATE asiento_contable
              SET id_periodo = $2, numero = $3, fecha = $4, glosa = $5, referencia = $6,
                  total_debe = $7, total_haber = $7, estado = 'registrado',
                  fecha_anulacion = NULL, anulado_por = NULL, motivo_anulacion = NULL,
                  modificado_por = $8, fecha_actualizacion = now()
            WHERE id = $1`,
          [
            id,
            periodo.id,
            numero,
            a.fecha,
            a.glosa,
            a.referencia,
            total,
            usuario,
          ],
        );
        await m.query(`DELETE FROM asiento_linea WHERE id_asiento = $1`, [id]);
        await this.insertarLineas(m, id, lineas);
        return { id, nuevo: false };
      }
      const numero = await this.siguienteNumero(m, personaId, periodo.id);
      const [nuevo] = await m.query(
        `INSERT INTO asiento_contable
           (id_persona, id_periodo, numero, fecha, glosa, referencia, origen, estado,
            total_debe, total_haber, creado_por, id_comprobante)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'registrado', $8, $8, $9, $10) RETURNING id`,
        [
          personaId,
          periodo.id,
          numero,
          a.fecha,
          a.glosa,
          a.referencia,
          a.origen,
          total,
          usuario,
          a.idComprobante,
        ],
      );
      await this.insertarLineas(m, Number(nuevo.id), lineas);
      return { id: Number(nuevo.id), nuevo: true };
    });
  }

  /* ---------- Reglas ---------- */

  private async permiteCerrados(personaId: number): Promise<boolean> {
    const [c] = await this.dataSource.query(
      `SELECT "permitirMovimientosPeriodoCerrado" AS p FROM configuracion_periodo
        WHERE id_persona = $1 AND activa ORDER BY id LIMIT 1`,
      [personaId],
    );
    return Boolean(c?.p);
  }

  /** Periodo de la empresa que incluye la fecha; cerrado solo si la empresa lo permite */
  private async periodoAbierto(
    m: EntityManager,
    personaId: number,
    fecha: string,
  ): Promise<Periodo> {
    const [p] = await m.query(
      `SELECT id, "año", cerrado, id_plan FROM periodo_contable
        WHERE id_persona = $1 AND "fechaInicio" <= $2 AND "fechaFin" >= $2
        ORDER BY id LIMIT 1`,
      [personaId, fecha],
    );
    if (!p) {
      throw new BadRequestException(
        `No hay un periodo contable que incluya el ${ddmmaaaa(fecha)}. Créalo en Configuración › Periodos contables`,
      );
    }
    if (p.cerrado && !(await this.permiteCerrados(personaId))) {
      throw new BadRequestException(
        `El periodo ${p.año} está cerrado: no admite asientos. Reábrelo o activa "Permitir movimientos en periodo cerrado"`,
      );
    }
    return {
      id: Number(p.id),
      idPlan: p.id_plan
        ? Number(p.id_plan)
        : (await this.plan.planDe(personaId)).id,
      año: Number(p.año),
      cerrado: Boolean(p.cerrado),
    };
  }

  /** Cada línea va a una cuenta de movimiento, con importe en un solo lado; el asiento cuadra */
  private async validarLineas(
    m: EntityManager,
    personaId: number,
    idPlan: number,
    lineas: LineaAsientoDto[],
  ) {
    const plan = { id: idPlan };
    const codigos = [...new Set(lineas.map((l) => l.codigoCuenta))];
    const cuentas: Fila[] = await m.query(
      `SELECT c.id, c.codigo, c.activa,
              EXISTS (SELECT 1 FROM cuenta_contable h
                       WHERE h.id_padre = c.id AND h.activa
                         AND (h.id_persona IS NULL OR h.id_persona = $2)) AS tiene_hijas
         FROM cuenta_contable c
        WHERE c.id_plan = $1 AND (c.id_persona IS NULL OR c.id_persona = $2)
          AND c.codigo = ANY($3)`,
      [plan.id, personaId, codigos],
    );
    const porCodigo = new Map(cuentas.map((c) => [c.codigo as string, c]));
    const errores: string[] = [];
    const resultado = lineas.map((l, i) => {
      const n = i + 1;
      const c = porCodigo.get(l.codigoCuenta);
      if (!c)
        errores.push(
          `Línea ${n}: la cuenta ${l.codigoCuenta} no existe en tu plan`,
        );
      else if (!c.activa)
        errores.push(
          `Línea ${n}: la cuenta ${l.codigoCuenta} está desactivada`,
        );
      else if (c.tiene_hijas) {
        errores.push(
          `Línea ${n}: la cuenta ${l.codigoCuenta} agrupa subcuentas; usa una de sus subcuentas`,
        );
      }
      const debe = centimos(l.debe);
      const haber = centimos(l.haber);
      if (debe > 0 === haber > 0) {
        errores.push(
          `Línea ${n}: registra el importe en el Debe o en el Haber (no en ambos ni en ninguno)`,
        );
      }
      return {
        idCuenta: Number(c?.id),
        glosa: l.glosa || null,
        debe: debe / 100,
        haber: haber / 100,
      };
    });
    const debe = resultado.reduce((s, l) => s + centimos(l.debe), 0);
    const haber = resultado.reduce((s, l) => s + centimos(l.haber), 0);
    if (!errores.length && debe !== haber) {
      errores.push(
        `El asiento no cuadra: Debe ${(debe / 100).toFixed(2)} y Haber ${(haber / 100).toFixed(2)} (diferencia ${(Math.abs(debe - haber) / 100).toFixed(2)})`,
      );
    }
    if (errores.length) throw new BadRequestException(errores);
    return resultado;
  }

  private async siguienteNumero(
    m: EntityManager,
    personaId: number,
    idPeriodo: number,
  ) {
    // Serializa la numeración por empresa y periodo
    await m.query(
      `SELECT pg_advisory_xact_lock(hashtext('asiento:' || $1 || ':' || $2))`,
      [personaId, idPeriodo],
    );
    const [r] = await m.query(
      `SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM asiento_contable
        WHERE id_persona = $1 AND id_periodo = $2`,
      [personaId, idPeriodo],
    );
    return Number(r.n);
  }

  private async insertarLineas(
    m: EntityManager,
    idAsiento: number,
    lineas: {
      idCuenta: number;
      glosa: string | null;
      debe: number;
      haber: number;
    }[],
  ) {
    const valores = lineas
      .map(
        (_, i) =>
          `($1, ${i + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`,
      )
      .join(', ');
    await m.query(
      `INSERT INTO asiento_linea (id_asiento, orden, id_cuenta, glosa, debe, haber) VALUES ${valores}`,
      [
        idAsiento,
        ...lineas.flatMap((l) => [l.idCuenta, l.glosa, l.debe, l.haber]),
      ],
    );
  }

  private async editableOFalla(
    m: EntityManager,
    personaId: number,
    id: number,
  ) {
    const [a] = await m.query(
      `SELECT a.id, a.numero, a.id_periodo, a.origen, a.estado, p."año", p.cerrado
         FROM asiento_contable a JOIN periodo_contable p ON p.id = a.id_periodo
        WHERE a.id = $1 AND a.id_persona = $2 FOR UPDATE OF a`,
      [id, personaId],
    );
    if (!a) throw new NotFoundException('Asiento no encontrado');
    if (a.estado === 'anulado')
      throw new BadRequestException('El asiento ya está anulado');
    if (a.origen !== 'manual') {
      throw new BadRequestException(
        'Este asiento se generó desde un comprobante: se corrige editando el comprobante',
      );
    }
    if (a.cerrado && !(await this.permiteCerrados(personaId))) {
      throw new BadRequestException(
        `El periodo ${a.año} está cerrado: el asiento no se puede modificar`,
      );
    }
    return a as Fila;
  }

  private vista(f: Fila, permiteCerrados: boolean): AsientoVista {
    const cerrado = Boolean(f.periodo_cerrado);
    return {
      id: Number(f.id),
      numero: Number(f.numero),
      periodo: {
        id: Number(f.id_periodo),
        año: Number(f.periodo_anio),
        cerrado,
      },
      fecha: f.fecha_txt,
      glosa: f.glosa,
      referencia: f.referencia ?? null,
      origen: f.origen,
      estado: f.estado,
      totalDebe: Number(f.total_debe),
      totalHaber: Number(f.total_haber),
      cantidadLineas: Number(f.lineas ?? 0),
      creadoPor: f.creado_por,
      fechaCreacion: iso(f.fecha_creacion),
      modificadoPor: f.modificado_por ?? null,
      fechaActualizacion: iso(f.fecha_actualizacion),
      anulacion: f.fecha_anulacion
        ? {
            fecha: iso(f.fecha_anulacion),
            por: f.anulado_por,
            motivo: f.motivo_anulacion,
          }
        : null,
      editable:
        f.origen === 'manual' &&
        f.estado === 'registrado' &&
        (!cerrado || permiteCerrados),
    };
  }
}
