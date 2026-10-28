import * as ExcelJS from 'exceljs';
import { normalizar } from '../importacion.reglas';
import type {
  CpeDocumento,
  CpeLinea,
  CpeParte,
  TipoCpe,
} from '../cpe/cpe.types';

/**
 * Lector de la plantilla Excel de Coplacont: hoja "Comprobantes" (una fila
 * por comprobante, compras y ventas juntas) y hoja "Detalle" (opcional,
 * unida por el N° del comprobante). Un comprobante sin detalle se completa
 * en pantalla o se registra solo con sus totales.
 */

export type OperacionPlantilla = 'compra' | 'venta';

export interface ComprobantePlantilla {
  /** Fila en la hoja Comprobantes (la cabecera es la 1) */
  fila: number;
  operacion: OperacionPlantilla;
  /** Emisor o receptor sin completar: es la empresa, se llena al leer */
  documento: CpeDocumento;
  tipoCambio: number | null;
  avisos: string[];
}

export type LecturaPlantilla = { fila: number } & (
  | { ok: true; datos: ComprobantePlantilla }
  | { ok: false; error: string }
);

export class PlantillaError extends Error {}

export const HOJA_COMPROBANTES = 'Comprobantes';
export const HOJA_DETALLE = 'Detalle';

const SOPORTADOS = new Set(['01', '03', '07', '08']);
const AFECTACION: Record<string, '10' | '20' | '30'> = {
  gravado: '10',
  gravada: '10',
  exonerado: '20',
  exonerada: '20',
  inafecto: '30',
  inafecta: '30',
};

const r2 = (n: number) => Math.round(n * 100) / 100;

type Valor = ExcelJS.CellValue;

/** Texto de una celda, también si es fórmula, enlace o texto enriquecido */
function texto(v: Valor): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return texto(v.result as Valor);
    if ('text' in v) return String(v.text);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    return '';
  }
  return String(v).trim();
}

