import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

type Fila = Record<string, any>;

export interface LineaDiario {
  orden: number;
  codigoCuenta: string;
  nombreCuenta: string;
  glosa: string | null;
  debe: number;
  haber: number;
}

export interface AsientoDiario {
  id: number;
  numero: number;
  fecha: string;
  glosa: string;
  referencia: string | null;
  origen: string;
  /** Comprobante de compra o venta (asientos automáticos) */
  documento: {
    tipo: string;
    serie: string;
    numero: string;
    tipoDocContraparte: string | null;
    docContraparte: string | null;
    fechaVencimiento: string | null;
  } | null;
  lineas: LineaDiario[];
}

export interface LibroDiario {
  año: number;
  mes: number;
  asientos: AsientoDiario[];
  totalDebe: number;
  totalHaber: number;
  /** Cuentas de 2 dígitos usadas en el mes (columnas del formato 5.2) */
  cuentas: { codigo: string; nombre: string }[];
}

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
export const nombreMes = (mes: number) => MESES[mes - 1];

const ddmmaaaa = (iso: string | null) =>
  iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';

/** Texto apto para el PLE: sin "|" ni saltos de línea */
const limpio = (t: string | null | undefined, max: number) =>
  (t ?? '')
    .replace(/[|\r\n]+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Libro Diario de formato simplificado (formato 5.2): los asientos
 * registrados del mes, manuales y automáticos, en orden de fecha y número.
 */
@Injectable()
export class LibroDiarioService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async libro(
    personaId: number,
    año: number,
    mes: number,
  ): Promise<LibroDiario> {
    if (!(mes >= 1 && mes <= 12)) throw new BadRequestException('Mes inválido');
    const desde = `${año}-${String(mes).padStart(2, '0')}-01`;
    const filas: Fila[] = await this.dataSource.query(
      `SELECT a.id, a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.glosa, a.referencia,
              a.origen, l.orden, l.glosa AS glosa_linea, l.debe, l.haber,
              c.codigo AS cuenta, c.nombre AS nombre_cuenta, c.id_plan,
              tc.codigo AS tipo_cp, cp.serie, cp.numero AS numero_cp,
              to_char(cp."fechaVencimiento", 'YYYY-MM-DD') AS vencimiento,
              e.tipo AS tipo_entidad, e."numeroDocumento" AS doc_entidad
         FROM asiento_contable a
         JOIN asiento_linea l ON l.id_asiento = a.id
         JOIN cuenta_contable c ON c.id = l.id_cuenta
         LEFT JOIN comprobante cp ON cp."idComprobante" = a.id_comprobante
         LEFT JOIN tabla_detalle tc ON tc."idTablaDetalle" = cp.id_tipo_comprobante
         LEFT JOIN entidades e ON e.id = cp.id_entidad
        WHERE a.id_persona = $1 AND a.estado = 'registrado'
          AND a.fecha >= $2::date AND a.fecha < ($2::date + interval '1 month')
        ORDER BY a.fecha, a.numero, a.id, l.orden`,
      [personaId, desde],
    );

    const asientos = new Map<number, AsientoDiario>();
    let debe = 0;
    let haber = 0;
    for (const f of filas) {
      const id = Number(f.id);
      let a = asientos.get(id);
      if (!a) {
        a = {
          id,
          numero: Number(f.numero),
          fecha: f.fecha,
          glosa: f.glosa,
          referencia: f.referencia,
          origen: f.origen,
          documento: f.tipo_cp
            ? {
                tipo: f.tipo_cp,
                serie: f.serie,
                numero: f.numero_cp,
                // RUC (6) o DNI (1) de la contraparte
                tipoDocContraparte: f.doc_entidad
                  ? f.tipo_entidad === 'JURIDICA'
                    ? '6'
                    : '1'
                  : null,
                docContraparte: f.doc_entidad,
                fechaVencimiento: f.vencimiento,
              }
            : null,
          lineas: [],
        };
        asientos.set(id, a);
      }
      const l: LineaDiario = {
        orden: Number(f.orden),
        codigoCuenta: f.cuenta,
        nombreCuenta: f.nombre_cuenta,
        glosa: f.glosa_linea,
        debe: Number(f.debe),
        haber: Number(f.haber),
      };
      a.lineas.push(l);
      debe += Math.round(l.debe * 100);
      haber += Math.round(l.haber * 100);
    }

    // Columnas del formato 5.2: cuentas de 2 dígitos con su nombre del plan
    const codigos2 = [
      ...new Set(filas.map((f) => String(f.cuenta).slice(0, 2))),
    ].sort();
    const nombres: Fila[] = codigos2.length
      ? await this.dataSource.query(
          `SELECT DISTINCT ON (codigo) codigo, nombre FROM cuenta_contable
            WHERE codigo = ANY($1) AND id_persona IS NULL AND id_plan = ANY($2)
            ORDER BY codigo, id`,
          [codigos2, [...new Set(filas.map((f) => Number(f.id_plan)))]],
        )
      : [];
    const porCodigo = new Map(nombres.map((n) => [n.codigo, n.nombre]));

    return {
      año,
      mes,
      asientos: [...asientos.values()],
      totalDebe: debe / 100,
      totalHaber: haber / 100,
      cuentas: codigos2.map((codigo) => ({
        codigo,
        nombre: porCodigo.get(codigo) ?? '',
      })),
    };
  }

  /**
   * TXT del PLE, formato 5.2 (Libro Diario de formato simplificado): una
   * línea por movimiento de cuenta, campos separados y terminados en "|".
   */
  async ple(personaId: number, año: number, mes: number) {
    const libro = await this.libro(personaId, año, mes);
    const [p] = await this.dataSource.query(
      `SELECT ruc FROM persona WHERE id = $1`,
      [personaId],
    );
    const mm = String(mes).padStart(2, '0');
    const periodo = `${año}${mm}00`;
    const lineas: string[] = [];
    for (const a of libro.asientos) {
      const cuo = String(a.numero).padStart(4, '0');
      for (const l of a.lineas) {
        const d = a.documento;
        lineas.push(
          [
            periodo, // 1 Periodo
            cuo, // 2 CUO
            `M${l.orden}`, // 3 Correlativo del asiento (M = movimiento)
            l.codigoCuenta, // 4 Cuenta contable
            '', // 5 Unidad de operación
            '', // 6 Centro de costos
            'PEN', // 7 Moneda
            d?.tipoDocContraparte ?? '', // 8 Tipo doc. del emisor
            d?.docContraparte ?? '', // 9 N° doc. del emisor
            d?.tipo ?? '00', // 10 Tipo de comprobante (Tabla 10)
            d ? limpio(d.serie, 20) : '', // 11 Serie
            d ? limpio(d.numero, 20) : limpio(a.referencia, 20), // 12 Número
            ddmmaaaa(a.fecha), // 13 Fecha contable
            ddmmaaaa(d?.fechaVencimiento ?? null), // 14 Fecha de vencimiento
            ddmmaaaa(a.fecha), // 15 Fecha de la operación
            limpio(l.glosa || a.glosa, 200), // 16 Glosa
            '', // 17 Glosa referencial
            l.debe.toFixed(2), // 18 Debe
            l.haber.toFixed(2), // 19 Haber
            '', // 20 Dato estructurado
            '1', // 21 Estado de la operación
          ].join('|') + '|',
        );
      }
    }
    const conDatos = lineas.length > 0 ? '1' : '0';
    // LE + RUC + AAAA + MM + 00 + libro 050200 + oportunidad 00 +
    // con información + contenido + moneda soles + generado por PLE
    const nombre = `LE${p?.ruc ?? ''}${año}${mm}00050200${'00'}${conDatos}111.txt`;
    return {
      nombre,
      contenido: lineas.join('\r\n') + (lineas.length ? '\r\n' : ''),
    };
  }

  static etiqueta(año: number, mes: number) {
    return `${nombreMes(mes)} ${año}`;
  }
}

export { ddmmaaaa };
