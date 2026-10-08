import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import {
  crearAdmin,
  crearEmpresa,
  Empresa,
  esperarStatus,
} from './support/api';
import { comprar, crearInventario, prepararEmpresa } from './support/escenario';

// PNG de 1×1 px
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('Configuración: cuenta, empresa y periodos (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  const clave = 'Clave-Inicial-1';

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Configuracion');
    // Contraseña conocida para probar los cambios que la piden
    await app
      .get(DataSource)
      .query(`UPDATE "user" SET contrasena = $1 WHERE "personaId" = $2`, [
        await bcrypt.hash(clave, 10),
        empresa.personaId,
      ]);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => empresa.api;

  describe('Mi cuenta', () => {
    it('devuelve el perfil con el último inicio de sesión', async () => {
      const res = await api().get('/api/cuenta');
      esperarStatus(res, 200);
      expect(res.body.nombre).toBe('Usuario Empresa Configuracion');
      expect(res.body.avatar).toBeNull();
      expect(res.body.ultimoLogin).not.toBeNull();
    });

    it('actualiza nombre, teléfono y cargo, y valida los datos', async () => {
      const res = await api().patch('/api/cuenta', {
        nombre: '  María Rojas Quispe ',
        telefono: '987 654 321',
        cargo: 'Contadora general',
      });
      esperarStatus(res, 200);
      expect(res.body).toMatchObject({
        nombre: 'María Rojas Quispe',
        telefono: '987 654 321',
        cargo: 'Contadora general',
      });
      expect(
        (await api().patch('/api/cuenta', { telefono: 'abc' })).status,
      ).toBe(400);
      expect(
        (await api().patch('/api/cuenta', { cargo: 'x'.repeat(41) })).status,
      ).toBe(400);
      const sinCargo = await api().patch('/api/cuenta', { cargo: '' });
      expect(sinCargo.body.cargo).toBeNull();
    });

    it('guarda y quita la foto de perfil; rechaza formatos no admitidos', async () => {
      esperarStatus(
        await api().put('/api/cuenta/avatar', { imagen: PNG }),
        200,
      );
      expect((await api().get('/api/cuenta')).body.avatar).toBe(PNG);
      const gif = await api().put('/api/cuenta/avatar', {
        imagen: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      });
      expect(gif.status).toBe(400);
      esperarStatus(await api().delete('/api/cuenta/avatar'), 200);
      expect((await api().get('/api/cuenta')).body.avatar).toBeNull();
    });

    it('cambia el correo solo con la contraseña actual y si está libre', async () => {
      const mal = await api().patch('/api/cuenta/correo', {
        email: 'nuevo.config@test.local',
        contrasenaActual: 'otra',
      });
      expect(mal.status).toBe(400);
      const otra = await crearEmpresa(app, 'Empresa Correo Ocupado');
      const ocupado = (await otra.api.get('/api/cuenta')).body.email;
      const conflicto = await api().patch('/api/cuenta/correo', {
        email: ocupado,
        contrasenaActual: clave,
      });
      expect(conflicto.status).toBe(409);
      const ok = await api().patch('/api/cuenta/correo', {
        email: 'Nuevo.Config@test.local',
        contrasenaActual: clave,
      });
      esperarStatus(ok, 200);
      expect(ok.body.email).toBe('nuevo.config@test.local');
    });

    it('cambia la contraseña y registra la fecha del cambio', async () => {
      expect(
        (
          await api().patch('/api/cuenta/contrasena', {
            actual: 'otra',
            nueva: 'Nueva-Clave-2',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await api().patch('/api/cuenta/contrasena', {
            actual: clave,
            nueva: clave,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await api().patch('/api/cuenta/contrasena', {
            actual: clave,
            nueva: 'corta',
          })
        ).status,
      ).toBe(400);
      const ok = await api().patch('/api/cuenta/contrasena', {
        actual: clave,
        nueva: 'Nueva-Clave-2',
      });
      esperarStatus(ok, 200);
      expect(ok.body.contrasenaActualizada).not.toBeNull();
      const login = await api().post('/api/auth/login', {
        email: 'nuevo.config@test.local',
        contrasena: 'Nueva-Clave-2',
      });
      expect(login.body.jwt).toBeDefined();
    });
  });

  describe('Empresa', () => {
    it('actualiza los datos fiscales sin tocar el RUC', async () => {
      const antes = (await api().get('/api/empresa')).body;
      const res = await api().patch('/api/empresa', {
        razonSocial: 'Comercial Andina S.A.C.',
        nombreComercial: 'Andina Mayorista',
        direccion: 'Av. Nicolás Ayllón 2850, Ate, Lima',
        ruc: '20999999999',
      });
      esperarStatus(res, 200);
      expect(res.body).toMatchObject({
        razonSocial: 'Comercial Andina S.A.C.',
        nombreComercial: 'Andina Mayorista',
        ruc: antes.ruc,
      });
      // Sin nombre comercial se usa la razón social
      const sinComercial = await api().patch('/api/empresa', {
        nombreComercial: '',
      });
      expect(sinComercial.body.nombreComercial).toBe('Comercial Andina S.A.C.');
      expect(
        (await api().patch('/api/empresa', { direccion: '' })).status,
      ).toBe(400);
    });

    it('guarda y quita el logo', async () => {
      esperarStatus(await api().put('/api/empresa/logo', { imagen: PNG }), 200);
      expect((await api().get('/api/empresa')).body.logo).toBe(PNG);
      esperarStatus(await api().delete('/api/empresa/logo'), 200);
      expect((await api().get('/api/empresa')).body.logo).toBeNull();
    });

    it('un usuario sin empresa no puede consultarla', async () => {
      const admin = await crearAdmin(app);
      expect((await admin.get('/api/empresa')).status).toBe(403);
    });
  });

  describe('Periodos contables', () => {
    const resumen = async () => {
      const res = await api().get('/api/periodos-contables/resumen');
      esperarStatus(res, 200);
      return res.body as {
        id: number;
        año: number;
        estado: string;
        metodoValoracion: string;
        cerradoPor: string | null;
        puedeCerrar: boolean;
        puedeReabrir: boolean;
      }[];
    };
    const de = async (año: number) =>
      (await resumen()).find((p) => p.año === año)!;

    it('el primero queda activo y los siguientes esperan como futuros', async () => {
      esperarStatus(
        await api().post('/api/periodos-contables', { año: 2026 }),
        201,
      );
      esperarStatus(
        await api().post('/api/periodos-contables', {
          año: 2027,
          metodoValoracion: 'fifo',
        }),
        201,
      );
      expect(await de(2026)).toMatchObject({
        estado: 'activo',
        puedeCerrar: true,
      });
      expect(await de(2027)).toMatchObject({
        estado: 'futuro',
        metodoValoracion: 'fifo',
        puedeCerrar: false,
      });
      expect(
        (await api().post('/api/periodos-contables', { año: 2026 })).status,
      ).toBe(409);
      const cruce = await api().post('/api/periodos-contables', {
        año: 2030,
        fechaInicio: '2027-06-01',
        fechaFin: '2028-05-31',
      });
      expect(cruce.status).toBe(400);
    });

    it('la configuración informa el periodo activo y si el método se puede cambiar', async () => {
      const res = await api().get('/api/periodos-contables/configuracion');
      esperarStatus(res, 200);
      expect(res.body).toMatchObject({
        metodoValoracion: 'promedio',
        metodoBloqueado: false,
        periodoActivo: { año: 2026, movimientos: 0 },
        cierreAutomatico: false,
      });
    });

    it('al cerrar el activo se activa el siguiente con su método', async () => {
      const p2026 = await de(2026);
      esperarStatus(
        await api().put(`/api/periodos-contables/${p2026.id}/cerrar`, {}),
        200,
      );
      expect(await de(2026)).toMatchObject({
        estado: 'cerrado',
        cerradoPor: 'María Rojas Quispe',
        puedeReabrir: true,
      });
      expect((await de(2027)).estado).toBe('activo');
      const cfg = await api().get('/api/periodos-contables/configuracion');
      expect(cfg.body.metodoValoracion).toBe('fifo');
      // 2026 conserva su método
      expect((await de(2026)).metodoValoracion).toBe('promedio');
    });

    it('solo el último cerrado se reabre y vuelve a ser el activo', async () => {
      const p2026 = await de(2026);
      esperarStatus(
        await api().put(`/api/periodos-contables/${p2026.id}/reabrir`),
        200,
      );
      expect((await de(2026)).estado).toBe('reabierto');
      expect((await de(2027)).estado).toBe('futuro');

      esperarStatus(
        await api().put(`/api/periodos-contables/${p2026.id}/cerrar`, {}),
        200,
      );
      expect((await de(2027)).estado).toBe('activo');

      // 2025 cerrado es anterior al último cerrado (2026)
      const p2025 = await api().post('/api/periodos-contables', { año: 2025 });
      esperarStatus(p2025, 201);
      esperarStatus(
        await api().put(`/api/periodos-contables/${p2025.body.id}/cerrar`, {}),
        200,
      );
      expect((await de(2025)).puedeReabrir).toBe(false);
      const reabrir = await api().put(
        `/api/periodos-contables/${p2025.body.id}/reabrir`,
      );
      expect(reabrir.status).toBe(400);
    });

    it('guarda las reglas del periodo y valida los rangos', async () => {
      const res = await api().put('/api/periodos-contables/configuracion', {
        diasLimiteRetroactivo: 10,
        cierreAutomatico: true,
        diasParaCierreAutomatico: 15,
        permitirMovimientosPeriodoCerrado: false,
      });
      esperarStatus(res, 200);
      expect(res.body).toMatchObject({
        diasLimiteRetroactivo: 10,
        cierreAutomatico: true,
        diasParaCierreAutomatico: 15,
      });
      const mal = await api().put('/api/periodos-contables/configuracion', {
        diasLimiteRetroactivo: 120,
      });
      expect(mal.status).toBe(400);
    });

    it('con movimientos el método queda bloqueado y el inventario de cierre se calcula', async () => {
      const conMovs = await crearEmpresa(app, 'Empresa Config Movimientos');
      const esc = await prepararEmpresa(conMovs, 'promedio');
      const inv = await crearInventario(conMovs.api, esc);
      esperarStatus(
        await comprar(conMovs.api, esc, '2026-03-01', [
          { idInventario: inv, cantidad: 10, precio: 12.5 },
        ]),
        201,
      );
      const cfg = await conMovs.api.get(
        '/api/periodos-contables/configuracion',
      );
      expect(cfg.body).toMatchObject({
        metodoBloqueado: true,
        periodoActivo: { año: 2026, movimientos: 1 },
      });
      const valor = await conMovs.api.get(
        '/api/dashboard/inventario?fecha=2026-12-31',
      );
      esperarStatus(valor, 200);
      expect(valor.body.valor).toBeCloseTo(125, 2);
      const antes = await conMovs.api.get(
        '/api/dashboard/inventario?fecha=2026-02-28',
      );
      expect(antes.body.valor).toBe(0);
    });
  });
});
