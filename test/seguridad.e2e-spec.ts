import { INestApplication } from '@nestjs/common';
import { createTestApp } from './support/app';
import {
  Api,
  crearAdmin,
  crearEmpresa,
  Empresa,
  esperarStatus,
} from './support/api';
import {
  comprar,
  crearInventario,
  Escenario,
  prepararEmpresa,
  stockActual,
} from './support/escenario';

/**
 * Autenticación, roles, validación de entrada y aislamiento entre empresas.
 */
describe('Seguridad (e2e)', () => {
  let app: INestApplication;
  let anonimo: Api;
  let admin: Api;
  let a: Empresa;
  let b: Empresa;
  let escA: Escenario;
  let escB: Escenario;
  let invA: number;
  let movimientoA: number;

  beforeAll(async () => {
    app = await createTestApp();
    anonimo = new Api(app);
    admin = await crearAdmin(app);
    a = await crearEmpresa(app, 'Empresa A');
    b = await crearEmpresa(app, 'Empresa B');
    escA = await prepararEmpresa(a, 'fifo');
    escB = await prepararEmpresa(b, 'fifo');

    invA = await crearInventario(a.api, escA);
    const compra = await comprar(a.api, escA, '2026-03-02', [
      { idInventario: invA, cantidad: 10, precio: 10 },
    ]);
    esperarStatus(compra, 201);

    const movimientos = await a.api.get('/movimientos');
    esperarStatus(movimientos, 200);
    movimientoA = Number(movimientos.body[0].id);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Autenticación', () => {
    it.each([
      ['GET', '/api/inventario-lote'],
      ['GET', '/api/inventario-lote/inventario/1'],
      ['POST', '/api/inventario-lote/consumir/1'],
      ['GET', '/api/lotes/inventario/1'],
      ['GET', '/api/costo-venta/reporte?año=2026'],
      ['GET', '/api/tipo-cambio/sunat'],
      ['GET', '/api/user'],
      ['POST', '/api/user'],
      ['GET', '/api/persona'],
      ['GET', '/api/rol'],
      ['POST', '/api/rol'],
      ['GET', '/api/permission'],
      ['GET', '/api/user-role'],
      ['POST', '/api/user-role'],
      ['POST', '/api/role-permission'],
      ['POST', '/api/email/send'],
    ])('%s %s exige token', async (method, url) => {
      const res =
        method === 'GET' ? await anonimo.get(url) : await anonimo.post(url, {});
      esperarStatus(res, 401);
    });

    it('el controlador de pruebas de comprobantes no está expuesto', async () => {
      const res = await a.api.get('/api/test-comprobantes/compras');
      esperarStatus(res, 404);
    });

    it('el login sigue siendo público', async () => {
      const res = await anonimo.post('/api/auth/login', {
        email: 'nadie@test.local',
        contrasena: 'x',
      });
      expect(res.status).not.toBe(401);
    });
  });

  describe('Roles', () => {
    it.each([
      ['GET', '/api/persona'],
      ['POST', '/api/user-role'],
      ['POST', '/api/rol'],
      ['POST', '/api/email/send'],
    ])('una EMPRESA no puede usar %s %s', async (method, url) => {
      const res =
        method === 'GET' ? await a.api.get(url) : await a.api.post(url, {});
      esperarStatus(res, 403);
    });

    it('una EMPRESA solo se ve a sí misma en el listado de usuarios', async () => {
      const res = await a.api.get('/api/user');
      esperarStatus(res, 200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].email).toBe('empresa.a@test.local');
    });

    it('una EMPRESA no puede editar a otro usuario', async () => {
      const otros = await admin.get('/api/user');
      const ajeno = otros.body.find(
        (u: any) => u.email === 'empresa.b@test.local',
      );
      const res = await a.api.patch(`/api/user/${ajeno.id}`, {
        nombre: 'Hackeado',
      });
      esperarStatus(res, 403);
      const clave = await a.api.patch(`/api/user/${ajeno.id}/password`, {
        password: 'otraClave123',
      });
      esperarStatus(clave, 403);
    });

    it('el listado de usuarios no expone tokens ni contraseñas', async () => {
      const res = await admin.get('/api/user');
      const texto = JSON.stringify(res.body);
      expect(texto).not.toMatch(/resetPassword|contrasena/);
    });

    it('un ADMIN sí puede listar usuarios y empresas', async () => {
      expect((await admin.get('/api/user')).status).toBe(200);
      expect((await admin.get('/api/persona')).status).toBe(200);
    });
  });

  describe('Validación de entrada', () => {
    it('rechaza un comprobante con tipos inválidos con 400', async () => {
      const res = await a.api.post('/api/comprobante', {
        idPersona: 'abc',
        moneda: 'XYZ',
        fechaEmision: 'no-es-fecha',
      });
      esperarStatus(res, 400);
      expect(JSON.stringify(res.body)).not.toMatch(/invalid input syntax/i);
    });

    it('rechaza cantidades negativas', async () => {
      const res = await comprar(a.api, escA, '2026-03-03', [
        { idInventario: invA, cantidad: -5, precio: 10 },
      ]);
      esperarStatus(res, 400);
    });

    it('acepta cantidades decimales', async () => {
      const res = await comprar(a.api, escA, '2026-03-03', [
        { idInventario: invA, cantidad: 0.5, precio: 10 },
      ]);
      esperarStatus(res, 201);
    });

    it('no expone errores internos de la base de datos', async () => {
      const res = await a.api.get('/api/inventario/abc');
      esperarStatus(res, 400);
      expect(JSON.stringify(res.body)).not.toMatch(
        /syntax|QueryFailed|relation/i,
      );
    });
  });

  describe('Aislamiento entre empresas', () => {
    it('B no puede comprar sobre el inventario de A', async () => {
      const antes = await stockActual(a.api, invA);
      const res = await comprar(b.api, escB, '2026-03-04', [
        { idInventario: invA, cantidad: 3, precio: 10 },
      ]);
      expect([403, 404]).toContain(res.status);
      expect(await stockActual(a.api, invA)).toBe(antes);
    });

    it('B no puede usar el proveedor de A', async () => {
      const invB = await crearInventario(b.api, escB);
      const res = await comprar(
        b.api,
        { ...escB, idProveedor: escA.idProveedor },
        '2026-03-04',
        [{ idInventario: invB, cantidad: 1, precio: 10 }],
      );
      expect([403, 404]).toContain(res.status);
    });

    it('B no puede referenciar como afecto un comprobante de A', async () => {
      const comprasA = await a.api.get('/api/compras');
      const idCompraA = Number(comprasA.body[0].idComprobante);
      const invB = await crearInventario(b.api, escB);
      const res = await b.api.post('/api/comprobante', {
        idPersona: escB.idProveedor,
        idTipoOperacion: escB.compra,
        idTipoComprobante: escB.factura,
        fechaEmision: '2026-03-04',
        moneda: 'PEN',
        tipoCambio: 1,
        serie: 'F001',
        numero: '99999999',
        idComprobanteAfecto: idCompraA,
        detalles: [
          {
            idInventario: invB,
            cantidad: 1,
            unidadMedida: 'unidad',
            precioUnitario: 10,
            subtotal: 10,
            igv: 1.8,
            isc: 0,
            total: 11.8,
          },
        ],
      });
      expect([403, 404]).toContain(res.status);
    });

    it('B no puede ver el kardex de A', async () => {
      const propio = await b.api.get(
        `/api/kardex?personaId=${b.personaId}&idInventario=${invA}`,
      );
      expect([403, 404]).toContain(propio.status);
      const falsificado = await b.api.get(
        `/api/kardex?personaId=${a.personaId}&idInventario=${invA}`,
      );
      expect([403, 404]).toContain(falsificado.status);
    });

    it('B no puede ver el inventario ni los lotes de A', async () => {
      expect([403, 404]).toContain(
        (await b.api.get(`/api/inventario/${invA}`)).status,
      );
      const lotes = await b.api.get(`/api/inventario-lote/inventario/${invA}`);
      expect([403, 404]).toContain(lotes.status);
      const todos = await b.api.get('/api/inventario-lote');
      esperarStatus(todos, 200);
      expect(todos.body).toHaveLength(0);
    });

    it('B no puede leer, cambiar ni borrar movimientos de A', async () => {
      expect((await b.api.get(`/movimientos/${movimientoA}`)).status).toBe(404);
      expect(
        (
          await b.api.patch(`/movimientos/${movimientoA}/estado`, {
            estado: 'CANCELADO',
          })
        ).status,
      ).not.toBe(200);
      expect(
        (await b.api.delete(`/movimientos/${movimientoA}`)).status,
      ).not.toBe(200);
    });

    it('una empresa no puede crear movimientos de kardex sin comprobante', async () => {
      const res = await a.api.post('/movimientos', {
        tipo: 'ENTRADA',
        fecha: '2026-03-05',
        numeroDocumento: 'MANUAL-1',
        estado: 'PROCESADO',
        detalles: [{ idInventario: invA, cantidad: 100 }],
      });
      esperarStatus(res, 403);
    });
  });
});
