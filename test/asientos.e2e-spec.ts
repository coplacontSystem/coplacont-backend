import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus } from './support/api';

/** Planilla de octubre: gasto de personal contra remuneraciones y aportes por pagar */
const planilla = (fecha = '2026-10-31') => ({
  fecha,
  glosa: 'Planilla de remuneraciones de octubre',
  referencia: 'PLAME 10/2026',
  lineas: [
    { codigoCuenta: '6211', glosa: 'Sueldos', debe: 3000, haber: 0 },
    { codigoCuenta: '6271', glosa: 'EsSalud', debe: 270, haber: 0 },
    { codigoCuenta: '4111', glosa: 'Neto a pagar', debe: 0, haber: 2610 },
    { codigoCuenta: '4032', glosa: 'ONP', debe: 0, haber: 390 },
    { codigoCuenta: '4031', glosa: 'EsSalud por pagar', debe: 0, haber: 270 },
  ],
});

describe('Asientos contables manuales (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let otra: Empresa;
  let idPeriodo: number;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Asientos');
    otra = await crearEmpresa(app, 'Empresa Asientos Ajena');
    const p = await empresa.api.post('/api/periodos-contables', { año: 2026 });
    esperarStatus(p, 201);
    idPeriodo = p.body.id;
    esperarStatus(
      await otra.api.post('/api/periodos-contables', { año: 2026 }),
      201,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => empresa.api;

  it('verifica que las cuentas del ejemplo existen y reciben movimientos', async () => {
    for (const c of ['6211', '6271', '4111', '4032', '4031']) {
      const r = await api().get(`/api/plan-contable/cuentas/${c}`);
      esperarStatus(r, 200);
      expect(r.body.cuenta.imputable).toBe(true);
    }
  });

  it('registra un asiento cuadrado con número correlativo', async () => {
    const r1 = await api().post('/api/asientos', planilla());
    esperarStatus(r1, 201);
    expect(r1.body).toMatchObject({
      numero: 1,
      fecha: '2026-10-31',
      origen: 'manual',
      estado: 'registrado',
      totalDebe: 3270,
      totalHaber: 3270,
      cantidadLineas: 5,
      editable: true,
      creadoPor: 'Usuario Empresa Asientos',
      periodo: { año: 2026, cerrado: false },
    });
    expect(r1.body.lineas[0]).toMatchObject({
      codigoCuenta: '6211',
      debe: 3000,
      haber: 0,
    });

    const r2 = await api().post('/api/asientos', {
      ...planilla('2026-11-30'),
      glosa: 'Planilla de noviembre',
    });
    expect(r2.body.numero).toBe(2);
    // La otra empresa empieza su propia numeración
    const r3 = await otra.api.post('/api/asientos', planilla());
    expect(r3.body.numero).toBe(1);
  });

  it('rechaza asientos descuadrados, líneas inválidas y cuentas que agrupan', async () => {
    const descuadre = planilla();
    descuadre.lineas[2].haber = 2600;
    const r = await api().post('/api/asientos', descuadre);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/no cuadra.*diferencia 10\.00/);

    const ambos = planilla();
    ambos.lineas[0].haber = 5;
    expect((await api().post('/api/asientos', ambos)).status).toBe(400);

    const agrupa = planilla();
    agrupa.lineas[0].codigoCuenta = '621';
    const ra = await api().post('/api/asientos', agrupa);
    expect(ra.status).toBe(400);
    expect(JSON.stringify(ra.body)).toMatch(/agrupa subcuentas/);

    const noExiste = planilla();
    noExiste.lineas[0].codigoCuenta = '6299999';
    expect((await api().post('/api/asientos', noExiste)).status).toBe(400);

    const unaLinea = { ...planilla(), lineas: [planilla().lineas[0]] };
    expect((await api().post('/api/asientos', unaLinea)).status).toBe(400);
  });

  it('exige un periodo contable abierto para la fecha', async () => {
    const sinPeriodo = await api().post(
      '/api/asientos',
      planilla('2025-12-31'),
    );
    expect(sinPeriodo.status).toBe(400);
    expect(JSON.stringify(sinPeriodo.body)).toMatch(/No hay un periodo/);
  });

  it('lista con filtros y paginación', async () => {
    const todos = await api().get('/api/asientos');
    esperarStatus(todos, 200);
    expect(todos.body.total).toBe(2);
    expect(todos.body.datos[0].numero).toBe(2); // más reciente primero

    const oct = await api().get(
      '/api/asientos?desde=2026-10-01&hasta=2026-10-31',
    );
    expect(oct.body.datos.map((a: any) => a.numero)).toEqual([1]);
    const porGlosa = await api().get('/api/asientos?q=noviembre');
    expect(porGlosa.body.total).toBe(1);
    const porCuenta = await api().get('/api/asientos?cuenta=403');
    expect(porCuenta.body.total).toBe(2);
    const pagina = await api().get('/api/asientos?limite=1&pagina=2');
    expect(pagina.body).toMatchObject({ total: 2, pagina: 2, totalPaginas: 2 });
    expect(pagina.body.datos).toHaveLength(1);
  });

  it('edita un asiento manual manteniendo su número', async () => {
    const lista = (await api().get('/api/asientos?q=octubre')).body.datos;
    const id = lista[0].id;
    const cambio = planilla();
    cambio.glosa = 'Planilla de octubre (corregida)';
    cambio.lineas[0].debe = 3100;
    cambio.lineas[2].haber = 2710;
    const r = await api().put(`/api/asientos/${id}`, cambio);
    esperarStatus(r, 200);
    expect(r.body).toMatchObject({
      numero: 1,
      glosa: 'Planilla de octubre (corregida)',
      totalDebe: 3370,
      modificadoPor: 'Usuario Empresa Asientos',
    });
  });

  it('anula conservando el número; un anulado ya no se edita', async () => {
    const id = (await api().get('/api/asientos?q=noviembre')).body.datos[0].id;
    expect(
      (await api().patch(`/api/asientos/${id}/anular`, { motivo: 'x' })).status,
    ).toBe(400);
    const r = await api().patch(`/api/asientos/${id}/anular`, {
      motivo: 'Duplicado por error',
    });
    esperarStatus(r, 200);
    expect(r.body).toMatchObject({
      numero: 2,
      estado: 'anulado',
      editable: false,
      anulacion: {
        motivo: 'Duplicado por error',
        por: 'Usuario Empresa Asientos',
      },
    });
    expect((await api().put(`/api/asientos/${id}`, planilla())).status).toBe(
      400,
    );
    expect((await api().get('/api/asientos?estado=anulado')).body.total).toBe(
      1,
    );
  });

  it('protege las cuentas con movimientos en el plan', async () => {
    // Subcuenta propia con movimiento: no se desactiva
    const sub = await api().post('/api/plan-contable/cuentas', {
      codigoPadre: '1041',
      codigo: '104101',
      nombre: 'BCP soles',
    });
    esperarStatus(sub, 201);
    const pago = await api().post('/api/asientos', {
      fecha: '2026-11-05',
      glosa: 'Pago de planilla',
      lineas: [
        { codigoCuenta: '4111', debe: 2710, haber: 0 },
        { codigoCuenta: '104101', debe: 0, haber: 2710 },
      ],
    });
    esperarStatus(pago, 201);
    const des = await api().patch(`/api/plan-contable/cuentas/${sub.body.id}`, {
      activa: false,
    });
    expect(des.status).toBe(400);
    expect(JSON.stringify(des.body)).toMatch(/movimientos/);

    // Una cuenta con movimientos no puede abrir subcuentas
    const bajo = await api().post('/api/plan-contable/cuentas', {
      codigoPadre: '4111',
      codigo: '41111',
      nombre: 'Sueldos por pagar',
    });
    expect(bajo.status).toBe(400);
    // La 1041 de la otra empresa no tiene movimientos: acepta subcuentas
    expect(
      (
        await otra.api.post('/api/plan-contable/cuentas', {
          codigoPadre: '1041',
          codigo: '104101',
          nombre: 'Banco',
        })
      ).status,
    ).toBe(201);
  });

  it('no permite asientos ni cambios en un periodo cerrado', async () => {
    const id = (await api().get('/api/asientos?q=corregida')).body.datos[0].id;
    esperarStatus(
      await api().put(`/api/periodos-contables/${idPeriodo}/cerrar`, {}),
      200,
    );
    expect((await api().post('/api/asientos', planilla())).status).toBe(400);
    expect(
      (
        await api().patch(`/api/asientos/${id}/anular`, {
          motivo: 'Prueba de cierre',
        })
      ).status,
    ).toBe(400);
    expect((await api().get(`/api/asientos/${id}`)).body.editable).toBe(false);

    // Con la regla "Permitir movimientos en periodo cerrado" sí
    esperarStatus(
      await api().put('/api/periodos-contables/configuracion', {
        permitirMovimientosPeriodoCerrado: true,
      }),
      200,
    );
    esperarStatus(await api().post('/api/asientos', planilla()), 201);
  });

  it('aísla los asientos entre empresas', async () => {
    const id = (await api().get('/api/asientos')).body.datos[0].id;
    expect((await otra.api.get(`/api/asientos/${id}`)).status).toBe(404);
    expect(
      (
        await otra.api.patch(`/api/asientos/${id}/anular`, {
          motivo: 'Ajeno total',
        })
      ).status,
    ).toBe(404);
    const ds = app.get(DataSource);
    const [{ n }] = await ds.query(
      `SELECT COUNT(*) AS n FROM asiento_contable WHERE id_persona = $1`,
      [otra.personaId],
    );
    expect(Number(n)).toBe(1);
  });
});
