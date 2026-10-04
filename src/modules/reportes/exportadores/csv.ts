import {
  Celda,
  Columna,
  comoNumero,
  decimalesDe,
  DocumentoTabular,
  fechaIso,
} from '../documento-tabular';

/** `;` para que Excel en español lo abra en columnas. */
const SEPARADOR = ';';
/** BOM: Excel reconoce el archivo como UTF-8 (tildes, ñ). */
const BOM = '﻿';

/** Escapa un texto si contiene separador, comillas o saltos de línea. */
function texto(valor: string): string {
  return /[;"\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

function celda(valor: Celda, columna?: Columna): string {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return fechaIso(valor);
  if (columna && columna.tipo !== 'texto' && columna.tipo !== 'fecha') {
    const n = comoNumero(valor);
    // Punto decimal y sin separador de miles: el número se puede volver a leer
    if (n !== null) return n.toFixed(decimalesDe(columna));
  }
  return texto(String(valor));
}

const linea = (valores: string[]) => valores.join(SEPARADOR);

/** CSV con encabezado del reporte y una tabla por sección, separadas por una línea en blanco. */
export function exportarCsv(doc: DocumentoTabular): Buffer {
  const lineas: string[] = [texto(doc.titulo)];
  if (doc.empresa) {
    lineas.push(linea(['Empresa', texto(doc.empresa.razonSocial)]));
    if (doc.empresa.ruc) lineas.push(linea(['RUC', texto(doc.empresa.ruc)]));
  }
  for (const d of doc.datos ?? []) {
    lineas.push(linea([texto(d.etiqueta), texto(d.valor)]));
  }

  for (const seccion of doc.secciones) {
    lineas.push('');
    if (seccion.titulo) lineas.push(texto(seccion.titulo));
    const { columnas } = seccion;
    if (columnas.some((c) => c.grupo)) {
      // El grupo solo en su primera columna (equivale a las celdas combinadas del XLSX)
      lineas.push(
        linea(
          columnas.map((c, i) =>
            c.grupo && c.grupo !== columnas[i - 1]?.grupo ? texto(c.grupo) : '',
          ),
        ),
      );
    }
    lineas.push(linea(columnas.map((c) => texto(c.titulo))));
    for (const fila of [
      ...seccion.filas,
      ...(seccion.totales ? [seccion.totales] : []),
    ]) {
      lineas.push(linea(columnas.map((c) => celda(fila[c.clave], c))));
    }
  }

  return Buffer.from(BOM + lineas.join('\r\n') + '\r\n', 'utf8');
}
