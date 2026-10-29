import { INestApplication } from '@nestjs/common';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus, idOf } from './support/api';
import { Escenario, prepararEmpresa } from './support/escenario';

describe('Catálogos SUNAT y datos SUNAT del producto (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let esc: Escenario;
  const api = () => empresa.api;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Catalogos');
    esc = await prepararEmpresa(empresa, 'promedio');
  });

  afterAll(async () => {
    await app.close();
  });

  it('busca en el CCNU por nombre (sin tildes) y por código', async () => {
    const porNombre = await api().get(
      '/api/catalogos/ccnu?q=aceites vegetales comestibles',
    );
    esperarStatus(porNombre, 200);
    expect(porNombre.body.map((c: any) => c.codigo)).toEqual(
      expect.arrayContaining(['50151513']),
    );
    expect(porNombre.body.every((c: any) => c.nivel >= 3)).toBe(true);

    const porCodigo = await api().get('/api/catalogos/ccnu?q=501515');
    expect(porCodigo.body[0].codigo).toMatch(/^501515/);

    const segmentos = await api().get('/api/catalogos/ccnu');
    expect(segmentos.body).toHaveLength(56);

    const uno = await api().get('/api/catalogos/ccnu/50151513');
    expect(uno.body).toMatchObject({
      nombre: 'Aceites vegetales o de planta comestibles',
      ruta: [
        { codigo: '50000000' },
        { codigo: '50150000' },
        { codigo: '50151500' },
      ],
    });
  });

  it('lista las tablas 5 y 6', async () => {
    const t5 = await api().get('/api/catalogos/tipos-existencia');
    expect(t5.body[0]).toEqual({ codigo: '01', nombre: 'Mercaderías' });
    const t6 = await api().get('/api/catalogos/unidades');
    expect(t6.body.map((u: any) => u.codigo)).toEqual(
      expect.arrayContaining(['NIU', 'KGM', 'BX']),
    );
  });

  it('guarda el código SUNAT, el tipo de existencia y la unidad del producto', async () => {
    const base = {
      idCategoria: esc.idCategoria,
      tipo: 'producto',
      nombre: 'Aceite vegetal 1 L',
      descripcion: 'Botella',
      codigoSunat: '50151513',
      tipoExistencia: '01',
      codigoUnidad: 'BO',
    };
    const res = await api().post('/api/productos', {
      ...base,
      codigo: 'ACV-1',
    });
    esperarStatus(res, 201);
    const p = res.body.data ?? res.body;
    // La unidad visible sale de la unidad SUNAT
    expect(p).toMatchObject({
      codigoSunat: '50151513',
      tipoExistencia: '01',
      codigoUnidad: 'BO',
      unidadMedida: 'botella',
    });

    const mal = (cambio: object) =>
      api().post('/api/productos', {
        ...base,
        unidadMedida: 'unidad',
        ...cambio,
      });
    expect((await mal({ codigoSunat: '99999999' })).status).toBe(400);
    expect((await mal({ codigoSunat: '50000000' })).status).toBe(400);
    expect((await mal({ tipoExistencia: '55' })).status).toBe(400);
    expect((await mal({ codigoUnidad: 'XYZ' })).status).toBe(400);

    const id = idOf(p);
    const sinCodigo = await api().patch(`/api/productos/${id}`, {
      codigoSunat: null,
    });
    esperarStatus(sinCodigo, 200);
    expect((sinCodigo.body.data ?? sinCodigo.body).codigoSunat).toBeNull();
  });
});
