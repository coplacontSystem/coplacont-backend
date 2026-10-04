import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { COMPROBANTE, OPERACION } from 'src/common/catalogo.service';
import { KardexMaterializadoService } from '../inventario/valoracion/kardex-materializado.service';
import { Dashboard, KpiComprobantes } from './dashboard.types';

type Fila = Record<string, string | number | null>;

const LIMITE_ALERTAS = 10;
const LIMITE_TOP = 5;
const LIMITE_MOVIMIENTOS = 8;

/**
 * Comprobantes de compra y venta de la empresa con su signo (las notas de
 * crédito restan) y el factor para llevar el monto a soles. Parámetro $1: empresa.
 */
const DOCUMENTOS = `
  docs AS (
    SELECT c."idComprobante" AS id, c.id_entidad, c."fechaEmision" AS fecha,
           op.codigo AS operacion,
           CASE WHEN tc.codigo = '${COMPROBANTE.NOTA_CREDITO}' THEN -1 ELSE 1 END AS signo,
           CASE WHEN c.moneda = 'USD' THEN COALESCE(c."tipoCambio", 1) ELSE 1 END AS fx,
           COALESCE(t."totalGravada", 0) + COALESCE(t."totalExonerada", 0)
             + COALESCE(t."totalInafecta", 0) AS base,
           COALESCE(t."totalIgv", 0) AS igv
      FROM comprobante c
      JOIN tabla_detalle op ON op."idTablaDetalle" = c.id_tipo_operacion
      JOIN tabla_detalle tc ON tc."idTablaDetalle" = c.id_tipo_comprobante
      LEFT JOIN comprobante_totales t ON t.id_comprobante = c."idComprobante"
     WHERE c.id_persona = $1
       AND op.codigo IN ('${OPERACION.VENTA}', '${OPERACION.COMPRA}')
  )`;

const redondear = (n: number, decimales = 2) =>
  Math.round(n * 10 ** decimales) / 10 ** decimales;

const num = (v: unknown) => Number(v) || 0;

/** 'YYYY-MM' desplazado `delta` meses. */
function sumarMeses(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1 + delta, 1));
  return fecha.toISOString().slice(0, 7);
}

function variacion(actual: number, anterior: number): number | null {
  if (Math.abs(anterior) < 0.005) return null;
  return redondear(((actual - anterior) / Math.abs(anterior)) * 100, 1);
}

/** Mes actual en Lima. */
function mesActual(): string {
  return new Date()
    .toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
    .slice(0, 7);
}

