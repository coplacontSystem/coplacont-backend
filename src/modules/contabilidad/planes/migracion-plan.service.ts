import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { naturalezaDe, nivelDe } from '../plan-contable.reglas';
import { PlanContableService } from '../plan-contable.service';

type Fila = Record<string, any>;

interface Cuenta {
  id: number;
  codigo: string;
  nombre: string;
  propia: boolean;
  activa: boolean;
}

export interface OpcionesMigracion {
  idPlan: number;
  /** Desde este período (y los siguientes) se usa el plan nuevo; sin él, todos */
  idPeriodoDesde?: number;
  /** Cuenta del plan actual → cuenta del plan nuevo, cuando la equivalencia no sirve */
  reasignar?: Record<string, string>;
}

export interface InformeMigracion {
  planActual: { id: number; codigo: string; nombre: string };
  planDestino: { id: number; codigo: string; nombre: string };
  /** Períodos que pasan al plan nuevo (los anteriores conservan el suyo) */
  periodos: { id: number; año: number; pasa: boolean }[];
  cuentasPropias: {
    codigo: string;
    nombre: string;
    nuevoCodigo: string | null;
    problema: string | null;
  }[];
  /** Cuentas con movimientos en los períodos que pasan */
  cuentasUsadas: {
    codigo: string;
    nombre: string;
    usos: number;
    destino: string | null;
    nombreDestino: string | null;
    problema: string | null;
  }[];
  areas: { nombre: string; actual: string | null; nuevo: string | null }[];
  cuentasAutomaticas: { rol: string; actual: string; nuevo: string | null }[];
  errores: string[];
  avisos: string[];
}

/**
 * Cambio de plan de cuentas de una empresa desde un período (p. ej. PCGE
 * 2019 → 2026 desde 2027). Los períodos anteriores conservan su plan y sus
 * libros; en los que pasan, cada cuenta usada se traslada con la tabla de
 * equivalencias y las subcuentas propias se recrean bajo su cuenta nueva.
 */
