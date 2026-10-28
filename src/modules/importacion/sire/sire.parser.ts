import { normalizar } from '../importacion.reglas';
import type { CpeDocumento, CpeParte, TipoCpe } from '../cpe/cpe.types';

/**
 * Lector de las propuestas que exporta SIRE de SUNAT en TXT (separado por |):
 * Registro de Ventas (RVIE) y Registro de Compras (RCE). Solo traen la
 * cabecera y los importes de cada comprobante, no el detalle de productos.
 * Las columnas se ubican por su nombre, no por su posición.
 */

export type LibroSire = 'ventas' | 'compras';

export interface FilaSire {
  /** Línea del archivo (la cabecera es la 1) */
  fila: number;
  /** RUC del titular del libro: debe ser la empresa */
  rucTitular: string;
  documento: CpeDocumento;
  tipoCambio: number | null;
  avisos: string[];
}

export type LecturaSire = { fila: number } & (
  | { ok: true; datos: FilaSire }
  | { ok: false; error: string }
);

export class SireError extends Error {}

const SOPORTADOS = new Set(['01', '03', '07', '08']);

/** Primera columna que existe entre varios nombres posibles */
function columnas(cabecera: string[]) {
  const indice = new Map(cabecera.map((c, i) => [normalizar(c), i]));
  return (...nombres: string[]) => {
    for (const n of nombres) {
      const i = indice.get(n);
      if (i !== undefined) return i;
    }
    return -1;
  };
}

