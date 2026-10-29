import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ELEMENTOS, nivelDe } from './plan-contable.reglas';
import type {
  ActualizarSubcuentaDto,
  CrearSubcuentaDto,
  CuentaVista,
  ListarCuentasQuery,
  PlanVista,
} from './plan-contable.types';

type Fila = Record<string, any>;

const SELECT_CUENTA = `
  SELECT c.id, c.codigo, c.nombre, c.nivel, c.elemento, c.naturaleza,
         c.id_padre, p.codigo AS codigo_padre, c.id_persona, c.activa,
         EXISTS (SELECT 1 FROM cuenta_contable h
                  WHERE h.id_padre = c.id AND h.activa
                    AND (h.id_persona IS NULL OR h.id_persona = $2)) AS tiene_hijas
    FROM cuenta_contable c
    LEFT JOIN cuenta_contable p ON p.id = c.id_padre
   WHERE c.id_plan = $1 AND (c.id_persona IS NULL OR c.id_persona = $2)`;

function vista(f: Fila): CuentaVista {
  const tieneHijas = Boolean(f.tiene_hijas);
  return {
    id: Number(f.id),
    codigo: f.codigo,
    nombre: f.nombre,
    nivel: Number(f.nivel),
    elemento: f.elemento,
    naturaleza: f.naturaleza,
    idPadre: f.id_padre == null ? null : Number(f.id_padre),
    codigoPadre: f.codigo_padre ?? null,
    propia: f.id_persona != null,
    activa: Boolean(f.activa),
    tieneHijas,
    imputable: Boolean(f.activa) && !tieneHijas,
  };
}

/**
 * Plan de cuentas de cada empresa: las cuentas oficiales del plan asignado
 * más las subcuentas propias que la empresa abre debajo de ellas.
 */
