import * as bcrypt from 'bcrypt';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import { Api, crearEmpresa, Empresa, esperarStatus } from './support/api';

/**
 * Seguridad del acceso: bloqueo por intentos fallidos, límite por IP,
 * revocación de sesiones, usuarios deshabilitados y cabeceras.
 */
describe('Seguridad del acceso (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let empresa: Empresa;
  let n = 0;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    empresa = await crearEmpresa(app, 'Empresa Acceso');
  });

  afterAll(async () => {
    delete process.env.LIMITAR_EN_PRUEBAS;
    await app.close();
  });

  /** Usuario EMPRESA de la empresa de prueba, con su correo y clave. */
  async function usuario() {
    n += 1;
    const email = `acceso.${n}@test.local`;
    const clave = `Clave-acceso-${n}`;
    const [u] = await ds.query(
      `INSERT INTO "user" (email, nombre, contrasena, habilitado, "esPrincipal", "personaId")
       VALUES ($1, 'Usuario acceso', $2, true, false, $3) RETURNING id`,
      [email, await bcrypt.hash(clave, 10), empresa.personaId],
    );
    await ds.query(
      `INSERT INTO user_role ("userId", "roleId") SELECT $1, id FROM role WHERE nombre = 'EMPRESA'`,
      [u.id],
    );
    return { id: Number(u.id), email, clave };
  }

  const login = (email: string, contrasena: string) =>
    new Api(app).post('/api/auth/login', { email, contrasena });

  async function sesion(email: string, clave: string) {
    const r = await login(email, clave);
    const api = new Api(app);
    api.token = r.body.jwt;
    return api;
  }

  it('bloquea el correo tras 5 intentos fallidos, aun con la clave correcta', async () => {
    const u = await usuario();
    for (let i = 0; i < 5; i++) {
      const r = await login(u.email, 'clave-mala');
      expect(r.body.success).toBe(false);
    }
    const bloqueado = await login(u.email, u.clave);
    esperarStatus(bloqueado, 429);
    expect(bloqueado.body.message).toMatch(/Demasiados intentos/);

    const [{ fallidos, motivos }] = await ds.query(
      `SELECT count(*)::int AS fallidos, string_agg(DISTINCT motivo, ',' ORDER BY motivo) AS motivos
         FROM registro_acceso WHERE email = $1 AND NOT exito`,
      [u.email],
    );
    expect(fallidos).toBe(6);
    expect(motivos).toBe('bloqueado,credenciales');
  });

  it('un acceso correcto reinicia la cuenta de fallidos', async () => {
    const u = await usuario();
    for (let i = 0; i < 4; i++) await login(u.email, 'clave-mala');
    expect((await login(u.email, u.clave)).body.jwt).toBeTruthy();
    for (let i = 0; i < 4; i++) await login(u.email, 'clave-mala');
    expect((await login(u.email, u.clave)).body.jwt).toBeTruthy();
  });

  it('cerrar sesiones invalida los tokens ya emitidos', async () => {
    const u = await usuario();
    const a = await sesion(u.email, u.clave);
    const b = await sesion(u.email, u.clave);
    esperarStatus(await b.get('/api/periodos-contables/resumen'), 200);
    esperarStatus(await a.post('/api/auth/cerrar-sesiones', {}), 200);
    const r = await b.get('/api/periodos-contables/resumen');
    esperarStatus(r, 401);
    // Una sesión nueva sí funciona
    const c = await sesion(u.email, u.clave);
    esperarStatus(await c.get('/api/periodos-contables/resumen'), 200);
  });

  it('deshabilitar al usuario corta su sesión al instante', async () => {
    const u = await usuario();
    const api = await sesion(u.email, u.clave);
    esperarStatus(await api.get('/api/periodos-contables/resumen'), 200);
    await ds.query(`UPDATE "user" SET habilitado = false WHERE id = $1`, [
      u.id,
    ]);
    esperarStatus(await api.get('/api/periodos-contables/resumen'), 401);
  });

  it('los roles se leen de la base, no del token', async () => {
    const u = await usuario();
    const api = await sesion(u.email, u.clave);
    esperarStatus(await api.get('/api/periodos-contables/resumen'), 200);
    // Sin rol EMPRESA ya no pasa por los endpoints que lo exigen
    await ds.query(`DELETE FROM user_role WHERE "userId" = $1`, [u.id]);
    const r = await api.get('/api/admin/planes-contables');
    expect([401, 403]).toContain(r.status);
  });

  it('limita los intentos de acceso por IP', async () => {
    process.env.LIMITAR_EN_PRUEBAS = '1';
    const estados: number[] = [];
    for (let i = 0; i < 12; i++) {
      estados.push((await login(`ip.${i}@test.local`, 'x')).status);
    }
    delete process.env.LIMITAR_EN_PRUEBAS;
    expect(estados.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(estados).toContain(429);
  });

  it('responde con cabeceras de seguridad', async () => {
    const r = await new Api(app).get('/api/auth/no-existe');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});
