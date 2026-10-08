import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import {
  Api,
  crearAdmin,
  crearEmpresa,
  Empresa,
  esperarStatus,
} from './support/api';
import { comprar, crearInventario, prepararEmpresa } from './support/escenario';

describe('Panel del administrador (e2e)', () => {
  let app: INestApplication;
  let admin: Api;
  let conActividad: Empresa;
  let sinPeriodo: Empresa;
  let idUsuarioNuevo: number;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await crearAdmin(app);
    conActividad = await crearEmpresa(app, 'Empresa Admin Activa');
    sinPeriodo = await crearEmpresa(app, 'Empresa Admin Sin Periodo');

    const hoy = new Date().toISOString().slice(0, 10);
    const año = Number(hoy.slice(0, 4));
    const esc = await prepararEmpresa(conActividad, 'promedio');
    // prepararEmpresa crea 2026; si hoy cae en otro año, se mueve la fecha
    const fecha = año === 2026 ? hoy : '2026-06-15';
    const inv = await crearInventario(conActividad.api, esc);
    esperarStatus(
      await comprar(conActividad.api, esc, fecha, [
        { idInventario: inv, cantidad: 2, precio: 10 },
      ]),
      201,
    );

    // Usuario de alta hace 10 días que nunca inició sesión
    const ds = app.get(DataSource);
    const [u] = await ds.query(
      `INSERT INTO "user" (email, nombre, contrasena, habilitado, "esPrincipal", "personaId", fecha_creacion)
       VALUES ($1, 'Usuario Sin Acceso', 'x', true, false, $2, now() - interval '10 days')
       RETURNING id`,
      [`sin.acceso.${Date.now()}@test.local`, sinPeriodo.personaId],
    );
    idUsuarioNuevo = Number(u.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it('solo el administrador puede verlo', async () => {
    expect((await conActividad.api.get('/api/admin/dashboard')).status).toBe(
      403,
    );
    expect((await conActividad.api.get('/api/admin/empresas/1')).status).toBe(
      403,
    );
  });

  it('resume empresas, usuarios y actividad sin montos', async () => {
    const res = await admin.get('/api/admin/dashboard');
    esperarStatus(res, 200);
    const d = res.body;
    expect(d.kpis.empresasHabilitadas).toBeGreaterThanOrEqual(2);
    expect(d.kpis.usuarios).toBeGreaterThanOrEqual(3);
    expect(d.kpis.empresasActivas30).toBeGreaterThanOrEqual(2);
    expect(d.actividad).toHaveLength(12);
    expect(d.accesos.length).toBeGreaterThan(0);

    const activa = d.empresas.find((e: any) => e.id === conActividad.personaId);
    expect(activa).toMatchObject({ habilitada: true, usuarios: 1 });
    expect(activa.periodo?.año).toBe(2026);
    expect(activa.ultimoAcceso).not.toBeNull();

    const json = JSON.stringify(d);
    expect(json).not.toMatch(/"(total|monto|valor|ventas|compras)"/);
  });

  it('marca lo que necesita atención', async () => {
    const { atencion } = (await admin.get('/api/admin/dashboard')).body;
    const de = (tipo: string) =>
      atencion.filter((a: any) => a.tipo === tipo).map((a: any) => a.idPersona);
    expect(de('sinPeriodo')).toContain(sinPeriodo.personaId);
    expect(de('sinPeriodo')).not.toContain(conActividad.personaId);
    const sinLogin = atencion.find(
      (a: any) => a.tipo === 'sinLogin' && a.usuario.id === idUsuarioNuevo,
    );
    expect(sinLogin).toMatchObject({
      severidad: 'baja',
      idPersona: sinPeriodo.personaId,
    });
  });

  it('las empresas deshabilitadas salen de la atención y del conteo', async () => {
    const antes = (await admin.get('/api/admin/dashboard')).body.kpis;
    esperarStatus(
      await admin.patch(`/api/persona/${sinPeriodo.personaId}/disable`),
      204,
    );
    const d = (await admin.get('/api/admin/dashboard')).body;
    expect(d.kpis.empresasHabilitadas).toBe(antes.empresasHabilitadas - 1);
    expect(d.kpis.empresasDeshabilitadas).toBe(
      antes.empresasDeshabilitadas + 1,
    );
    expect(
      d.atencion.some((a: any) => a.idPersona === sinPeriodo.personaId),
    ).toBe(false);
    esperarStatus(
      await admin.patch(`/api/persona/${sinPeriodo.personaId}/enable`),
      204,
    );
  });

  it('devuelve el detalle de una empresa', async () => {
    const res = await admin.get(
      `/api/admin/empresas/${conActividad.personaId}`,
    );
    esperarStatus(res, 200);
    expect(res.body).toMatchObject({
      id: conActividad.personaId,
      habilitada: true,
      periodos: [{ año: 2026 }],
    });
    expect(res.body.usuarios[0]).toMatchObject({ principal: true });
    expect(res.body.actividad).toHaveLength(12);
    expect(
      res.body.actividad.reduce((s: number, m: any) => s + m.comprobantes, 0),
    ).toBeGreaterThanOrEqual(1);
    expect((await admin.get('/api/admin/empresas/999999')).status).toBe(404);
  });
});