@Injectable()
export class PlanContableService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private query<T = Fila>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }

  /** La cuenta (o alguna de sus subcuentas) tiene líneas en asientos registrados */
  private async tieneMovimientos(idCuenta: number, personaId: number) {
    const [f] = await this.query(
      `SELECT 1 FROM asiento_linea l
         JOIN asiento_contable a ON a.id = l.id_asiento
        WHERE l.id_cuenta = $1 AND a.id_persona = $2 AND a.estado = 'registrado'
        LIMIT 1`,
      [idCuenta, personaId],
    );
    return Boolean(f);
  }

  async planes(): Promise<PlanVista[]> {
    const filas = await this.query(
      `SELECT id, codigo, nombre, norma, codigo_sunat, nota, elementos, cuentas_sugeridas, areas_sugeridas,
              to_char(vigente_desde, 'YYYY-MM-DD') AS desde,
              to_char(vigente_hasta, 'YYYY-MM-DD') AS hasta
         FROM plan_contable ORDER BY vigente_desde`,
    );
    return filas.map((f) => ({
      id: Number(f.id),
      codigo: f.codigo,
      nombre: f.nombre,
      norma: f.norma,
      codigoSunat: f.codigo_sunat,
      vigenteDesde: f.desde,
      vigenteHasta: f.hasta ?? null,
      nota: f.nota ?? null,
      elementos: f.elementos ?? {},
      cuentasSugeridas: f.cuentas_sugeridas ?? {},
      areasSugeridas: f.areas_sugeridas ?? [],
    }));
  }

  /** Plan de la empresa: el que eligió o el plan por defecto */
  async planDe(personaId: number): Promise<PlanVista> {
    const [p] = await this.query<{ id_plan: number | null }>(
      `SELECT COALESCE(per.id_plan_contable,
                       (SELECT id FROM plan_contable WHERE por_defecto ORDER BY id LIMIT 1)) AS id_plan
         FROM persona per WHERE per.id = $1`,
      [personaId],
    );
    const plan = (await this.planes()).find((x) => x.id === Number(p?.id_plan));
    if (!plan)
      throw new NotFoundException('La empresa no tiene un plan contable');
    return plan;
  }

  /** Plan de la empresa con el conteo de cuentas por elemento */
  async resumen(personaId: number) {
    const plan = await this.planDe(personaId);
    const filas = await this.query<{
      elemento: string;
      total: string;
      propias: string;
    }>(
      `SELECT elemento, COUNT(*) AS total, COUNT(id_persona) AS propias
         FROM cuenta_contable
        WHERE id_plan = $1 AND (id_persona IS NULL OR id_persona = $2)
        GROUP BY elemento`,
      [plan.id, personaId],
    );
    const por = new Map(filas.map((f) => [f.elemento, f]));
    return {
      plan,
      elementos: Object.entries(
        Object.keys(plan.elementos ?? {}).length ? plan.elementos : ELEMENTOS,
      ).map(([elemento, nombre]) => ({
        elemento,
        nombre,
        cuentas: Number(por.get(elemento)?.total ?? 0),
        propias: Number(por.get(elemento)?.propias ?? 0),
      })),
    };
  }

  /** Lista plana ordenada por código; el frontend arma el árbol */
  async cuentas(
    personaId: number,
    q: ListarCuentasQuery,
  ): Promise<CuentaVista[]> {
    const plan = await this.planDe(personaId);
    const params: unknown[] = [plan.id, personaId];
    let sql = SELECT_CUENTA;
    if (q.elemento) {
      params.push(q.elemento);
      sql += ` AND c.elemento = $${params.length}`;
    }
    if (q.q) {
      params.push(`%${q.q}%`, `${q.q}%`);
      // Sin tildes y sin mayúsculas: "deposito" encuentra "Depósitos"
      sql += ` AND (translate(lower(c.nombre), 'áéíóúüñ', 'aeiouun') LIKE translate(lower($${params.length - 1}), 'áéíóúüñ', 'aeiouun') OR c.codigo LIKE $${params.length})`;
    }
    sql += ' ORDER BY c.codigo';
    let lista = (await this.query(sql, params)).map(vista);
    if (q.imputables) lista = lista.filter((c) => c.imputable);
    return lista;
  }

  /** Una cuenta con su ruta (ancestros) y sus subcuentas directas */
  async cuenta(personaId: number, codigo: string) {
    const plan = await this.planDe(personaId);
    const [f] = await this.query(`${SELECT_CUENTA} AND c.codigo = $3`, [
      plan.id,
      personaId,
      codigo,
    ]);
    if (!f) throw new NotFoundException(`No existe la cuenta ${codigo}`);
    const prefijos = Array.from({ length: codigo.length - 2 }, (_, i) =>
      codigo.slice(0, i + 2),
    );
    const ruta = prefijos.length
      ? (
          await this.query(
            `${SELECT_CUENTA} AND c.codigo = ANY($3) ORDER BY c.codigo`,
            [plan.id, personaId, prefijos],
          )
        ).map(vista)
      : [];
    const hijas = (
      await this.query(
        `${SELECT_CUENTA} AND c.id_padre = $3 ORDER BY c.codigo`,
        [plan.id, personaId, f.id],
      )
    ).map(vista);
    return { cuenta: vista(f), ruta, hijas };
  }

  async crearSubcuenta(
    personaId: number,
    dto: CrearSubcuentaDto,
  ): Promise<CuentaVista> {
    const plan = await this.planDe(personaId);
    const codigo = dto.codigo;

    let padre: CuentaVista | null = null;
    if (dto.codigoPadre) {
      const [f] = await this.query(`${SELECT_CUENTA} AND c.codigo = $3`, [
        plan.id,
        personaId,
        dto.codigoPadre,
      ]);
      if (!f)
        throw new NotFoundException(`No existe la cuenta ${dto.codigoPadre}`);
      padre = vista(f);
      if (!padre.activa) {
        throw new BadRequestException(
          `La cuenta ${padre.codigo} está desactivada`,
        );
      }
      // Una cuenta con movimientos no puede pasar a agrupar subcuentas
      if (await this.tieneMovimientos(padre.id, personaId)) {
        throw new BadRequestException(
          `La cuenta ${padre.codigo} ya tiene movimientos: no se le pueden abrir subcuentas`,
        );
      }
      const extra = codigo.length - padre.codigo.length;
      if (!codigo.startsWith(padre.codigo) || extra < 1 || extra > 2) {
        throw new BadRequestException(
          `El código debe empezar con ${padre.codigo} y agregar 1 o 2 dígitos`,
        );
      }
    } else if (!/^9\d$/.test(codigo)) {
      // Solo el elemento 9 no tiene cuentas oficiales: la empresa las define
      throw new BadRequestException(
        'Indica la cuenta padre. Solo las cuentas 90–99 se crean sin padre',
      );
    }

    const [existe] = await this.query(
      `SELECT 1 FROM cuenta_contable
        WHERE id_plan = $1 AND codigo = $2 AND (id_persona IS NULL OR id_persona = $3)`,
      [plan.id, codigo, personaId],
    );
    if (existe) throw new ConflictException(`La cuenta ${codigo} ya existe`);

    await this.query(
      `INSERT INTO cuenta_contable
         (id_plan, id_persona, codigo, nombre, nivel, elemento, naturaleza, id_padre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        plan.id,
        personaId,
        codigo,
        dto.nombre,
        nivelDe(codigo),
        codigo[0],
        dto.naturaleza ?? padre?.naturaleza ?? 'deudora',
        padre?.id ?? null,
      ],
    );
    return (await this.cuenta(personaId, codigo)).cuenta;
  }

  async actualizarSubcuenta(
    personaId: number,
    id: number,
    dto: ActualizarSubcuentaDto,
  ): Promise<CuentaVista> {
    const [c] = await this.query(
      `SELECT id, codigo, id_persona FROM cuenta_contable WHERE id = $1`,
      [id],
    );
    if (!c || (c.id_persona != null && Number(c.id_persona) !== personaId)) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    if (c.id_persona == null) {
      throw new ForbiddenException(
        'Las cuentas oficiales del plan no se modifican',
      );
    }
    if (dto.activa === false) {
      const [hija] = await this.query(
        `SELECT 1 FROM cuenta_contable WHERE id_padre = $1 AND activa AND id_persona = $2`,
        [id, personaId],
      );
      if (hija) {
        throw new BadRequestException('Primero desactiva sus subcuentas');
      }
      if (await this.tieneMovimientos(id, personaId)) {
        throw new BadRequestException(
          'La subcuenta tiene movimientos registrados: no se puede desactivar',
        );
      }
    }
    await this.query(
      `UPDATE cuenta_contable
          SET nombre = COALESCE($2, nombre), activa = COALESCE($3, activa),
              fecha_actualizacion = now()
        WHERE id = $1`,
      [id, dto.nombre ?? null, dto.activa ?? null],
    );
    return (await this.cuenta(personaId, c.codigo)).cuenta;
  }

  /**
   * Cuentas de movimiento de la empresa por código (para registrar líneas de
   * gasto o ingreso). Falla con el detalle de las que no sirven.
   */
  async resolverImputables(
    personaId: number,
    codigos: string[],
  ): Promise<Map<string, CuentaVista>> {
    const unicos = [...new Set(codigos)];
    if (!unicos.length) return new Map();
    const plan = await this.planDe(personaId);
    const filas = (
      await this.query(`${SELECT_CUENTA} AND c.codigo = ANY($3)`, [
        plan.id,
        personaId,
        unicos,
      ])
    ).map(vista);
    const por = new Map(filas.map((c) => [c.codigo, c]));
    const errores = unicos.flatMap((codigo) => {
      const c = por.get(codigo);
      if (!c) return [`La cuenta ${codigo} no existe en tu plan`];
      if (!c.activa) return [`La cuenta ${codigo} está desactivada`];
      if (!c.imputable)
        return [
          `La cuenta ${codigo} agrupa subcuentas; usa una de sus subcuentas`,
        ];
      return [];
    });
    if (errores.length) throw new BadRequestException(errores);
    return por;
  }
}