/**
 * Datos de la portada de una empresa. Cada bloque es una consulta agregada;
 * se ejecutan en paralelo y siempre filtradas por la empresa.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly kardex: KardexMaterializadoService,
  ) {}

  private query<T = Fila>(sql: string, params: unknown[]): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }

  async obtener(personaId: number, periodo?: string): Promise<Dashboard> {
    const mes = periodo ?? mesActual();
    const desde = `${sumarMeses(mes, -11)}-01`;
    const inicioMes = `${mes}-01`;
    const finMes = `${sumarMeses(mes, 1)}-01`; // exclusivo

    // El costo de ventas y el inventario salen del kardex materializado
    const inventarios = await this.query<{ id: string }>(
      `SELECT i.id FROM inventario i JOIN almacen a ON a.id = i.id_almacen
        WHERE a.id_persona = $1`,
      [personaId],
    );
    await this.kardex.asegurarAlDia(inventarios.map((i) => Number(i.id)));

    const [
      serie,
      periodoInfo,
      inventario,
      alertas,
      topProductos,
      topEntidades,
      ultimos,
    ] = await Promise.all([
      this.serieMensual(personaId, desde, finMes),
      this.periodo(personaId, inicioMes, finMes),
      this.inventario(personaId),
      this.alertas(personaId),
      this.topProductos(personaId, inicioMes, finMes),
      this.topEntidades(personaId, inicioMes, finMes),
      this.ultimosMovimientos(personaId),
    ]);

    const meses = Array.from({ length: 12 }, (_, i) => sumarMeses(mes, i - 11));
    const delMes = (m: string) =>
      serie.get(m) ?? {
        ventas: 0,
        compras: 0,
        costoVentas: 0,
        cantVentas: 0,
        cantCompras: 0,
        igvVentas: 0,
        igvCompras: 0,
      };
    const actual = delMes(mes);
    const anterior = delMes(sumarMeses(mes, -1));
    const kpi = (
      total: number,
      cantidad: number,
      previo: number,
    ): KpiComprobantes => ({
      total: redondear(total),
      cantidad,
      variacion: variacion(total, previo),
    });
    const margen = actual.ventas - actual.costoVentas;

    return {
      periodo: { mes, ...periodoInfo },
      kpis: {
        ventas: kpi(actual.ventas, actual.cantVentas, anterior.ventas),
        compras: kpi(actual.compras, actual.cantCompras, anterior.compras),
        costoVentas: redondear(actual.costoVentas),
        margen: {
          monto: redondear(margen),
          porcentaje:
            Math.abs(actual.ventas) < 0.005
              ? null
              : redondear((margen / actual.ventas) * 100, 1),
        },
        igv: {
          ventas: redondear(actual.igvVentas),
          compras: redondear(actual.igvCompras),
          saldo: redondear(actual.igvVentas - actual.igvCompras),
        },
      },
      serieMensual: meses.map((m) => {
        const d = delMes(m);
        return {
          mes: m,
          ventas: redondear(d.ventas),
          compras: redondear(d.compras),
          costoVentas: redondear(d.costoVentas),
        };
      }),
      inventario,
      alertas,
      topProductos,
      ...topEntidades,
      ultimosMovimientos: ultimos,
    };
  }

  /** Ventas, compras, IGV y costo de ventas por mes, en soles. */
  private async serieMensual(personaId: number, desde: string, hasta: string) {
    const [comprobantes, costos] = await Promise.all([
      this.query(
        `WITH ${DOCUMENTOS}
         SELECT to_char(fecha, 'YYYY-MM') AS mes, operacion,
                SUM(signo * base * fx) AS base, SUM(signo * igv * fx) AS igv,
                COUNT(*) AS cantidad
           FROM docs
          WHERE fecha >= $2::date AND fecha < $3::date
          GROUP BY 1, 2`,
        [personaId, desde, hasta],
      ),
      // Salidas por venta al costo menos las devoluciones (reingresan al costo)
      this.query(
        `SELECT to_char(k.dia, 'YYYY-MM') AS mes,
                SUM(CASE WHEN k.tipo = 'SALIDA' THEN k.costo_total
                         ELSE -k.costo_total END) AS costo
           FROM kardex_linea k
           JOIN movimiento_detalles md ON md.id = k.id_movimiento_detalle
           JOIN movimientos m ON m.id = md.id_movimiento
           JOIN comprobante c ON c."idComprobante" = m.id_comprobante
           JOIN tabla_detalle op ON op."idTablaDetalle" = c.id_tipo_operacion
          WHERE c.id_persona = $1 AND op.codigo = '${OPERACION.VENTA}'
            AND k.dia >= $2::date AND k.dia < $3::date
          GROUP BY 1`,
        [personaId, desde, hasta],
      ),
    ]);

    const serie = new Map<
      string,
      {
        ventas: number;
        compras: number;
        costoVentas: number;
        cantVentas: number;
        cantCompras: number;
        igvVentas: number;
        igvCompras: number;
      }
    >();
    const de = (mes: string) => {
      let fila = serie.get(mes);
      if (!fila) {
        fila = {
          ventas: 0,
          compras: 0,
          costoVentas: 0,
          cantVentas: 0,
          cantCompras: 0,
          igvVentas: 0,
          igvCompras: 0,
        };
        serie.set(mes, fila);
      }
      return fila;
    };
    for (const f of comprobantes) {
      const fila = de(String(f.mes));
      if (f.operacion === OPERACION.VENTA) {
        fila.ventas += num(f.base);
        fila.igvVentas += num(f.igv);
        fila.cantVentas += num(f.cantidad);
      } else {
        fila.compras += num(f.base);
        fila.igvCompras += num(f.igv);
        fila.cantCompras += num(f.cantidad);
      }
    }
    for (const f of costos) de(String(f.mes)).costoVentas += num(f.costo);
    return serie;
  }

  /** Período contable del mes (o el activo), método y tipo de cambio. */
  private async periodo(personaId: number, inicioMes: string, finMes: string) {
    const [[p], [tc]] = await Promise.all([
      this.query(
        `SELECT p.id, p."año", p.cerrado,
                to_char(p."fechaFin", 'YYYY-MM-DD') AS cierre,
                COALESCE(p."metodoValoracion"::text,
                         cfg."metodoCalculoCosto"::text) AS metodo
           FROM periodo_contable p
           LEFT JOIN configuracion_periodo cfg ON cfg.id_persona = p.id_persona
          WHERE p.id_persona = $1
          ORDER BY (p."fechaInicio" <= $2::date AND p."fechaFin" >= $2::date) DESC,
                   p.activo DESC, p."fechaInicio" DESC
          LIMIT 1`,
        [personaId, inicioMes],
      ),
      this.query(
        `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, compra, venta
           FROM tipo_cambio
          WHERE fecha < LEAST($1::date, (now() AT TIME ZONE 'America/Lima')::date + 1)
          ORDER BY fecha DESC LIMIT 1`,
        [finMes],
      ),
    ]);

    const hoy = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Lima',
    });
    const dias = (fin: string) =>
      Math.round((Date.parse(fin) - Date.parse(hoy)) / 86_400_000);

    return {
      idPeriodoContable: p ? Number(p.id) : null,
      año: p ? Number(p.año) : null,
      cerrado: Boolean(p?.cerrado),
      metodoValoracion: (p?.metodo as string | null) ?? null,
      cierre: (p?.cierre as string | null) ?? null,
      diasParaCierre: p?.cierre ? dias(String(p.cierre)) : null,
      tipoCambio: tc
        ? {
            fecha: String(tc.fecha),
            compra: num(tc.compra),
            venta: num(tc.venta),
          }
        : null,
    };
  }

  /** Valor actual del stock (saldo del kardex materializado). */
  private async inventario(personaId: number) {
    const filas = await this.query(
      `SELECT a.id, a.nombre,
              COALESCE(SUM(s.valor), 0) AS valor,
              COUNT(DISTINCT i.id_producto) FILTER (WHERE s.cantidad > 0) AS con_stock
         FROM almacen a
         JOIN inventario i ON i.id_almacen = a.id
         LEFT JOIN inventario_saldo s ON s.id_inventario = i.id
        WHERE a.id_persona = $1
        GROUP BY a.id, a.nombre
        ORDER BY valor DESC`,
      [personaId],
    );
    const [{ productos }] = await this.query(
      `SELECT COUNT(DISTINCT i.id_producto) AS productos
         FROM inventario i
         JOIN almacen a ON a.id = i.id_almacen
         JOIN inventario_saldo s ON s.id_inventario = i.id
        WHERE a.id_persona = $1 AND s.cantidad > 0`,
      [personaId],
    );
    const porAlmacen = filas.map((f) => ({
      idAlmacen: Number(f.id),
      nombre: String(f.nombre),
      valor: redondear(num(f.valor)),
    }));
    return {
      valorTotal: redondear(porAlmacen.reduce((s, a) => s + a.valor, 0)),
      productosConStock: num(productos),
      porAlmacen,
    };
  }

  /** Stock por debajo del mínimo y faltantes de kardex (salidas sin stock). */
  private async alertas(personaId: number) {
    const [stockBajo, faltantes] = await Promise.all([
      this.query(
        `SELECT i.id, p.nombre AS producto, a.nombre AS almacen,
                COALESCE(s.cantidad, 0) AS stock, p."stockMinimo" AS minimo,
                COUNT(*) OVER () AS total
           FROM inventario i
           JOIN almacen a ON a.id = i.id_almacen
           JOIN producto p ON p.id = i.id_producto
           LEFT JOIN inventario_saldo s ON s.id_inventario = i.id
          WHERE a.id_persona = $1 AND p.estado AND COALESCE(p."stockMinimo", 0) > 0
            AND COALESCE(s.cantidad, 0) < p."stockMinimo"
          ORDER BY COALESCE(s.cantidad, 0) / p."stockMinimo", p.nombre
          LIMIT ${LIMITE_ALERTAS}`,
        [personaId],
      ),
      this.query(
        `SELECT f.*, COUNT(*) OVER () AS total
           FROM (
             SELECT DISTINCT ON (k.id_inventario)
                    k.id_inventario AS id, p.nombre AS producto, a.nombre AS almacen,
                    to_char(k.dia, 'YYYY-MM-DD') AS fecha, k.faltante
               FROM kardex_linea k
               JOIN inventario i ON i.id = k.id_inventario
               JOIN almacen a ON a.id = i.id_almacen
               JOIN producto p ON p.id = i.id_producto
              WHERE a.id_persona = $1 AND k.faltante > 0
              ORDER BY k.id_inventario, k.dia DESC, k.orden DESC
           ) f
          ORDER BY f.fecha DESC
          LIMIT ${LIMITE_ALERTAS}`,
        [personaId],
      ),
    ]);
    return {
      totalStockBajo: num(stockBajo[0]?.total),
      totalFaltantes: num(faltantes[0]?.total),
      stockBajo: stockBajo.map((f) => ({
        idInventario: Number(f.id),
        producto: String(f.producto),
        almacen: String(f.almacen),
        stock: num(f.stock),
        minimo: num(f.minimo),
      })),
      faltantes: faltantes.map((f) => ({
        idInventario: Number(f.id),
        producto: String(f.producto),
        almacen: String(f.almacen),
        fecha: String(f.fecha),
        cantidad: num(f.faltante),
      })),
    };
  }

  /** Productos más vendidos del mes por monto (sin IGV, en soles). */
  private async topProductos(personaId: number, desde: string, hasta: string) {
    const filas = await this.query(
      `WITH ${DOCUMENTOS}
       SELECT p.id, p.codigo, p.nombre,
              SUM(docs.signo * d.cantidad) AS cantidad,
              SUM(docs.signo * d.subtotal * docs.fx) AS monto
         FROM docs
         JOIN comprobante_detalle d ON d.id_comprobante = docs.id
         JOIN inventario i ON i.id = d.id_inventario
         JOIN producto p ON p.id = i.id_producto
        WHERE docs.operacion = '${OPERACION.VENTA}'
          AND docs.fecha >= $2::date AND docs.fecha < $3::date
        GROUP BY p.id, p.codigo, p.nombre
       HAVING SUM(docs.signo * d.subtotal * docs.fx) > 0
        ORDER BY monto DESC
        LIMIT ${LIMITE_TOP}`,
      [personaId, desde, hasta],
    );
    return filas.map((f) => ({
      id: Number(f.id),
      codigo: String(f.codigo ?? ''),
      nombre: String(f.nombre),
      cantidad: num(f.cantidad),
      monto: redondear(num(f.monto)),
    }));
  }

  /** Top clientes (ventas) y proveedores (compras) del mes. */
  private async topEntidades(personaId: number, desde: string, hasta: string) {
    const filas = await this.query(
      `WITH ${DOCUMENTOS},
       ranking AS (
         SELECT docs.operacion, e.id, e."numeroDocumento" AS documento,
                COALESCE(NULLIF(e."razonSocial", ''),
                         TRIM(CONCAT_WS(' ', e.nombre, e."apellidoPaterno", e."apellidoMaterno"))) AS nombre,
                SUM(docs.signo * docs.base * docs.fx) AS monto,
                COUNT(*) AS comprobantes,
                ROW_NUMBER() OVER (PARTITION BY docs.operacion
                                   ORDER BY SUM(docs.signo * docs.base * docs.fx) DESC) AS puesto
           FROM docs
           JOIN entidades e ON e.id = docs.id_entidad
          WHERE docs.fecha >= $2::date AND docs.fecha < $3::date
          GROUP BY docs.operacion, e.id
       )
       SELECT * FROM ranking WHERE puesto <= ${LIMITE_TOP} AND monto > 0
        ORDER BY operacion, puesto`,
      [personaId, desde, hasta],
    );
    const de = (operacion: string) =>
      filas
        .filter((f) => f.operacion === operacion)
        .map((f) => ({
          id: Number(f.id),
          nombre: String(f.nombre),
          documento: String(f.documento),
          monto: redondear(num(f.monto)),
          comprobantes: num(f.comprobantes),
        }));
    return {
      topClientes: de(OPERACION.VENTA),
      topProveedores: de(OPERACION.COMPRA),
    };
  }

  /** Últimas compras, ventas y transferencias (una fila por transferencia). */
  private async ultimosMovimientos(personaId: number) {
    const filas = await this.query(
      `SELECT c."idComprobante" AS id, op.codigo AS operacion,
              tc.descripcion AS tipo_comprobante,
              to_char(c."fechaEmision", 'YYYY-MM-DD') AS fecha,
              c.serie, c.numero, c.moneda, t."totalGeneral" AS total,
              COALESCE(NULLIF(e."razonSocial", ''),
                       NULLIF(TRIM(CONCAT_WS(' ', e.nombre, e."apellidoPaterno", e."apellidoMaterno")), '')) AS entidad
         FROM comprobante c
         JOIN tabla_detalle op ON op."idTablaDetalle" = c.id_tipo_operacion
         JOIN tabla_detalle tc ON tc."idTablaDetalle" = c.id_tipo_comprobante
         LEFT JOIN comprobante_totales t ON t.id_comprobante = c."idComprobante"
         LEFT JOIN entidades e ON e.id = c.id_entidad
        WHERE c.id_persona = $1 AND op.codigo = ANY($2)
        ORDER BY c."fechaEmision" DESC, c."idComprobante" DESC
        LIMIT ${LIMITE_MOVIMIENTOS}`,
      [
        personaId,
        [OPERACION.VENTA, OPERACION.COMPRA, OPERACION.TRANSFERENCIA_SALIDA],
      ],
    );
    const tipo = (codigo: unknown) =>
      codigo === OPERACION.VENTA
        ? ('VENTA' as const)
        : codigo === OPERACION.COMPRA
          ? ('COMPRA' as const)
          : ('TRANSFERENCIA' as const);
    return filas.map((f) => ({
      id: Number(f.id),
      tipo: tipo(f.operacion),
      tipoComprobante: String(f.tipo_comprobante),
      fecha: String(f.fecha),
      serie: String(f.serie),
      numero: String(f.numero),
      entidad: (f.entidad as string | null) ?? null,
      total: redondear(num(f.total)),
      moneda: String(f.moneda),
    }));
  }
}
