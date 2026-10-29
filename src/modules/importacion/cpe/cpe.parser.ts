import { XMLParser } from 'fast-xml-parser';
import type {
  CpeCuota,
  CpeDocumento,
  CpeLinea,
  CpeParte,
  TipoCpe,
} from './cpe.types';

/**
 * Lector de comprobantes electrónicos SUNAT (UBL 2.1): factura y boleta
 * (Invoice), nota de crédito (CreditNote) y nota de débito (DebitNote).
 * Solo lee: no valida la firma ni consulta a SUNAT.
 */

type Nodo = Record<string, any>;

export class CpeError extends Error {}

const LISTAS = new Set([
  'InvoiceLine',
  'CreditNoteLine',
  'DebitNoteLine',
  'TaxSubtotal',
  'TaxTotal',
  'PaymentTerms',
  'BillingReference',
  'DespatchDocumentReference',
  'PartyIdentification',
  'Note',
  'AddressLine',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (nombre) => LISTAS.has(nombre),
});

/** Los XML de SUNAT suelen venir en ISO-8859-1; el resto en UTF-8 */
export function decodificar(buffer: Buffer): string {
  const cabecera = buffer.subarray(0, 200).toString('latin1');
  const m = /encoding\s*=\s*["']([^"']+)["']/i.exec(cabecera);
  const enc = (m?.[1] ?? 'utf-8').toLowerCase();
  const latino = ['iso-8859-1', 'latin1', 'windows-1252', 'cp1252'];
  const texto = new TextDecoder(
    latino.includes(enc) ? 'windows-1252' : 'utf-8',
  ).decode(buffer);
  return texto.replace(/^\uFEFF/, '');
}

const lista = <T = Nodo>(v: unknown): T[] =>
  v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T];

/** Texto de un elemento, tenga o no atributos */
function txt(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const t = (v as Nodo)['#text'];
    return t == null ? '' : String(t).trim();
  }
  return String(v as string | number).trim();
}

const attr = (v: unknown, nombre: string): string =>
  v && typeof v === 'object' ? String((v as Nodo)[`@_${nombre}`] ?? '') : '';

