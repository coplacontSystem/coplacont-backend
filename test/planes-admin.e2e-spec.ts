import { INestApplication } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import {
  Api,
  crearAdmin,
  crearEmpresa,
  Empresa,
  esperarStatus,
} from './support/api';

const csv = (filas: string[]) => ({
  nombre: 'plan.csv',
  contenido: Buffer.from(
    ['Código;Denominación', ...filas].join('\n'),
    'utf8',
  ).toString('base64'),
});

describe('Planes de cuentas desde el panel del administrador (e2e)', () => {
  let app: INestApplication;
  let admin: Api;
  let empresa: Empresa;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await crearAdmin(app);
    empresa = await crearEmpresa(app, 'Empresa Planes Admin');
  });

  afterAll(async () => {
    const ds = app.get(DataSource);
    await ds.query(
      `DELETE FROM cuenta_equivalencia WHERE id_plan_destino IN (SELECT id FROM plan_contable WHERE codigo = 'PRUEBA2030')`,
    );
    await ds.query(
      `DELETE FROM cuenta_contable WHERE id_plan IN (SELECT id FROM plan_contable WHERE codigo = 'PRUEBA2030')`,
    );
    await ds.query(`DELETE FROM plan_contable WHERE codigo = 'PRUEBA2030'`);
    await app.close();
  });

  const base = {
    modo: 'nuevo',
    codigo: 'PRUEBA2030',
    nombre: 'Plan de prueba 2030',
    norma: 'Resolución de prueba',
    codigoSunat: '01',
    vigenteDesde: '2030-01-01',
  };

  it('solo el administrador ve e importa planes', async () => {
    const lista = await admin.get('/api/admin/planes-contables');
    esperarStatus(lista, 200);
    expect(lista.body.map((p: any) => p.codigo)).toEqual([
      'PCGE2019',
      'PCGE2026',
    ]);
    expect(lista.body[0]).toMatchObject({
      cuentas: 1772,
      version: 1,
      porDefecto: true,
    });
    expect((await empresa.api.get('/api/admin/planes-contables')).status).toBe(
      403,
    );
  });

  it('valida el archivo antes de guardar', async () => {
    const res = await admin.post('/api/admin/planes-contables/previsualizar', {
      ...base,
      archivo: csv(['10;Caja', '101;Caja', '101;Repetida', '2011;Sin padre']),
    });
    esperarStatus(res, 200);
    expect(res.body.errores).toEqual(
      expect.arrayContaining([
        'Código repetido: 101',
        'La cuenta 2011 no tiene cuenta padre',
      ]),
    );
    expect(
      (
        await admin.post('/api/admin/planes-contables/publicar', {
          ...base,
          archivo: csv(['10;Caja', '101;Caja', '101;Repetida']),
        })
      ).status,
    ).toBe(400);
  });

  it('importa un plan nuevo desde Excel y propone sus equivalencias', async () => {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet('Plan');
    hoja.addRow(['Cuenta', 'Descripción']);
    for (const f of [
      [10, 'EFECTIVO'],
      [101, 'Caja'],
      [104, 'Bancos'],
      [60, 'COMPRAS'],
      [601, 'Mercaderías'],
    ]) {
      hoja.addRow(f);
    }
    const contenido = Buffer.from(await libro.xlsx.writeBuffer()).toString(
      'base64',
    );
    const previa = await admin.post(
      '/api/admin/planes-contables/previsualizar',
      {
        ...base,
        archivo: { nombre: 'plan.xlsx', contenido },
      },
    );
    esperarStatus(previa, 200);
    expect(previa.body.errores).toEqual([]);
    expect(previa.body.diferencias).toMatchObject({
      comparadoCon: 'PCGE2026',
      total: 5,
    });

    const res = await admin.post('/api/admin/planes-contables/publicar', {
      ...base,
      archivo: { nombre: 'plan.xlsx', contenido },
    });
    esperarStatus(res, 200);
    expect(res.body).toMatchObject({ creadas: 5 });
    expect(res.body.planes.map((p: any) => p.codigo)).toContain('PRUEBA2030');

    const eq = await admin.get(
      '/api/plan-contable/equivalencias?origen=PCGE2026&destino=PRUEBA2030',
    );
    esperarStatus(eq, 200);
    expect(eq.body.equivalencias.length).toBeGreaterThan(1000);

    // No se crea dos veces
    expect(
      (
        await admin.post('/api/admin/planes-contables/publicar', {
          ...base,
          archivo: { nombre: 'plan.xlsx', contenido },
        })
      ).status,
    ).toBe(400);
  });

  it('actualiza un plan: agrega, renombra y desactiva, y sube la versión', async () => {
    const actualizar = { ...base, modo: 'actualizar' };
    const archivo = csv([
      '10;EFECTIVO Y EQUIVALENTES',
      '101;Caja',
      '104;Bancos',
      '60;COMPRAS',
      '602;Materias primas',
    ]);
    const previa = await admin.post(
      '/api/admin/planes-contables/previsualizar',
      {
        ...actualizar,
        archivo,
      },
    );
    esperarStatus(previa, 200);
    expect(previa.body.diferencias).toMatchObject({
      comparadoCon: 'PRUEBA2030',
      nuevas: [['602', 'Materias primas']],
      quitadas: [['601', 'Mercaderías']],
      renombradas: [['10', 'EFECTIVO', 'EFECTIVO Y EQUIVALENTES']],
    });
    const res = await admin.post('/api/admin/planes-contables/publicar', {
      ...actualizar,
      archivo,
    });
    esperarStatus(res, 200);
    expect(res.body).toMatchObject({
      creadas: 1,
      renombradas: 1,
      desactivadas: 1,
    });
    const plan = res.body.planes.find((p: any) => p.codigo === 'PRUEBA2030');
    expect(plan).toMatchObject({ version: 2, cuentas: 5, origen: 'importado' });
  });
});
