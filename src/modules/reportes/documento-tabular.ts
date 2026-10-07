/**
 * Estructura neutra de un reporte tabular. Cada reporte (kardex, costo de
 * ventas, plantillas...) arma un `DocumentoTabular` y los exportadores lo
 * convierten a CSV, XLSX o PDF con el mismo contenido.
 */

export type TipoColumna = 'texto' | 'numero' | 'moneda' | 'cantidad' | 'fecha';

export interface Columna {
  /** Clave del valor en cada fila. */
  clave: string;
  titulo: string;
  tipo: TipoColumna;
  /** Encabezado agrupador (p. ej. "Entradas" sobre cantidad/costo/total). */
  grupo?: string;
  /** Decimales a mostrar (por defecto: moneda 2, cantidad 2, numero 0). */
  decimales?: number;
  /** Ancho aproximado en caracteres (XLSX) o proporción (PDF). */
  ancho?: number;
}

export type Celda = string | number | Date | null | undefined;
export type Fila = Record<string, Celda>;

export interface Seccion {
  /** Nombre corto: hoja de Excel (máx. 31 caracteres). */
  nombre: string;
  /** Título visible sobre la tabla (opcional). */
  titulo?: string;
  columnas: Columna[];
  filas: Fila[];
  /** Fila de totales (en negrita). */
  totales?: Fila;
}

export interface DatosEmpresa {
  razonSocial: string;
  ruc?: string;
  /** Logo como data URL JPG/PNG; el PDF lo pone a la derecha del encabezado. */
  logo?: string | null;
}

export interface DocumentoTabular {
  titulo: string;
  /** Nombre del archivo sin extensión. */
  nombreArchivo: string;
  /**
   * Empresa del encabezado. Sin definir, se completa con la del usuario;
   * null = no mostrarla (el reporte ya la incluye en `datos`, p. ej. formatos SUNAT).
   */
  empresa?: DatosEmpresa | null;
  /** Datos del encabezado: período, producto, almacén, método... */
  datos?: { etiqueta: string; valor: string }[];
  secciones: Seccion[];
  /**
   * Solo las tablas, sin encabezado del reporte (título, empresa, datos): la
   * cabecera de columnas queda en la fila 1. Para plantillas que se vuelven a
   * importar (XLSX y CSV; el PDF lo ignora).
   */
  soloTabla?: boolean;
  /** PDF: horizontal para tablas anchas (kardex). */
  orientacion?: 'vertical' | 'horizontal';
  generado?: Date;
}

export type FormatoExportacion = 'xlsx' | 'csv' | 'pdf';

export interface ArchivoExportado {
  contenido: Buffer;
  tipoContenido: string;
  nombreArchivo: string;
}

/** Decimales efectivos de una columna numérica. */
export function decimalesDe(columna: Columna): number {
  if (columna.decimales !== undefined) return columna.decimales;
  return columna.tipo === 'numero' ? 0 : 2;
}

/** 'YYYY-MM-DD' de una fecha (las fechas contables están en UTC). */
export function fechaIso(valor: Date): string {
  return valor.toISOString().slice(0, 10);
}

/** Valor numérico de una celda o null si no es un número. */
export function comoNumero(valor: Celda): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Nombre de archivo seguro (sin tildes ni caracteres especiales). */
export function nombreSeguro(nombre: string): string {
  return (
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'reporte'
  );
}