function num(v: unknown): number {
  const t = txt(v);
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const vacio = (s: string) => (s ? s : null);

function parte(nodo: Nodo | undefined): CpeParte {
  const p: Nodo = nodo?.Party ?? {};
  const id = lista(p.PartyIdentification)[0]?.ID;
  const legal: Nodo = p.PartyLegalEntity ?? {};
  const linea = lista(legal.RegistrationAddress?.AddressLine)
    .map((l) => txt(l.Line))
    .find(Boolean);
  return {
    tipoDocumento: attr(id, 'schemeID') || null,
    numeroDocumento: txt(id),
    razonSocial:
      txt(legal.RegistrationName) || txt(p.PartyName?.Name) || 'SIN NOMBRE',
    direccion: linea ?? null,
  };
}

/** Suma de impuestos por código de tributo (catálogo 05) */
function impuestos(taxTotals: Nodo[]) {
  const porCodigo = new Map<string, { base: number; monto: number }>();
  for (const tt of taxTotals) {
    for (const st of lista(tt.TaxSubtotal)) {
      const codigo = txt(st.TaxCategory?.TaxScheme?.ID);
      const prev = porCodigo.get(codigo) ?? { base: 0, monto: 0 };
      porCodigo.set(codigo, {
        base: prev.base + num(st.TaxableAmount),
        monto: prev.monto + num(st.TaxAmount),
      });
    }
  }
  return porCodigo;
}

const RAICES: Record<string, { lineas: string; cantidad: string }> = {
  Invoice: { lineas: 'InvoiceLine', cantidad: 'InvoicedQuantity' },
  CreditNote: { lineas: 'CreditNoteLine', cantidad: 'CreditedQuantity' },
  DebitNote: { lineas: 'DebitNoteLine', cantidad: 'DebitedQuantity' },
};

function linea(n: Nodo, campoCantidad: string, orden: number): CpeLinea {
  const imp = impuestos(lista(n.TaxTotal));
  const sub = lista<Nodo>(n.TaxTotal).flatMap((t) =>
    lista<Nodo>(t.TaxSubtotal),
  );
  const igvSub =
    sub.find((s) =>
      ['1000', '9997', '9998', '9996', '9995', '1016'].includes(
        txt(s.TaxCategory?.TaxScheme?.ID),
      ),
    ) ?? sub[0];
  const afectacion = txt(igvSub?.TaxCategory?.TaxExemptionReasonCode) || null;
  const gratuita = txt(n.FreeOfChargeIndicator) === 'true' || imp.has('9996');
  const cantidad = num(n[campoCantidad]);
  const subtotal = num(n.LineExtensionAmount);
  const precioReferencial = lista<Nodo>(
    n.PricingReference?.AlternativeConditionPrice,
  ).find((p) => txt(p.PriceTypeCode) === '01');
  const valorUnitario =
    num(n.Price?.PriceAmount) || (cantidad ? subtotal / cantidad : 0);
  return {
    orden: Number(txt(n.ID)) || orden,
    cantidad,
    unidad: attr(n[campoCantidad], 'unitCode') || 'NIU',
    descripcion: txt(n.Item?.Description) || 'SIN DESCRIPCIÓN',
    codigoVendedor: vacio(txt(n.Item?.SellersItemIdentification?.ID)),
    codigoGtin: vacio(txt(n.Item?.StandardItemIdentification?.ID)),
    codigoSunat: vacio(
      txt(n.Item?.CommodityClassification?.ItemClassificationCode),
    ),
    valorUnitario,
    precioUnitario: precioReferencial
      ? num(precioReferencial.PriceAmount)
      : null,
    subtotal,
    igv: r2((imp.get('1000')?.monto ?? 0) + (imp.get('1016')?.monto ?? 0)),
    isc: r2(imp.get('2000')?.monto ?? 0),
    icbper: r2(imp.get('7152')?.monto ?? 0),
    afectacionIgv: afectacion,
    gratuita,
  };
}

const TIPO_RAIZ: Record<string, TipoCpe | null> = {
  CreditNote: '07',
  DebitNote: '08',
  Invoice: null,
};

/** Convierte el XML de un CPE en datos. Lanza CpeError si no es un CPE. */
export function leerCpe(entrada: Buffer | string): CpeDocumento {
  const xml = typeof entrada === 'string' ? entrada : decodificar(entrada);
  let arbol: Nodo;
  try {
    arbol = parser.parse(xml, true) as Nodo;
  } catch (e) {
    throw new CpeError(`XML mal formado: ${(e as Error).message}`);
  }
  const raiz = Object.keys(RAICES).find((k) => arbol[k]);
  if (!raiz) {
    throw new CpeError(
      'No es un comprobante electrónico (factura, boleta o nota)',
    );
  }
  const d: Nodo = arbol[raiz];
  const { lineas: campoLineas, cantidad } = RAICES[raiz];

  const tipo =
    TIPO_RAIZ[raiz] ?? (txt(d.InvoiceTypeCode) as TipoCpe | '') ?? '';
  if (!['01', '03', '07', '08'].includes(tipo)) {
    throw new CpeError(`Tipo de comprobante no soportado: ${tipo || 'vacío'}`);
  }
  const id = txt(d.ID);
  const guion = id.lastIndexOf('-');
  if (guion < 1) throw new CpeError(`Serie-número inválido: ${id}`);

  const imp = impuestos(lista(d.TaxTotal));
  const totalMonetario: Nodo =
    d.LegalMonetaryTotal ?? d.RequestedMonetaryTotal ?? {};
  const lineas = lista<Nodo>(d[campoLineas]).map((n, i) =>
    linea(n, cantidad, i + 1),
  );
  if (!lineas.length) throw new CpeError('El comprobante no tiene líneas');

  const terminos = lista<Nodo>(d.PaymentTerms);
  const pago = terminos.filter((t) => txt(t.ID) === 'FormaPago');
  const condicion = pago
    .map((t) => txt(t.PaymentMeansID))
    .find((m) => /^(contado|credito|crédito)$/i.test(m));
  const cuotas: CpeCuota[] = pago
    .filter((t) => /^cuota/i.test(txt(t.PaymentMeansID)))
    .map((t) => ({
      monto: num(t.Amount),
      vencimiento: txt(t.PaymentDueDate) || null,
    }));
  const det = terminos.find((t) => txt(t.ID) === 'Detraccion');

  const referencias = lista<Nodo>(d.BillingReference)
    .map((b) => b.InvoiceDocumentReference as Nodo | undefined)
    .filter((r): r is Nodo => Boolean(r))
    .map((r) => ({
      serieNumero: txt(r.ID),
      tipo: txt(r.DocumentTypeCode) || null,
    }));
  const discrepancia = lista<Nodo>(d.DiscrepancyResponse)[0];

  const gravada = imp.get('1000')?.base ?? 0;
  return {
    tipoComprobante: tipo as TipoCpe,
    serie: id.slice(0, guion).trim(),
    numero: id.slice(guion + 1).trim(),
    fechaEmision: txt(d.IssueDate),
    fechaVencimiento:
      txt(d.DueDate) || cuotas.map((c) => c.vencimiento).find(Boolean) || null,
    moneda: txt(d.DocumentCurrencyCode) || 'PEN',
    emisor: parte(d.AccountingSupplierParty),
    receptor: parte(d.AccountingCustomerParty),
    lineas,
    totales: {
      gravada: r2(gravada),
      exonerada: r2(imp.get('9997')?.base ?? 0),
      inafecta: r2(imp.get('9998')?.base ?? 0),
      gratuita: r2(imp.get('9996')?.base ?? 0),
      igv: r2((imp.get('1000')?.monto ?? 0) + (imp.get('1016')?.monto ?? 0)),
      isc: r2(imp.get('2000')?.monto ?? 0),
      otrosTributos: r2(
        (imp.get('7152')?.monto ?? 0) + (imp.get('9999')?.monto ?? 0),
      ),
      total: r2(num(totalMonetario.PayableAmount)),
    },
    formaPago: condicion
      ? /^contado$/i.test(condicion)
        ? 'contado'
        : 'credito'
      : cuotas.length
        ? 'credito'
        : null,
    cuotas,
    detraccion: det
      ? {
          codigo: vacio(txt(det.PaymentMeansID)),
          porcentaje: num(det.PaymentPercent),
          monto: num(det.Amount),
          moneda: attr(det.Amount, 'currencyID') || 'PEN',
        }
      : null,
    referencias,
    motivo: discrepancia
      ? {
          codigo: vacio(txt(discrepancia.ResponseCode)),
          descripcion: vacio(txt(discrepancia.Description)),
        }
      : null,
    guias: lista<Nodo>(d.DespatchDocumentReference).map((g) =>
      txt(g.ID).replace(/\s+/g, ''),
    ),
  };
}