function numero(v: Valor): number | null {
  const t = texto(v).replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Fecha de Excel, 'dd/mm/aaaa' o 'aaaa-mm-dd' → 'aaaa-mm-dd' */
function fecha(v: Valor): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = texto(v);
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Filas de una hoja como objetos con la cabecera normalizada */
function filasDe(hoja: ExcelJS.Worksheet) {
  const cabecera: string[] = [];
  hoja.getRow(1).eachCell((c, i) => (cabecera[i] = normalizar(texto(c.value))));
  const filas: { fila: number; v: (...nombres: string[]) => Valor }[] = [];
  hoja.eachRow((row, n) => {
    if (n === 1) return;
    const vacia = (row.values as Valor[]).every((x) => texto(x) === '');
    if (vacia) return;
    filas.push({
      fila: n,
      v: (...nombres) => {
        for (const nombre of nombres) {
          const i = cabecera.indexOf(nombre);
          if (i > 0) return row.getCell(i).value;
        }
        return null;
      },
    });
  });
  return filas;
}

export async function leerPlantilla(
  buffer: Buffer,
): Promise<LecturaPlantilla[]> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new PlantillaError('No se pudo abrir el Excel (¿es un .xlsx?)');
  }
  const hoja = libro.worksheets.find(
    (h) => normalizar(h.name) === normalizar(HOJA_COMPROBANTES),
  );
  if (!hoja) {
    throw new PlantillaError(
      `El Excel no tiene la hoja "${HOJA_COMPROBANTES}": usa la plantilla de Coplacont`,
    );
  }
  const hojaDetalle = libro.worksheets.find(
    (h) => normalizar(h.name) === normalizar(HOJA_DETALLE),
  );

  // Detalle agrupado por N° de comprobante
  const detalle = new Map<
    string,
    { fila: number; v: ReturnType<typeof filasDe>[number]['v'] }[]
  >();
  for (const f of hojaDetalle ? filasDe(hojaDetalle) : []) {
    const ref = texto(f.v('n comprobante', 'n'));
    if (!ref) continue;
    detalle.set(ref, [...(detalle.get(ref) ?? []), f]);
  }

  return filasDe(hoja).map(({ fila, v }): LecturaPlantilla => {
    const falla = (error: string): LecturaPlantilla => ({
      fila,
      ok: false,
      error,
    });
    const ref = texto(v('n'));
    const op = normalizar(texto(v('operacion')));
    const operacion: OperacionPlantilla | null =
      op === 'compra' ? 'compra' : op === 'venta' ? 'venta' : null;
    if (!operacion) return falla('Operación debe ser COMPRA o VENTA');
    const tipo = texto(v('tipo comprobante')).padStart(2, '0');
    if (!SOPORTADOS.has(tipo)) {
      return falla(
        `Tipo de comprobante ${tipo || 'vacío'} no soportado (01, 03, 07 u 08)`,
      );
    }
    const serie = texto(v('serie')).toUpperCase();
    const numeroDoc = texto(v('numero')).replace(/^0+(?=\d)/, '');
    const fechaEmision = fecha(v('fecha emision'));
    if (!serie || !numeroDoc) return falla('Faltan la serie o el número');
    if (!fechaEmision)
      return falla('Fecha de emisión inválida (usa DD/MM/AAAA)');

    const avisos: string[] = [];
    const docContraparte = texto(v('n doc contraparte'));
    const contraparte: CpeParte = {
      tipoDocumento:
        texto(v('tipo doc contraparte')) ||
        (docContraparte.length === 11
          ? '6'
          : docContraparte.length === 8
            ? '1'
            : null),
      numeroDocumento: docContraparte,
      razonSocial: texto(v('nombre o razon social')) || 'VARIOS',
      direccion: null,
    };
    const empresa: CpeParte = {
      tipoDocumento: '6',
      numeroDocumento: '',
      razonSocial: '',
      direccion: null,
    };
    const moneda = (texto(v('moneda')) || 'PEN').toUpperCase();
    const tc = numero(v('tipo de cambio'));

    // Detalle
    const lineas: CpeLinea[] = [];
    for (const [i, d] of (detalle.get(ref) ?? []).entries()) {
      const cantidad = numero(d.v('cantidad')) ?? 1;
      const valor = numero(d.v('importe sin igv'));
      const afectacion = AFECTACION[normalizar(texto(d.v('igv')) || 'gravado')];
      const esGasto = normalizar(texto(d.v('tipo linea'))) === 'gasto';
      if (valor == null || Number.isNaN(valor) || !(cantidad > 0)) {
        return falla(`Detalle fila ${d.fila}: cantidad o importe inválido`);
      }
      if (!afectacion) {
        return falla(
          `Detalle fila ${d.fila}: IGV debe ser GRAVADO, EXONERADO o INAFECTO`,
        );
      }
      const codigo = texto(d.v('codigo producto'));
      lineas.push({
        orden: i + 1,
        cantidad,
        unidad: esGasto ? 'ZZ' : 'NIU',
        descripcion:
          texto(d.v('descripcion')) ||
          codigo ||
          (esGasto ? 'Gasto' : 'Producto'),
        codigoVendedor: esGasto ? null : codigo || null,
        codigoGtin: null,
        codigoSunat: null,
        valorUnitario: valor / cantidad,
        precioUnitario: null,
        subtotal: r2(valor),
        igv: afectacion === '10' ? r2(valor * 0.18) : 0,
        isc: 0,
        icbper: 0,
        afectacionIgv: afectacion,
        gratuita: false,
        cuentaContable: esGasto ? texto(d.v('cuenta contable')) || null : null,
      });
    }

    // Totales: los de la cabecera o, si faltan, los del detalle
    const suma = (a: string) =>
      r2(
        lineas
          .filter((l) => l.afectacionIgv === a)
          .reduce((s, l) => s + l.subtotal, 0),
      );
    const cab = {
      gravada: numero(v('base gravada')),
      exonerada: numero(v('exonerado')),
      inafecta: numero(v('inafecto')),
      igv: numero(v('igv')),
      total: numero(v('total')),
    };
    if (Object.values(cab).some((n) => Number.isNaN(n))) {
      return falla('Hay importes que no son números');
    }
    const gravada = cab.gravada ?? suma('10');
    const exonerada = cab.exonerada ?? suma('20');
    const inafecta = cab.inafecta ?? suma('30');
    const igv =
      cab.igv ??
      (lineas.length
        ? r2(lineas.reduce((s, l) => s + l.igv, 0))
        : r2(gravada * 0.18));
    const total = cab.total ?? r2(gravada + exonerada + inafecta + igv);
    if (!lineas.length && gravada + exonerada + inafecta <= 0) {
      return falla('Sin detalle: indica la base gravada, exonerada o inafecta');
    }
    // El IGV del comprobante manda: el redondeo por línea va a la última gravada
    const ultima = [...lineas].reverse().find((l) => l.afectacionIgv === '10');
    const igvLineas = r2(lineas.reduce((s, l) => s + l.igv, 0));
    if (ultima && Math.abs(igv - igvLineas) <= 0.05)
      ultima.igv = r2(ultima.igv + igv - igvLineas);
    if (Math.abs(total - r2(gravada + exonerada + inafecta + igv)) > 0.05) {
      avisos.push(
        'El total no es la suma de las bases y el IGV: revisa la fila',
      );
    }

    const modifica = texto(v('doc que modifica'));
    const documento: CpeDocumento = {
      tipoComprobante: tipo as TipoCpe,
      serie,
      numero: numeroDoc,
      fechaEmision,
      fechaVencimiento: fecha(v('fecha vencimiento')),
      moneda,
      emisor: operacion === 'venta' ? empresa : contraparte,
      receptor: operacion === 'venta' ? contraparte : empresa,
      lineas,
      totales: {
        gravada: r2(gravada),
        exonerada: r2(exonerada),
        inafecta: r2(inafecta),
        gratuita: 0,
        igv: r2(igv),
        isc: 0,
        otrosTributos: 0,
        total: r2(total),
      },
      formaPago: null,
      cuotas: [],
      detraccion: null,
      referencias: modifica
        ? [{ serieNumero: modifica.toUpperCase(), tipo: null }]
        : [],
      motivo: null,
      guias: [],
    };
    return {
      fila,
      ok: true,
      datos: {
        fila,
        operacion,
        documento,
        tipoCambio: moneda === 'PEN' ? 1 : tc && tc > 0 ? tc : null,
        avisos,
      },
    };
  });
}
