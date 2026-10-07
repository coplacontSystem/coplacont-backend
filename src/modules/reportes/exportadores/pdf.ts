import PdfPrinter from 'pdfmake';
import type {
  Content,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';
import {
  Celda,
  Columna,
  comoNumero,
  decimalesDe,
  DocumentoTabular,
  Seccion,
} from '../documento-tabular';

/** Fuentes estándar de PDF: no necesitan archivos (funciona en serverless). */
const impresora = new PdfPrinter({
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});

const GRIS = '#E9ECEF';

function formatear(valor: Celda, columna: Columna): string {
  if (valor === null || valor === undefined) return '';
  if (columna.tipo === 'fecha') {
    const fecha = valor instanceof Date ? valor : new Date(String(valor));
    return isNaN(fecha.getTime())
      ? String(valor)
      : fecha.toLocaleDateString('es-PE', { timeZone: 'UTC' });
  }
  if (columna.tipo === 'texto') return String(valor);
  const n = comoNumero(valor);
  if (n === null) return String(valor);
  const decimales = decimalesDe(columna);
  return n.toLocaleString('es-PE', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

const alineacion = (c: Columna) =>
  c.tipo === 'texto' ? 'left' : c.tipo === 'fecha' ? 'center' : 'right';

/** Cabeceras de la tabla: una fila, o dos si hay columnas agrupadas. */
function cabeceras(columnas: Columna[]): TableCell[][] {
  const estilo = { bold: true, fillColor: GRIS, alignment: 'center' as const };
  if (!columnas.some((c) => c.grupo)) {
    return [columnas.map((c) => ({ text: c.titulo, ...estilo }))];
  }
  const grupos: TableCell[] = [];
  const titulos: TableCell[] = [];
  columnas.forEach((c, i) => {
    if (!c.grupo) {
      // Sin grupo: la celda ocupa las dos filas
      grupos.push({ text: c.titulo, rowSpan: 2, ...estilo });
      titulos.push({});
      return;
    }
    if (i === 0 || columnas[i - 1].grupo !== c.grupo) {
      let span = 1;
      while (columnas[i + span]?.grupo === c.grupo) span++;
      grupos.push({ text: c.grupo, colSpan: span, ...estilo });
    } else {
      grupos.push({});
    }
    titulos.push({ text: c.titulo, ...estilo });
  });
  return [grupos, titulos];
}

/**
 * Anchos en porcentaje según el peso `ancho` de cada columna (1 por defecto).
 * pdfmake reparte las columnas '*' en partes iguales y no acepta '2*'.
 */
function anchos(columnas: Columna[]): string[] {
  const pesos = columnas.map((c) => c.ancho ?? 1);
  const suma = pesos.reduce((a, b) => a + b, 0);
  return pesos.map((p) => `${((p / suma) * 100).toFixed(3)}%`);
}

function tabla(seccion: Seccion): Content {
  const { columnas } = seccion;
  const encabezado = cabeceras(columnas);
  const fila = (datos: Record<string, Celda>, negrita = false): TableCell[] =>
    columnas.map((c) => ({
      text: formatear(datos[c.clave], c),
      alignment: alineacion(c),
      bold: negrita,
      ...(negrita ? { fillColor: GRIS } : {}),
    }));

  return {
    table: {
      headerRows: encabezado.length,
      widths: anchos(columnas),
      body: [
        ...encabezado,
        ...seccion.filas.map((f) => fila(f)),
        ...(seccion.totales ? [fila(seccion.totales, true)] : []),
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#BFBFBF',
      vLineColor: () => '#BFBFBF',
    },
    fontSize: columnas.length > 10 ? 6.5 : 8,
    margin: [0, 0, 0, 12],
  };
}

/**
 * PDF real (no impresión del navegador): encabezado del reporte, una tabla por
 * sección con cabeceras repetidas en cada página y pie con página y fecha.
 */
export async function exportarPdf(doc: DocumentoTabular): Promise<Buffer> {
  const generado = doc.generado ?? new Date();
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

  const encabezado: Content[] = [
    { text: doc.titulo, bold: true, fontSize: 13, margin: [0, 0, 0, 6] },
    ...datos.map(
      (d): Content => ({
        text: [{ text: `${d.etiqueta}: `, bold: true }, d.valor],
        fontSize: 9,
      }),
    ),
  ];
  const logo = doc.empresa?.logo;
  const contenido: Content[] = [
    logo
      ? {
          columns: [
            { stack: encabezado, width: '*' },
            {
              width: 130,
              stack: [{ image: logo, fit: [130, 52], alignment: 'right' }],
            },
          ],
          columnGap: 12,
        }
      : { stack: encabezado },
    { text: ' ', margin: [0, 0, 0, 4] },
  ];
  for (const seccion of doc.secciones) {
    if (seccion.titulo) {
      contenido.push({
        text: seccion.titulo,
        bold: true,
        fontSize: 10,
        margin: [0, 4, 0, 4],
      });
    }
    contenido.push(tabla(seccion));
  }

  const definicion: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation:
      doc.orientacion === 'horizontal' ? 'landscape' : 'portrait',
    pageMargins: [28, 28, 28, 36],
    defaultStyle: { font: 'Helvetica', fontSize: 8 },
    info: { title: doc.titulo, creator: 'Coplacont' },
    content: contenido,
    footer: (pagina, total) => ({
      columns: [
        {
          text: `Generado el ${generado.toLocaleString('es-PE', { timeZone: 'America/Lima' })}`,
          alignment: 'left',
        },
        { text: `Página ${pagina} de ${total}`, alignment: 'right' },
      ],
      fontSize: 7,
      margin: [28, 10, 28, 0],
    }),
  };

  const pdf = impresora.createPdfKitDocument(definicion);
  return new Promise<Buffer>((resolve, reject) => {
    const partes: Buffer[] = [];
    pdf.on('data', (parte: Buffer) => partes.push(parte));
    pdf.on('end', () => resolve(Buffer.concat(partes)));
    pdf.on('error', reject);
    pdf.end();
  });
}
