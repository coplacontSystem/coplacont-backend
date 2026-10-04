import { DocumentoTabular } from './documento-tabular';

/**
 * Un reporte exportable. Cada módulo registra los suyos en `ReportesService`
 * (al iniciar) y quedan disponibles en GET /api/reportes/:clave.
 */
export interface GeneradorReporte<F extends object = object> {
  /** Identificador en la URL, en kebab-case (p. ej. 'costo-ventas'). */
  clave: string;
  /** Clase con los filtros del reporte (se validan con class-validator). */
  filtros?: new () => F;
  /**
   * Arma el documento. Debe filtrar todo por `personaId` (la empresa del
   * usuario) y validar la pertenencia de lo que reciba en los filtros.
   */
  generar(personaId: number, filtros: F): Promise<DocumentoTabular>;
}
