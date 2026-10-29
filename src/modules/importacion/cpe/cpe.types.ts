/** 01 factura, 03 boleta, 07 nota de crédito, 08 nota de débito */
export type TipoCpe = '01' | '03' | '07' | '08';

export interface CpeParte {
  /** Catálogo 06: 6 RUC, 1 DNI, 4 CE, 7 pasaporte, 0 otros */
  tipoDocumento: string | null;
  numeroDocumento: string;
  razonSocial: string;
  direccion: string | null;
}

export interface CpeLinea {
  orden: number;
  cantidad: number;
  /** Unidad UN/ECE rec 20 (NIU, BX, KGM, ZZ…) */
  unidad: string;
  descripcion: string;
  codigoVendedor: string | null;
  codigoGtin: string | null;
  codigoSunat: string | null;
  /** Valor unitario sin impuestos */
  valorUnitario: number;
  /** Precio unitario con impuestos (catálogo 16, tipo 01) si viene */
  precioUnitario: number | null;
  /** Valor de venta de la línea sin impuestos */
  subtotal: number;
  igv: number;
  isc: number;
  icbper: number;
  /** Catálogo 07: 10 gravado, 20 exonerado, 30 inafecto, 40 exportación… */
  afectacionIgv: string | null;
  gratuita: boolean;
  /** Plantilla Excel: cuenta de gasto o ingreso indicada para la línea */
  cuentaContable?: string | null;
}

export interface CpeCuota {
  monto: number;
  vencimiento: string | null;
}

export interface CpeDocumento {
  tipoComprobante: TipoCpe;
  serie: string;
  numero: string;
  fechaEmision: string;
  fechaVencimiento: string | null;
  moneda: string;
  emisor: CpeParte;
  receptor: CpeParte;
  lineas: CpeLinea[];
  totales: {
    gravada: number;
    exonerada: number;
    inafecta: number;
    gratuita: number;
    igv: number;
    isc: number;
    otrosTributos: number;
    total: number;
  };
  formaPago: 'contado' | 'credito' | null;
  cuotas: CpeCuota[];
  detraccion: {
    /** Catálogo 54: bien o servicio sujeto */
    codigo: string | null;
    porcentaje: number;
    monto: number;
    moneda: string;
  } | null;
  /** Documentos que modifica una nota */
  referencias: { serieNumero: string; tipo: string | null }[];
  /** Catálogos 09/10: motivo de la nota */
  motivo: { codigo: string | null; descripcion: string | null } | null;
  guias: string[];
}
