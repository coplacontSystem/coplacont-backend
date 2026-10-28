import { INestApplication } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus } from './support/api';
import {
  comprar,
  crearInventario,
  Escenario,
  prepararEmpresa,
  vender,
} from './support/escenario';

describe('Libro Diario simplificado (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let esc: Escenario;
  let ruc: string;
  const api = () => empresa.api;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Libro Diario');
    esc = await prepararEmpresa(empresa, 'promedio');
    const [p] = await app
      .get(DataSource)
      .query(`SELECT ruc FROM persona WHERE id = $1`, [empresa.personaId]);
    ruc = p.ruc;
    const inv = await crearInventario(api(), esc);
    esperarStatus(
      await comprar(api(), esc, '2026-05-03', [
        { idInventario: inv, cantidad: 10, precio: 5 },
      ]),
      201,
    );
    esperarStatus(
      await vender(api(), esc, '2026-05-10', [
        { idInventario: inv, cantidad: 2, precio: 20 },
      ]),
      201,
    );
    esperarStatus(
      await api().post('/api/asientos', {
        fecha: '2026-05-31',
        glosa: 'Planilla de mayo',
        lineas: [
          { codigoCuenta: '6211', debe: 1000, haber: 0 },
          { codigoCuenta: '4111', debe: 0, haber: 1000 },
        ],
      }),
      201,
    );
    // Otro mes: no entra en mayo
    esperarStatus(
      await comprar(api(), esc, '2026-06-02', [
        { idInventario: inv, cantidad: 1, precio: 5 },
      ]),
      201,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('arma el libro del mes con todos los asientos', async () => {
    const res = await api().get('/api/libros/diario?año=2026&mes=5');
    esperarStatus(res, 200);
    const libro = res.body;
    expect(libro.asientos.map((a: any) => a.origen)).toEqual([
      'compra',
      'venta',
      'manual',
    ]);
    expect(libro.totalDebe).toBe(libro.totalHaber);
    // compra 59 + destino 50; venta 47.2 + costo 10; planilla 1000
    expect(libro.totalDebe).toBeCloseTo(1166.2, 2);
    expect(libro.cuentas.map((c: any) => c.codigo)).toEqual(
      expect.arrayContaining([
        '12',
        '20',
        '40',
        '41',
        '42',
        '60',
        '61',
        '62',
        '69',
        '70',
      ]),
    );
    expect(libro.asientos[0].documento).toMatchObject({
      tipo: '01',
      tipoDocContraparte: '6',
    });
  });

  it('genera el TXT del PLE 5.2', async () => {
    const res = await api().descargar('/api/libros/diario/ple?año=2026&mes=5');
    esperarStatus(res, 200);
    expect(res.headers['content-disposition']).toContain(
      `LE${ruc}20260500050200001111.txt`,
    );
    const lineas = (res.body as Buffer).toString('utf8').trim().split('\r\n');
    expect(lineas).toHaveLength(5 + 5 + 2);
    const campos = lineas[0].split('|');
    expect(campos).toHaveLength(22); // 21 campos + el "|" final
    expect(campos.slice(0, 4)).toEqual(['20260500', '0001', 'M1', campos[3]]);
    expect(campos[9]).toBe('01');
    expect(campos[20]).toBe('1');

    const vacio = await api().descargar(
      '/api/libros/diario/ple?año=2026&mes=1',
    );
    expect(vacio.headers['content-disposition']).toContain(
      '00050200000111.txt',
    );
  });

  it('exporta el formato 5.2 en Excel y PDF', async () => {
    const xlsx = await api().descargar(
      '/api/reportes/libro-diario?año=2026&mes=5&formato=xlsx',
    );
    esperarStatus(xlsx, 200);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(xlsx.body as unknown as ExcelJS.Buffer);
    expect(libro.worksheets.map((h) => h.name)).toEqual([
      'Formato 5.2',
      'Detalle',
    ]);

    const pdf = await api().descargar(
      '/api/reportes/libro-diario?año=2026&mes=5&formato=pdf',
    );
    esperarStatus(pdf, 200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
});
