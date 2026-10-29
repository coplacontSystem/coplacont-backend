import { INestApplication } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { createTestApp } from './support/app';
import {
  Api,
  crearAdmin,
  crearEmpresa,
  Empresa,
  esperarStatus,
} from './support/api';

const PAR = 'origen=PCGE2019&destino=PCGE2026';

describe('Planes como datos y equivalencias PCGE 2019 → 2026 (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let admin: Api;
  let tabla: any;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Equivalencias');
    admin = await crearAdmin(app);
    const res = await empresa.api.get(
      `/api/plan-contable/equivalencias?${PAR}`,
    );
    esperarStatus(res, 200);
    tabla = res.body;
  });

  afterAll(async () => {
    await app.close();
  });

  const de = (codigo: string) =>
    tabla.equivalencias.find((e: any) => e.codigoOrigen === codigo);

  it('carga los dos planes; la empresa sigue en el PCGE 2019', async () => {
    const planes = await empresa.api.get('/api/plan-contable/planes');
    expect(planes.body.map((p: any) => p.codigo)).toEqual([
      'PCGE2019',
      'PCGE2026',
    ]);
    const resumen = await empresa.api.get('/api/plan-contable');
    expect(resumen.body.plan.codigo).toBe('PCGE2019');
  });

  it('propone una equivalencia para cada cuenta del 2019', () => {
    expect(tabla.equivalencias).toHaveLength(1772);
    const total = Object.values(tabla.resumen as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBe(1772);
    expect(tabla.porRevisar).toBeGreaterThan(0);
  });

  it('distingue iguales, cambios de significado y eliminadas', () => {
    expect(de('6011')).toMatchObject({
      tipo: 'igual',
      codigoDestino: '6011',
      revisada: true,
    });
    // 70921: venta local de mercaderías en 2019, exportación de terminados en 2026
    expect(de('70921')).toMatchObject({
      tipo: 'cambio',
      codigoDestino: '70911',
      revisada: false,
    });
    expect(de('01')).toMatchObject({ tipo: 'eliminada', revisada: false });
  });

  it('exporta el Excel para los contadores', async () => {
    const res = await empresa.api.descargar(
      `/api/plan-contable/equivalencias/excel?${PAR}`,
    );
    esperarStatus(res, 200);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    expect(libro.worksheets.map((h) => h.name)).toEqual([
      'Por revisar',
      'Iguales o renombradas',
      'Instrucciones',
    ]);
    expect(libro.getWorksheet('Por revisar')!.rowCount).toBe(
      tabla.porRevisar + 1,
    );
  });

  it('solo el administrador fija una equivalencia', async () => {
    const e = de('01');
    expect(
      (
        await empresa.api.patch(`/api/plan-contable/equivalencias/${e.id}`, {
          codigoDestino: null,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await admin.patch(`/api/plan-contable/equivalencias/${e.id}`, {
          codigoDestino: '999',
        })
      ).status,
    ).toBe(400);
    esperarStatus(
      await admin.patch(`/api/plan-contable/equivalencias/${e.id}`, {
        codigoDestino: null,
        nota: 'Las cuentas de orden desaparecen',
      }),
      200,
    );
    const res = await empresa.api.get(
      `/api/plan-contable/equivalencias?${PAR}`,
    );
    expect(
      res.body.equivalencias.find((x: any) => x.codigoOrigen === '01'),
    ).toMatchObject({
      revisada: true,
      codigoDestino: null,
      nota: 'Las cuentas de orden desaparecen',
    });
  });
});
