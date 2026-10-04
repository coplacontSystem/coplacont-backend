import { INestApplication } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import * as ExcelJS from 'exceljs';
import request from 'supertest';
import { ReportesService } from 'src/modules/reportes/reportes.service';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus } from './support/api';

class FiltrosPrueba {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  año!: number;

  @IsOptional()
  nota?: string;
}

/** Endpoint de exportación (fase E1) con un reporte de prueba. */
describe('Reportes (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  const llamadas: { personaId: number; filtros: FiltrosPrueba }[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Reportes');
    app.get(ReportesService).registrar<FiltrosPrueba>({
      clave: 'prueba',
      filtros: FiltrosPrueba,
      generar: (personaId, filtros) => {
        llamadas.push({ personaId, filtros });
        return Promise.resolve({
          titulo: 'Reporte de prueba',
          nombreArchivo: `prueba ${filtros.año} añó`,
          datos: [{ etiqueta: 'Año', valor: String(filtros.año) }],
          secciones: [
            {
              nombre: 'Datos',
              columnas: [
                { clave: 'mes', titulo: 'Mes', tipo: 'texto' },
                { clave: 'monto', titulo: 'Monto', tipo: 'moneda' },
              ],
              filas: [{ mes: 'Enero', monto: 100.25 }],
            },
          ],
        });
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const binario = (
    res: request.Response,
    callback: (e: Error | null, b: Buffer) => void,
  ) => {
    const partes: Buffer[] = [];
    res.on('data', (p: Buffer) => partes.push(p));
    res.on('end', () => callback(null, Buffer.concat(partes)));
  };

  it('lista los reportes y formatos disponibles', async () => {
    const res = await empresa.api.get('/api/reportes');
    esperarStatus(res, 200);
    expect(res.body.reportes).toContain('prueba');
    expect(res.body.formatos).toEqual(['xlsx', 'csv', 'pdf']);
  });

  it('descarga el XLSX con nombre de archivo y datos de la empresa', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/reportes/prueba?formato=xlsx&año=2026')
      .set('Authorization', `Bearer ${empresa.api.token}`)
      .buffer(true)
      .parse(binario);
    esperarStatus(res, 200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="prueba_2026_ano.xlsx"',
    );
    expect(llamadas.at(-1)).toEqual({
      personaId: empresa.personaId,
      filtros: expect.objectContaining({ año: 2026 }),
    });

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(res.body as ExcelJS.Buffer);
    const hoja = libro.getWorksheet('Datos')!;
    const valores: unknown[] = [];
    hoja.eachRow((fila) => valores.push(...(fila.values as unknown[])));
    expect(valores).toContainEqual(expect.stringContaining('Empresa Reportes'));
    expect(valores).toContain(100.25);
  });

  it('descarga CSV y PDF', async () => {
    const csv = await empresa.api.get(
      '/api/reportes/prueba?formato=csv&año=2026',
    );
    esperarStatus(csv, 200);
    expect(csv.text).toContain('Enero;100.25');
    const pdf = await request(app.getHttpServer())
      .get('/api/reportes/prueba?formato=pdf&año=2026')
      .set('Authorization', `Bearer ${empresa.api.token}`)
      .buffer(true)
      .parse(binario);
    esperarStatus(pdf, 200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('valida formato, reporte y filtros', async () => {
    expect(
      (await empresa.api.get('/api/reportes/prueba?formato=doc&año=2026'))
        .status,
    ).toBe(400);
    expect(
      (await empresa.api.get('/api/reportes/no-existe?formato=pdf')).status,
    ).toBe(404);
    const malFiltro = await empresa.api.get(
      '/api/reportes/prueba?formato=csv&año=abc',
    );
    expect(malFiltro.status).toBe(400);
  });

  it('exige autenticación', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/reportes/prueba?formato=csv&año=2026',
    );
    expect(res.status).toBe(401);
  });
});
