import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AdminDashboard,
  EmpresaDetalle,
  EmpresaFila,
  ItemAtencion,
} from './admin.types';

type Fila = Record<string, any>;

/** 'YYYY-MM-DD' de hoy en Lima */
function hoyLima(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(
    new Date(),
  );
}

function sumarMeses(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const iso = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString() : null;

const DIAS_INACTIVA = 30;
const DIAS_SIN_LOGIN = 7;

/**
 * Panel del administrador de la plataforma. Solo cantidades, estados y
 * actividad: nunca montos de las empresas.
 */
@Injectable()
export class AdminService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private query<T = Fila>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }

  async dashboard(): Promise<AdminDashboard> {
    const hoy = hoyLima();
    const mes = hoy.slice(0, 7);
    const inicioMes = `${mes}-01`;
    const inicioAnterior = `${sumarMeses(mes, -1)}-01`;
    const desde = `${sumarMeses(mes, -11)}-01`;

    const [empresas, usuarios, compMes, actividad, accesos, sinLogin] =
      await Promise.all([
        this.empresas(inicioMes, hoy),
        this.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM "user" WHERE "personaId" IS NOT NULL`,
        ),
        // Mes en curso frente a los mismos días del mes anterior
        this.query<{ actual: string; anterior: string }>(
          `SELECT COUNT(*) FILTER (WHERE "fechaRegistro" >= $1) AS actual,
                  COUNT(*) FILTER (WHERE "fechaRegistro" < $2::date + ($3::date - $1::date + 1))
                    AS anterior
             FROM comprobante WHERE "fechaRegistro" >= $2`,
          [inicioMes, inicioAnterior, hoy],
        ),
        this.actividad(desde),
        this.query(
          `SELECT u.id, u.nombre, u.ultimo_login, u.ultimo_agente, u.avatar,
                  COALESCE(NULLIF(p."razonSocial", ''), p."nombreEmpresa") AS empresa
             FROM "user" u LEFT JOIN persona p ON p.id = u."personaId"
            WHERE u.ultimo_login IS NOT NULL
            ORDER BY u.ultimo_login DESC LIMIT 8`,
        ),
        this.query(
          `SELECT u.id, u.nombre, u.email, u.fecha_creacion, p.id AS id_persona,
                  COALESCE(NULLIF(p."razonSocial", ''), p."nombreEmpresa") AS empresa
             FROM "user" u JOIN persona p ON p.id = u."personaId"
            WHERE u.habilitado AND p.habilitado AND u.ultimo_login IS NULL
              AND u.fecha_creacion <= now() - make_interval(days => $1)
            ORDER BY u.fecha_creacion`,
          [DIAS_SIN_LOGIN],
        ),
      ]);

    const habilitadas = empresas.filter((e) => e.fila.habilitada);
    const limiteInactiva = new Date(Date.now() - DIAS_INACTIVA * 864e5);
    const activas = habilitadas.filter(
      (e) => e.ultimaActividad && new Date(e.ultimaActividad) >= limiteInactiva,
    );

    const atencion: ItemAtencion[] = [];
    for (const e of habilitadas) {
      const base = { idPersona: e.fila.id, empresa: e.fila.razonSocial };
      if (!e.fila.periodo) {
        atencion.push({ ...base, tipo: 'sinPeriodo', severidad: 'alta' });
      } else if (e.fila.periodo.estado === 'vencido') {
        atencion.push({
          ...base,
          tipo: 'periodoVencido',
          severidad: 'alta',
          periodo: { año: e.fila.periodo.año, fin: e.fila.periodo.fin },
        });
      }
    }
    for (const e of habilitadas) {
      const nueva = new Date(e.fila.creada) > limiteInactiva;
      if (!nueva && !activas.includes(e)) {
        atencion.push({
          idPersona: e.fila.id,
          empresa: e.fila.razonSocial,
          tipo: 'inactiva',
          severidad: 'baja',
          ultimaActividad: e.ultimaActividad,
        });
      }
    }
    for (const u of sinLogin) {
      atencion.push({
        tipo: 'sinLogin',
        severidad: 'media',
        idPersona: Number(u.id_persona),
        empresa: u.empresa,
        usuario: {
          id: Number(u.id),
          nombre: u.nombre,
          email: u.email,
          alta: iso(u.fecha_creacion)!,
        },
      });
    }

    const actual = Number(compMes[0]?.actual ?? 0);
    const anterior = Number(compMes[0]?.anterior ?? 0);
    const filas = empresas.map((e) => e.fila);
    return {
      kpis: {
        empresasHabilitadas: habilitadas.length,
        empresasDeshabilitadas: empresas.length - habilitadas.length,
        usuarios: Number(usuarios[0]?.n ?? 0),
        empresasActivas30: activas.length,
        comprobantesMes: actual,
        comprobantesMesAnterior: anterior,
        variacion: anterior
          ? Math.round(((actual - anterior) / anterior) * 1000) / 10
          : null,
      },
      actividad,
      atencion,
      empresas: filas,
      accesos: accesos.map((a) => ({
        idUsuario: Number(a.id),
        nombre: a.nombre,
        empresa: a.empresa ?? null,
        agente: a.ultimo_agente ?? null,
        avatar: a.avatar ?? null,
        fecha: iso(a.ultimo_login)!,
      })),
      altas: [...filas]
        .sort((a, b) => b.creada.localeCompare(a.creada))
        .slice(0, 5)
        .map((e) => ({
          id: e.id,
          razonSocial: e.razonSocial,
          fecha: e.creada,
          usuarios: e.usuarios,
        })),
    };
  }

  /** Empresas con sus contadores; ultimaActividad = último login o comprobante */
  private async empresas(inicioMes: string, hoy: string) {
    const filas = await this.query(
      `SELECT p.id, p.ruc, p.habilitado, p."createdAt",
              COALESCE(NULLIF(p."razonSocial", ''), p."nombreEmpresa") AS razon,
              (SELECT COUNT(*) FROM "user" u WHERE u."personaId" = p.id) AS usuarios,
              (SELECT MAX(u.ultimo_login) FROM "user" u WHERE u."personaId" = p.id) AS ultimo_acceso,
              (SELECT COUNT(*) FROM comprobante c
                WHERE c.id_persona = p.id AND c."fechaRegistro" >= $1) AS comp_mes,
              (SELECT MAX(c."fechaRegistro") FROM comprobante c
                WHERE c.id_persona = p.id) AS ultimo_comp,
              per."año" AS per_anio, per.fin AS per_fin
         FROM persona p
         LEFT JOIN LATERAL (
              SELECT pc."año", to_char(pc."fechaFin", 'YYYY-MM-DD') AS fin
                FROM periodo_contable pc
               WHERE pc.id_persona = p.id AND pc.activo AND NOT pc.cerrado
               ORDER BY pc."año" DESC LIMIT 1) per ON true
        ORDER BY razon`,
      [inicioMes],
    );
    return filas.map((f) => {
      const ultimoAcceso = iso(f.ultimo_acceso);
      const ultimoComp = iso(f.ultimo_comp);
      const ultimaActividad =
        [ultimoAcceso, ultimoComp].filter(Boolean).sort().pop() ?? null;
      const fila: EmpresaFila = {
        id: Number(f.id),
        razonSocial: f.razon,
        ruc: f.ruc,
        habilitada: Boolean(f.habilitado),
        usuarios: Number(f.usuarios),
        periodo: f.per_anio
          ? {
              año: Number(f.per_anio),
              fin: f.per_fin,
              estado: f.per_fin < hoy ? 'vencido' : 'activo',
            }
          : null,
        ultimoAcceso,
        comprobantesMes: Number(f.comp_mes),
        creada: iso(f.createdAt)!,
      };
      return { fila, ultimaActividad };
    });
  }

  private async actividad(desde: string) {
    const filas = await this.query<{
      mes: string;
      comprobantes: string;
      nuevas: string;
    }>(
      `SELECT to_char(m, 'YYYY-MM') AS mes,
              (SELECT COUNT(*) FROM comprobante c
                WHERE c."fechaRegistro" >= m
                  AND c."fechaRegistro" < m + interval '1 month') AS comprobantes,
              (SELECT COUNT(*) FROM persona p
                WHERE p."createdAt" >= m
                  AND p."createdAt" < m + interval '1 month') AS nuevas
         FROM generate_series($1::date, $1::date + interval '11 months', interval '1 month') m
        ORDER BY m`,
      [desde],
    );
    return filas.map((f) => ({
      mes: f.mes,
      comprobantes: Number(f.comprobantes),
      empresasNuevas: Number(f.nuevas),
    }));
  }

  async empresa(id: number): Promise<EmpresaDetalle> {
    const [p] = await this.query(
      `SELECT id, ruc, "razonSocial", "nombreEmpresa", direccion, telefono,
              logo, habilitado, "createdAt"
         FROM persona WHERE id = $1`,
      [id],
    );
    if (!p) throw new NotFoundException('Empresa no encontrada');
    const desde = `${sumarMeses(hoyLima().slice(0, 7), -11)}-01`;
    const [usuarios, periodos, actividad] = await Promise.all([
      this.query(
        `SELECT id, nombre, email, habilitado, "esPrincipal", ultimo_login
           FROM "user" WHERE "personaId" = $1
          ORDER BY "esPrincipal" DESC, nombre`,
        [id],
      ),
      this.query(
        `SELECT id, "año", activo, cerrado, reabierto,
                to_char("fechaInicio", 'YYYY-MM-DD') AS inicio,
                to_char("fechaFin", 'YYYY-MM-DD') AS fin
           FROM periodo_contable WHERE id_persona = $1
          ORDER BY "año" DESC`,
        [id],
      ),
      this.query<{ mes: string; n: string }>(
        `SELECT to_char(m, 'YYYY-MM') AS mes,
                (SELECT COUNT(*) FROM comprobante c
                  WHERE c.id_persona = $2 AND c."fechaRegistro" >= m
                    AND c."fechaRegistro" < m + interval '1 month') AS n
           FROM generate_series($1::date, $1::date + interval '11 months', interval '1 month') m
          ORDER BY m`,
        [desde, id],
      ),
    ]);
    const hoy = hoyLima();
    return {
      id: Number(p.id),
      razonSocial: p.razonSocial || p.nombreEmpresa,
      nombreComercial: p.nombreEmpresa,
      ruc: p.ruc,
      direccion: p.direccion ?? null,
      telefono: p.telefono ?? null,
      logo: p.logo ?? null,
      habilitada: Boolean(p.habilitado),
      creada: iso(p.createdAt)!,
      usuarios: usuarios.map((u) => ({
        id: Number(u.id),
        nombre: u.nombre,
        email: u.email,
        habilitado: Boolean(u.habilitado),
        principal: Boolean(u.esPrincipal),
        ultimoAcceso: iso(u.ultimo_login),
      })),
      periodos: periodos.map((x) => ({
        id: Number(x.id),
        año: Number(x.año),
        inicio: x.inicio,
        fin: x.fin,
        estado: x.cerrado
          ? 'cerrado'
          : x.activo
            ? x.fin < hoy
              ? 'vencido'
              : x.reabierto
                ? 'reabierto'
                : 'activo'
            : x.fin < hoy
              ? 'sinCerrar'
              : 'futuro',
      })),
      actividad: actividad.map((a) => ({
        mes: a.mes,
        comprobantes: Number(a.n),
      })),
    };
  }
}
