import * as ExcelJS from 'exceljs';
import {
  Columna,
  comoNumero,
  decimalesDe,
  DocumentoTabular,
  Fila,
  Seccion,
} from '../documento-tabular';

const GRIS = 'FFE9ECEF';
const BORDE: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
};

/** Formato numérico de Excel para una columna. */
function formatoNumero(columna: Columna): string | undefined {
  if (columna.tipo === 'fecha') return 'dd/mm/yyyy';
  if (columna.tipo === 'texto') return undefined;
  const decimales = decimalesDe(columna);
  return decimales > 0 ? `#,##0.${'0'.repeat(decimales)}` : '#,##0';
}

/** Nombre de hoja válido y único (máx. 31 caracteres, sin : \ / ? * [ ]). */
function nombreHoja(nombre: string, usados: Set<string>): string {
  const base =
    nombre
      .replace(/[:\\/?*[\]]/g, ' ')
      .slice(0, 31)
      .trim() || 'Hoja';
  let candidato = base;
  for (let i = 2; usados.has(candidato.toLowerCase()); i++) {
    candidato = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  }
  usados.add(candidato.toLowerCase());
  return candidato;
}

/**
 * XLSX con una hoja por sección: encabezado del reporte, cabeceras con estilo
 * (y fila de grupos si hay), números reales con formato y totales en negrita.
 */
export async function exportarXlsx(doc: DocumentoTabular): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Coplacont';
  libro.created = doc.generado ?? new Date();
  const usados = new Set<string>();

  for (const seccion of doc.secciones) {
    const hoja = libro.addWorksheet(nombreHoja(seccion.nombre, usados));
    escribirSeccion(hoja, doc, seccion);
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

function escribirSeccion(
  hoja: ExcelJS.Worksheet,
  doc: DocumentoTabular,
  seccion: Seccion,
): void {
  const { columnas } = seccion;
  const ancho = Math.max(columnas.length, 2);

  if (!doc.soloTabla) escribirEncabezado(hoja, doc, seccion, ancho);

  // Cabeceras: fila de grupos (combinando celdas contiguas) y fila de columnas
  const filasCabecera: ExcelJS.Row[] = [];
  if (columnas.some((c) => c.grupo)) {
    const grupos = hoja.addRow(columnas.map((c) => c.grupo ?? ''));
    filasCabecera.push(grupos);
    let inicio = 0;
    for (let i = 1; i <= columnas.length; i++) {
      if (
        i === columnas.length ||
        columnas[i].grupo !== columnas[inicio].grupo
      ) {
        if (columnas[inicio].grupo && i - inicio > 1) {
          hoja.mergeCells(grupos.number, inicio + 1, grupos.number, i);
        }
        inicio = i;
      }
    }
  }
  filasCabecera.push(hoja.addRow(columnas.map((c) => c.titulo)));
  for (const fila of filasCabecera) {
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.font = { bold: true };
      celda.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      celda.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: GRIS },
      };
      celda.border = BORDE;
    });
  }
  const primeraFilaDatos = hoja.rowCount + 1;

  // Datos y totales
  const valores = (fila: Fila) =>
    columnas.map((c) => {
      const v = fila[c.clave];
      if (v === null || v === undefined) return null;
      if (c.tipo === 'texto') return String(v);
      if (c.tipo === 'fecha') return v instanceof Date ? v : String(v);
      return comoNumero(v) ?? String(v);
    });
  for (const datosFila of seccion.filas) {
    hoja.addRow(valores(datosFila)).eachCell({ includeEmpty: true }, (c) => {
      c.border = BORDE;
    });
  }
  if (seccion.totales) {
    const totales = hoja.addRow(valores(seccion.totales));
    totales.font = { bold: true };
    totales.eachCell({ includeEmpty: true }, (c) => {
      c.border = BORDE;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } };
    });
  }

  // Formatos y anchos por columna
  columnas.forEach((columna, i) => {
    const col = hoja.getColumn(i + 1);
    col.width =
      columna.ancho ?? Math.max(12, Math.min(40, columna.titulo.length + 4));
    const formato = formatoNumero(columna);
    if (formato) {
      for (let r = primeraFilaDatos; r <= hoja.rowCount; r++) {
        hoja.getCell(r, i + 1).numFmt = formato;
      }
    }
  });
  // Las cabeceras quedan fijas al desplazarse
  hoja.views = [{ state: 'frozen', ySplit: primeraFilaDatos - 1 }];
}

/** Título, empresa, datos y título de la sección, sobre la tabla. */
function escribirEncabezado(
  hoja: ExcelJS.Worksheet,
  doc: DocumentoTabular,
  seccion: Seccion,
  ancho: number,
): void {
  const titulo = hoja.addRow([doc.titulo]);
  titulo.font = { bold: true, size: 14 };
  hoja.mergeCells(titulo.number, 1, titulo.number, ancho);
  const datos = [
    ...(doc.empresa
      ? [
          { etiqueta: 'Empresa', valor: doc.empresa.razonSocial },
          ...(doc.empresa.ruc
            ? [{ etiqueta: 'RUC', valor: doc.empresa.ruc }]
            : []),
        ]
      : []),
    ...(doc.datos ?? []),
  ];
  for (const d of datos) {
    const fila = hoja.addRow([d.etiqueta, d.valor]);
    fila.getCell(1).font = { bold: true };
  }
  if (seccion.titulo) {
    hoja.addRow([]);
    hoja.addRow([seccion.titulo]).font = { bold: true };
  }
  hoja.addRow([]);
}