/** UTF-8 si es válido; si no, Windows-1252 (exportaciones antiguas) */
export function decodificarTexto(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

const num = (v: string | undefined) => {
  const n = Number((v ?? '').trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** dd/mm/aaaa → aaaa-mm-dd */
function fecha(v: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function leerSire(entrada: Buffer | string): {
  libro: LibroSire;
  filas: LecturaSire[];
} {
  const texto =
    typeof entrada === 'string' ? entrada : decodificarTexto(entrada);
  const lineas = texto.split(/\r?\n/);
  const cabecera = (lineas[0] ?? '').split('|');
  const col = columnas(cabecera);

  const libro: LibroSire | null =
    col('bi gravado dg') >= 0
      ? 'compras'
      : col('bi gravada') >= 0
        ? 'ventas'
        : null;
  if (!libro) {
    throw new SireError(
      'No es una propuesta de SIRE (Registro de Ventas o de Compras)',
    );
  }

  const c = {
    ruc: col('ruc'),
    titular: col('razon social', 'apellidos y nombres o razon social'),
    emision: col('fecha de emision'),
    vencimiento: col('fecha vcto pago'),
    tipo: col('tipo cp doc'),
    serie: col('serie del cdp'),
    numero: col('nro cp o doc nro inicial rango'),
    numeroFinal: col('nro final rango'),
    tipoDoc: col('tipo doc identidad'),
    nroDoc: col('nro doc identidad'),
    nombre: col('apellidos nombres razon social'),
    total: col('total cp'),
    moneda: col('moneda'),
    tc: col('tipo cambio', 'tipo de cambio'),
    modFecha: col('fecha emision doc modificado'),
    modTipo: col('tipo cp modificado'),
    modSerie: col('serie cp modificado'),
    modNumero: col('nro cp modificado'),
    isc: col('isc'),
    icbper: col('icbper'),
    // Ventas
    exportacion: col('valor facturado exportacion'),
    biGravada: col('bi gravada'),
    dsctoBi: col('dscto bi'),
    igv: col('igv ipm'),
    dsctoIgv: col('dscto igv ipm'),
    exonerado: col('mto exonerado'),
    inafecto: col('mto inafecto'),
    ivap: col('ivap'),
    otros: col('otros tributos', 'otros trib cargos'),
    // Compras
    dg: col('bi gravado dg'),
    igvDg: col('igv ipm dg'),
    dgng: col('bi gravado dgng'),
    igvDgng: col('igv ipm dgng'),
    dng: col('bi gravado dng'),
    igvDng: col('igv ipm dng'),
    ng: col('valor adq ng'),
  };
  for (const [nombre, i] of Object.entries({
    ruc: c.ruc,
    emision: c.emision,
    tipo: c.tipo,
    serie: c.serie,
    numero: c.numero,
    total: c.total,
  })) {
    if (i < 0) throw new SireError(`Falta la columna ${nombre} en el TXT`);
  }

  const filas: LecturaSire[] = [];
  lineas.slice(1).forEach((linea, i) => {
    if (!linea.trim()) return;
    const fila = i + 2;
    const v = linea.split('|');
    const val = (k: number) => (k >= 0 ? (v[k] ?? '').trim() : '');
    const n = (k: number) => (k >= 0 ? num(v[k]) : 0);

    const tipo = val(c.tipo).padStart(2, '0');
    const serie = val(c.serie);
    const numero = val(c.numero).replace(/^0+(?=\d)/, '');
    const id = `${serie}-${numero}`;
    if (!SOPORTADOS.has(tipo)) {
      filas.push({
        fila,
        ok: false,
        error: `${id}: tipo de comprobante ${tipo} no soportado (solo facturas, boletas y notas)`,
      });
      return;
    }
    const fechaEmision = fecha(val(c.emision));
    if (!serie || !numero || !fechaEmision) {
      filas.push({ fila, ok: false, error: 'Faltan serie, número o fecha' });
      return;
    }

    const avisos: string[] = [];
    const finRango = val(c.numeroFinal).replace(/^0+(?=\d)/, '');
    if (finRango && finRango !== numero) {
      avisos.push(
        `Resumen de boletas del ${numero} al ${finRango}: se registra como un solo comprobante`,
      );
    }

    const titular: CpeParte = {
      tipoDocumento: '6',
      numeroDocumento: val(c.ruc),
      razonSocial: val(c.titular) || val(c.ruc),
      direccion: null,
    };
    const docContraparte = val(c.nroDoc);
    const sinDocumento = !docContraparte || docContraparte === '-';
    const contraparte: CpeParte = {
      tipoDocumento: sinDocumento ? null : val(c.tipoDoc) || null,
      numeroDocumento: sinDocumento ? '' : docContraparte,
      razonSocial: val(c.nombre) || 'VARIOS',
      direccion: null,
    };

    let gravada: number;
    let igv: number;
    let inafecta: number;
    let exonerada = 0;
    if (libro === 'ventas') {
      gravada = n(c.biGravada) + n(c.dsctoBi);
      igv = n(c.igv) + n(c.dsctoIgv);
      exonerada = n(c.exonerado);
      inafecta = n(c.inafecto) + n(c.exportacion);
      if (n(c.exportacion) > 0) {
        avisos.push('Incluye exportación: se registra como inafecta');
      }
      if (n(c.ivap) > 0) {
        avisos.push('El IVAP (arroz pilado) no se registra por separado');
      }
    } else {
      gravada = n(c.dg) + n(c.dgng) + n(c.dng);
      igv = n(c.igvDg) + n(c.igvDgng) + n(c.igvDng);
      inafecta = n(c.ng);
    }

    const moneda = val(c.moneda) || 'PEN';
    const tc = n(c.tc);
    const modSerie = val(c.modSerie);
    const modNumero = val(c.modNumero).replace(/^0+(?=\d)/, '');

    const documento: CpeDocumento = {
      tipoComprobante: tipo as TipoCpe,
      serie,
      numero,
      fechaEmision,
      fechaVencimiento: fecha(val(c.vencimiento)),
      moneda,
      emisor: libro === 'ventas' ? titular : contraparte,
      receptor: libro === 'ventas' ? contraparte : titular,
      lineas: [],
      totales: {
        gravada: r2(gravada),
        exonerada: r2(exonerada),
        inafecta: r2(inafecta),
        gratuita: 0,
        igv: r2(igv),
        isc: r2(n(c.isc)),
        otrosTributos: r2(n(c.icbper) + n(c.otros)),
        total: r2(n(c.total)),
      },
      formaPago: null,
      cuotas: [],
      detraccion: null,
      referencias:
        modSerie && modNumero
          ? [
              {
                serieNumero: `${modSerie}-${modNumero}`,
                tipo: val(c.modTipo) || null,
              },
            ]
          : [],
      motivo: null,
      guias: [],
    };
    filas.push({
      fila,
      ok: true,
      datos: {
        fila,
        rucTitular: titular.numeroDocumento,
        documento,
        tipoCambio: moneda === 'PEN' ? 1 : tc > 0 ? tc : null,
        avisos,
      },
    });
  });
  return { libro, filas };
}
