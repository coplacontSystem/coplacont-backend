import type { TipoDocumentoIdentidad } from './documento-identidad';

/** Datos de un RUC (SUNAT) o DNI (RENIEC), ya normalizados. */
export interface DatosContribuyente {
  razonSocial?: string;
  nombres?: string;
  apellidoPaterno?: string;
  apellidoMaterno?: string;
  direccion?: string;
  /** Solo RUC: ACTIVO, BAJA DE OFICIO, SUSPENSION TEMPORAL… */
  estado?: string;
  /** Solo RUC: HABIDO, NO HABIDO, NO HALLADO… */
  condicion?: string;
}

export interface Contribuyente extends DatosContribuyente {
  tipo: TipoDocumentoIdentidad;
  numero: string;
  encontrado: boolean;
  /** consulta: recién traído; cache: guardado; sin-servicio: no se pudo consultar */
  fuente: 'consulta' | 'cache' | 'sin-servicio';
  fechaConsulta?: string;
  /** Avisos para el usuario: no habido, de baja, no se pudo consultar… */
  avisos: string[];
}