@Injectable()
export class MigracionPlanService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly plan: PlanContableService,
  ) {}

  async previsualizar(personaId: number, o: OpcionesMigracion) {
    const { informe } = await this.analizar(
      this.dataSource.manager,
      personaId,
      o,
    );
    return informe;
  }

  async migrar(personaId: number, o: OpcionesMigracion) {
    const idPlan = o.idPlan;
    await this.dataSource.transaction(async (m) => {
      // Una migración a la vez por empresa
      await m.query(
        `SELECT pg_advisory_xact_lock(hashtext('migracion-plan:' || $1))`,
        [personaId],
      );
      const { informe, mapa, propias, periodosQuePasan, periodosQueQuedan } =
        await this.analizar(m, personaId, o);
      if (informe.errores.length)
        throw new BadRequestException(informe.errores);
      const actual = informe.planActual.id;

      // 1. Los períodos anteriores fijan su plan; los que pasan, el nuevo
      if (periodosQueQuedan.length) {
        await m.query(
          `UPDATE periodo_contable SET id_plan = $2 WHERE id = ANY($1) AND id_plan IS NULL`,
          [periodosQueQuedan, actual],
        );
      }
      if (periodosQuePasan.length) {
        await m.query(
          `UPDATE periodo_contable SET id_plan = $2 WHERE id = ANY($1)`,
          [periodosQuePasan, idPlan],
        );
      }

      // 2. Subcuentas propias en el plan nuevo (de las cortas a las largas)
      const idsNuevos = new Map<string, number>();
      const oficiales: Fila[] = await m.query(
        `SELECT id, codigo FROM cuenta_contable WHERE id_plan = $1 AND id_persona IS NULL`,
        [idPlan],
      );
      oficiales.forEach((c) => idsNuevos.set(c.codigo, Number(c.id)));
      const yaPropias: Fila[] = await m.query(
        `SELECT id, codigo FROM cuenta_contable WHERE id_plan = $1 AND id_persona = $2`,
        [idPlan, personaId],
      );
      yaPropias.forEach((c) => idsNuevos.set(c.codigo, Number(c.id)));
      for (const p of [...propias].sort(
        (a, b) => a.nuevo.length - b.nuevo.length,
      )) {
        if (idsNuevos.has(p.nuevo)) continue;
        let padre: number | null = null;
        for (let n = p.nuevo.length - 1; n >= 2 && padre == null; n--) {
          padre = idsNuevos.get(p.nuevo.slice(0, n)) ?? null;
        }
        const [c] = await m.query(
          `INSERT INTO cuenta_contable
             (id_plan, id_persona, codigo, nombre, nivel, elemento, naturaleza, id_padre, activa)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            idPlan,
            personaId,
            p.nuevo,
            p.cuenta.nombre,
            nivelDe(p.nuevo),
            p.nuevo[0],
            naturalezaDe(p.nuevo),
            padre,
            p.cuenta.activa,
          ],
        );
        idsNuevos.set(p.nuevo, Number(c.id));
      }

      // 3. Movimientos de los períodos que pasan: a la cuenta equivalente
      const idDe = new Map<number, number>();
      for (const [idViejo, codigoNuevo] of mapa) {
        const idNuevo = idsNuevos.get(codigoNuevo);
        if (idNuevo) idDe.set(idViejo, idNuevo);
      }
      const viejos = [...idDe.keys()];
      const nuevos = viejos.map((v) => idDe.get(v)!);
      if (periodosQuePasan.length && viejos.length) {
        await m.query(
          `UPDATE asiento_linea l SET id_cuenta = x.nuevo
             FROM unnest($1::int[], $2::int[]) AS x(viejo, nuevo), asiento_contable a
            WHERE l.id_cuenta = x.viejo AND a.id = l.id_asiento
              AND a.id_persona = $3 AND a.id_periodo = ANY($4)`,
          [viejos, nuevos, personaId, periodosQuePasan],
        );
        await m.query(
          `UPDATE comprobante_detalle d SET id_cuenta_contable = x.nuevo
             FROM unnest($1::int[], $2::int[]) AS x(viejo, nuevo), comprobante c
            WHERE d.id_cuenta_contable = x.viejo AND c."idComprobante" = d.id_comprobante
              AND c.id_persona = $3 AND c.id_periodo_contable = ANY($4)`,
          [viejos, nuevos, personaId, periodosQuePasan],
        );
      }

      // 4. Áreas y cuentas automáticas con las cuentas nuevas
      for (const a of informe.areas) {
        await m.query(
          `UPDATE area_contable SET cuenta_destino = $3 WHERE id_persona = $1 AND nombre = $2`,
          [personaId, a.nombre, a.nuevo],
        );
      }
      const automaticas = Object.fromEntries(
        informe.cuentasAutomaticas
          .filter((c) => c.nuevo)
          .map((c) => [c.rol, c.nuevo]),
      );
      await m.query(
        `INSERT INTO configuracion_contable (id_persona, cuentas) VALUES ($1, $2)
         ON CONFLICT (id_persona) DO UPDATE SET cuentas = EXCLUDED.cuentas`,
        [personaId, JSON.stringify(automaticas)],
      );

      // 5. La empresa queda en el plan nuevo
      await m.query(`UPDATE persona SET id_plan_contable = $2 WHERE id = $1`, [
        personaId,
        idPlan,
      ]);
    });
    return this.plan.resumen(personaId);
  }

  private async analizar(
    m: EntityManager,
    personaId: number,
    o: OpcionesMigracion,
  ) {
    const { idPlan, idPeriodoDesde } = o;
    const reasignar = new Map(Object.entries(o.reasignar ?? {}));
    const planes = await this.plan.planes();
    const destino = planes.find((p) => p.id === idPlan);
    if (!destino) throw new NotFoundException('Plan contable no encontrado');
    const actualVista = await this.plan.planDe(personaId);
    if (actualVista.id === idPlan) {
      throw new BadRequestException(`La empresa ya usa ${destino.nombre}`);
    }
    const errores: string[] = [];
    const avisos: string[] = [];

    // Períodos: pasan el elegido y los siguientes
    const periodos: Fila[] = await m.query(
      `SELECT id, "año" FROM periodo_contable WHERE id_persona = $1 ORDER BY "año", id`,
      [personaId],
    );
    let desde: Fila | undefined;
    if (idPeriodoDesde) {
      desde = periodos.find((p) => Number(p.id) === idPeriodoDesde);
      if (!desde) throw new NotFoundException('El período no es de tu empresa');
    } else {
      desde = periodos[0];
    }
    const pasa = (p: Fila) => !!desde && Number(p.año) >= Number(desde.año);
    const periodosQuePasan = periodos.filter(pasa).map((p) => Number(p.id));
    const periodosQueQuedan = periodos
      .filter((p) => !pasa(p))
      .map((p) => Number(p.id));

    // Equivalencias oficiales del plan actual al nuevo
    const eq: Fila[] = await m.query(
      `SELECT codigo_origen, codigo_destino FROM cuenta_equivalencia
        WHERE id_plan_origen = $1 AND id_plan_destino = $2`,
      [actualVista.id, idPlan],
    );
    if (!eq.length) {
      avisos.push(
        `No hay tabla de equivalencias de ${actualVista.nombre} a ${destino.nombre}: solo pasan las cuentas sin movimientos`,
      );
    }
    const oficial = new Map(
      eq.map((e) => [
        String(e.codigo_origen),
        e.codigo_destino as string | null,
      ]),
    );

    const cuentasActuales: Cuenta[] = (
      await m.query(
        `SELECT id, codigo, nombre, id_persona IS NOT NULL AS propia, activa FROM cuenta_contable
          WHERE id_plan = $1 AND (id_persona IS NULL OR id_persona = $2)`,
        [actualVista.id, personaId],
      )
    ).map((c: Fila) => ({
      id: Number(c.id),
      codigo: c.codigo,
      nombre: c.nombre,
      propia: Boolean(c.propia),
      activa: Boolean(c.activa),
    }));
    const oficialesActuales = new Set(
      cuentasActuales.filter((c) => !c.propia).map((c) => c.codigo),
    );

    const destinoFilas: Fila[] = await m.query(
      `SELECT codigo, nombre, activa FROM cuenta_contable WHERE id_plan = $1 AND id_persona IS NULL`,
      [idPlan],
    );
    const destinoNombre = new Map(
      destinoFilas.map((c) => [String(c.codigo), String(c.nombre)]),
    );

    // Subcuentas propias: cuelgan del equivalente de su cuenta oficial más cercana
    const propias: { cuenta: Cuenta; nuevo: string }[] = [];
    const informePropias: InformeMigracion['cuentasPropias'] = [];
    const codigoPropia = new Map<string, string>();
    for (const c of cuentasActuales
      .filter((x) => x.propia)
      .sort((a, b) => a.codigo.length - b.codigo.length)) {
      let base: string | null = null;
      for (let n = c.codigo.length - 1; n >= 2 && !base; n--) {
        if (oficialesActuales.has(c.codigo.slice(0, n)))
          base = c.codigo.slice(0, n);
      }
      // Sin padre oficial (p. ej. 94, 95 de la clase 9 propia): mismo código si está libre
      const baseNueva = base ? oficial.get(base) : null;
      const elegido = reasignar.get(c.codigo);
      let nuevo: string | null = elegido
        ? elegido
        : base
          ? baseNueva
            ? baseNueva + c.codigo.slice(base.length)
            : null
          : c.codigo;
      let problema: string | null = null;
      if (elegido) {
        // Reasignada a mano: a una cuenta oficial o a una subcuenta propia nueva
      } else if (base && !baseNueva)
        problema = `Su cuenta ${base} no tiene equivalente en el plan nuevo`;
      else if (
        nuevo &&
        destinoNombre.has(nuevo) &&
        destinoNombre.get(nuevo) !== c.nombre
      ) {
        problema = `El código ${nuevo} ya es una cuenta oficial (${destinoNombre.get(nuevo)})`;
        nuevo = null;
      }
      if (nuevo && !problema) {
        if (!destinoNombre.has(nuevo)) propias.push({ cuenta: c, nuevo });
        codigoPropia.set(c.codigo, nuevo);
      }
      informePropias.push({
        codigo: c.codigo,
        nombre: c.nombre,
        nuevoCodigo: nuevo,
        problema,
      });
    }

    // A qué código nuevo va cada cuenta del plan actual
    const nuevoCodigo = (c: Cuenta) =>
      reasignar.get(c.codigo) ??
      (c.propia
        ? (codigoPropia.get(c.codigo) ?? null)
        : (oficial.get(c.codigo) ?? null));

    // Cuentas que tendrán hijas en el plan nuevo (para saber si son de movimiento)
    const codigosDestino = new Set([
      ...destinoNombre.keys(),
      ...propias.map((p) => p.nuevo),
    ]);
    const tieneHijas = (codigo: string) =>
      [...codigosDestino].some((x) => x !== codigo && x.startsWith(codigo));

    // Cuentas con movimientos en los períodos que pasan
    const usos: Fila[] = periodosQuePasan.length
      ? await m.query(
          `SELECT id_cuenta, SUM(n)::int AS n FROM (
             SELECT l.id_cuenta, COUNT(*) AS n FROM asiento_linea l
               JOIN asiento_contable a ON a.id = l.id_asiento
              WHERE a.id_persona = $1 AND a.id_periodo = ANY($2) GROUP BY l.id_cuenta
             UNION ALL
             SELECT d.id_cuenta_contable, COUNT(*) FROM comprobante_detalle d
               JOIN comprobante c ON c."idComprobante" = d.id_comprobante
              WHERE c.id_persona = $1 AND c.id_periodo_contable = ANY($2)
                AND d.id_cuenta_contable IS NOT NULL GROUP BY d.id_cuenta_contable
           ) u GROUP BY id_cuenta`,
          [personaId, periodosQuePasan],
        )
      : [];
    const porId = new Map(cuentasActuales.map((c) => [c.id, c]));
    const mapa = new Map<number, string>();
    const cuentasUsadas: InformeMigracion['cuentasUsadas'] = [];
    for (const u of usos) {
      const c = porId.get(Number(u.id_cuenta));
      if (!c) continue;
      const destinoCodigo = nuevoCodigo(c);
      let problema: string | null = null;
      if (!destinoCodigo) problema = 'Sin cuenta equivalente en el plan nuevo';
      else if (tieneHijas(destinoCodigo)) {
        problema = `La cuenta equivalente ${destinoCodigo} agrupa subcuentas: no recibe movimientos`;
      }
      if (destinoCodigo && !problema) mapa.set(c.id, destinoCodigo);
      if (problema) {
        errores.push(
          `Cuenta ${c.codigo} ${c.nombre} (${u.n} movimientos): ${problema.toLowerCase()}. Reasígnala a otra cuenta del plan nuevo`,
        );
      }
      cuentasUsadas.push({
        codigo: c.codigo,
        nombre: c.nombre,
        usos: Number(u.n),
        destino: destinoCodigo,
        nombreDestino: destinoCodigo
          ? (destinoNombre.get(destinoCodigo) ?? c.nombre)
          : null,
        problema,
      });
    }
    // Las subcuentas propias sin destino solo bloquean si tienen movimientos
    for (const p of informePropias.filter((x) => x.problema)) {
      if (!cuentasUsadas.some((u) => u.codigo === p.codigo)) {
        avisos.push(
          `La subcuenta propia ${p.codigo} ${p.nombre} no pasará al plan nuevo: ${p.problema}`,
        );
      }
    }

    // Áreas y cuentas automáticas
    const codigoNuevoDe = (codigo: string | null) => {
      if (!codigo) return null;
      const c = cuentasActuales.find((x) => x.codigo === codigo);
      return c ? nuevoCodigo(c) : null;
    };
    const areasFilas: Fila[] = await m.query(
      `SELECT nombre, cuenta_destino FROM area_contable WHERE id_persona = $1 ORDER BY nombre`,
      [personaId],
    );
    const areas = areasFilas.map((a) => ({
      nombre: a.nombre,
      actual: a.cuenta_destino,
      nuevo: codigoNuevoDe(a.cuenta_destino),
    }));
    for (const a of areas.filter((x) => x.actual && !x.nuevo)) {
      avisos.push(
        `El área ${a.nombre} quedará sin cuenta de destino (su cuenta ${a.actual} no tiene equivalente)`,
      );
    }
    const [conf] = await m.query(
      `SELECT cuentas FROM configuracion_contable WHERE id_persona = $1`,
      [personaId],
    );
    const elegidas = (conf?.cuentas ?? {}) as Record<string, string>;
    const cuentasAutomaticas = Object.entries(elegidas).map(
      ([rol, codigo]) => ({
        rol,
        actual: codigo,
        nuevo: codigoNuevoDe(codigo),
      }),
    );
    for (const c of cuentasAutomaticas.filter((x) => !x.nuevo)) {
      avisos.push(
        `La cuenta automática "${c.rol}" (${c.actual}) volverá a la sugerida por el plan nuevo`,
      );
    }
    if (!periodos.length)
      avisos.push('La empresa aún no tiene períodos: solo cambia su plan');

    const informe: InformeMigracion = {
      planActual: {
        id: actualVista.id,
        codigo: actualVista.codigo,
        nombre: actualVista.nombre,
      },
      planDestino: {
        id: destino.id,
        codigo: destino.codigo,
        nombre: destino.nombre,
      },
      periodos: periodos.map((p) => ({
        id: Number(p.id),
        año: Number(p.año),
        pasa: pasa(p),
      })),
      cuentasPropias: informePropias,
      cuentasUsadas: cuentasUsadas.sort((a, b) =>
        a.codigo.localeCompare(b.codigo),
      ),
      areas,
      cuentasAutomaticas,
      errores,
      avisos,
    };
    return { informe, mapa, propias, periodosQuePasan, periodosQueQuedan };
  }
}
