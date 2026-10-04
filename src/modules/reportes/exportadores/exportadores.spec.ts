import * as ExcelJS from 'exceljs';
import { DocumentoTabular } from '../documento-tabular';
import { exportarCsv } from './csv';
import { exportarPdf } from './pdf';
import { exportarXlsx } from './xlsx';

const documento = (filas = 2): DocumentoTabular => ({
  titulo: 'Reporte de prueba',
  nombreArchivo: 'prueba',
  empresa: { razonSocial: 'Empresa; "Demo"', ruc: '20123456789' },
  datos: [{ etiqueta: 'Período', valor: '2026' }],
  generado: new Date('2026-10-04T15:00:00Z'),
  secciones: [
    {
      nombre: 'Movimientos',
      columnas: [
        { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
        { clave: 'detalle', titulo: 'Detalle', tipo: 'texto' },
        {
          clave: 'cantidad',
          titulo: 'Cantidad',
          tipo: 'cantidad',
          grupo: 'Entradas',
          decimales: 4,
        },
        { clave: 'total', titulo: 'Total', tipo: 'moneda', grupo: 'Entradas' },
      ],
      filas: Array.from({ length: filas }, (_, i) => ({
        fecha: new Date(Date.UTC(2026, 2, 1 + (i % 28), 12)),
        detalle: i === 0 ? 'Compra; lote "A"\nsegunda línea' : `Fila ${i}`,
        cantidad: 10.5,
        total: '1234.5',
      })),
      totales: { detalle: 'Total', total: 1234.5 * filas },
    },
    {
      nombre: 'Movimientos',
      columnas: [{ clave: 'x', titulo: 'X', tipo: 'numero' }],
      filas: [{ x: 3 }],
    },
  ],
});

describe('exportador CSV', () => {
  const csv = exportarCsv(documento()).toString('utf8');
  const lineas = csv.split('\r\n');

  it('es UTF-8 con BOM y separador ;', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lineas).toContain('Período;2026');
  });

  it('escapa separador, comillas y saltos de línea', () => {
    expect(lineas).toContain('Empresa;"Empresa; ""Demo"""');
    expect(csv).toContain('"Compra; lote ""A""\nsegunda línea"');
  });

  it('escribe números con punto decimal y fechas ISO', () => {
    const fila = lineas.find((l) => l.startsWith('2026-03-02'));
    expect(fila).toBe('2026-03-02;Fila 1;10.5000;1234.50');
    expect(lineas).toContain(';Total;;2469.00');
  });

  it('incluye la fila de grupos', () => {
    expect(lineas).toContain(';;Entradas;Entradas');
  });
});

describe('exportador XLSX', () => {
  let libro: ExcelJS.Workbook;

  beforeAll(async () => {
    libro = new ExcelJS.Workbook();
    await libro.xlsx.load(
      (await exportarXlsx(documento())) as unknown as ExcelJS.Buffer,
    );
  });

  it('una hoja por sección, con nombres únicos', () => {
    expect(libro.worksheets.map((h) => h.name)).toEqual([
      'Movimientos',
      'Movimientos 2',
    ]);
  });

  it('guarda números reales con formato, no texto', () => {
    const hoja = libro.getWorksheet('Movimientos')!;
    let celdaTotal: ExcelJS.Cell | undefined;
    hoja.eachRow((fila) => {
      if (fila.getCell(2).value === 'Fila 1') celdaTotal = fila.getCell(4);
    });
    expect(celdaTotal?.value).toBe(1234.5);
    expect(celdaTotal?.numFmt).toBe('#,##0.00');
  });

  it('combina las celdas del grupo y pone los totales en negrita', () => {
    const hoja = libro.getWorksheet('Movimientos')!;
    let grupo: ExcelJS.Cell | undefined;
    let totales: ExcelJS.Row | undefined;
    hoja.eachRow((fila) => {
      if (fila.getCell(3).value === 'Entradas') grupo = fila.getCell(3);
      if (fila.getCell(2).value === 'Total') totales = fila;
    });
    expect(grupo?.isMerged).toBe(true);
    expect(totales?.getCell(4).value).toBe(2469);
    expect(totales?.getCell(4).font?.bold).toBe(true);
  });
});

describe('exportador PDF', () => {
  it('genera un PDF real y pagina las tablas largas', async () => {
    const pdf = await exportarPdf({
      ...documento(150),
      orientacion: 'horizontal',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const paginas = /\/Type \/Pages[\s\S]*?\/Count (\d+)/.exec(
      pdf.toString('latin1'),
    );
    expect(Number(paginas?.[1])).toBeGreaterThan(1);
  });

  it('acepta anchos relativos y varios grupos seguidos', async () => {
    const doc = documento(3);
    doc.secciones[0].columnas = [
      { clave: 'detalle', titulo: 'Detalle', tipo: 'texto', ancho: 1.6 },
      ...['Entradas', 'Salidas'].flatMap((g) => [
        { clave: 'cantidad', titulo: 'Cantidad', tipo: 'cantidad' as const, grupo: g },
        { clave: 'total', titulo: 'Total', tipo: 'moneda' as const, grupo: g },
      ]),
    ];
    const pdf = await exportarPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
