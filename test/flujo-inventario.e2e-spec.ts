import { INestApplication } from '@nestjs/common';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa } from './support/api';
import {
  comprar,
  crearInventario,
  Escenario,
  kardex,
  prepararEmpresa,
  stockActual,
  vender,
} from './support/escenario';

/**
 * Red de seguridad del flujo compra → venta → kardex → inventario.
 * Fija los números actuales para detectar cualquier cambio al refactorizar.
 *
 * Escenario base (por producto):
 *   02/03  compra 10 u × S/ 10
 *   05/03  compra 10 u × S/ 20
 *   10/03  venta  15 u
 */
describe('Flujo de inventario (e2e)', () => {
  let app: INestApplication;
  let fifo: Empresa;
  let promedio: Empresa;
  let escFifo: Escenario;
  let escPromedio: Escenario;

  beforeAll(async () => {
    app = await createTestApp();
    fifo = await crearEmpresa(app, 'Empresa FIFO');
    promedio = await crearEmpresa(app, 'Empresa Promedio');
    escFifo = await prepararEmpresa(fifo, 'fifo');
    escPromedio = await prepararEmpresa(promedio, 'promedio');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function escenarioBase(empresa: Empresa, esc: Escenario) {
    const inv = await crearInventario(empresa.api, esc);
    const c1 = await comprar(empresa.api, esc, '2026-03-02', [
      { idInventario: inv, cantidad: 10, precio: 10 },
    ]);
    expect(c1.status).toBe(201);
    const c2 = await comprar(empresa.api, esc, '2026-03-05', [
      { idInventario: inv, cantidad: 10, precio: 20 },
    ]);
    expect(c2.status).toBe(201);
    const v1 = await vender(empresa.api, esc, '2026-03-10', [
      { idInventario: inv, cantidad: 15, precio: 30 },
    ]);
    expect(v1.status).toBe(201);
    return inv;
  }

  describe('FIFO', () => {
    let inv: number;

    beforeAll(async () => {
      inv = await escenarioBase(fifo, escFifo);
    });

    it('el kardex consume primero el lote más antiguo', async () => {
      const k = await kardex(fifo, inv);
      const resumen = k.movimientos.map((m: any) => [
        m.tipo,
        m.cantidad,
        m.costoUnitario,
        m.saldo,
      ]);
      expect(resumen).toEqual([
        ['Entrada', 10, 10, 10],
        ['Entrada', 10, 20, 20],
        ['Salida', 10, 10, 10],
        ['Salida', 5, 20, 5],
      ]);
      expect(Number(k.cantidadActual)).toBe(5);
      expect(Number(k.costoFinal)).toBeCloseTo(100, 4);
    });

    it('el inventario muestra el stock restante', async () => {
      expect(await stockActual(fifo.api, inv)).toBe(5);
    });

    it('rechaza una venta mayor al stock disponible', async () => {
      const res = await vender(fifo.api, escFifo, '2026-03-12', [
        { idInventario: inv, cantidad: 6, precio: 30 },
      ]);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await stockActual(fifo.api, inv)).toBe(5);
    });
  });

  describe('PROMEDIO', () => {
    let inv: number;

    beforeAll(async () => {
      inv = await escenarioBase(promedio, escPromedio);
    });

    it('el kardex valoriza la salida al costo promedio ponderado', async () => {
      const k = await kardex(promedio, inv);
      const salida = k.movimientos.find((m: any) => m.tipo === 'Salida');
      expect(salida.cantidad).toBe(15);
      expect(salida.costoUnitario).toBeCloseTo(15, 4);
      expect(salida.costoTotal).toBeCloseTo(225, 4);
      expect(Number(k.cantidadActual)).toBe(5);
      expect(Number(k.costoFinal)).toBeCloseTo(75, 4);
    });

    it('el inventario muestra el stock restante', async () => {
      expect(await stockActual(promedio.api, inv)).toBe(5);
    });
  });

  describe('Operaciones retroactivas', () => {
    it('una compra con fecha anterior se ordena por fecha en el kardex', async () => {
      const inv = await crearInventario(fifo.api, escFifo);
      await comprar(fifo.api, escFifo, '2026-04-10', [
        { idInventario: inv, cantidad: 5, precio: 30 },
      ]);
      await comprar(fifo.api, escFifo, '2026-04-01', [
        { idInventario: inv, cantidad: 5, precio: 10 },
      ]);
      const k = await kardex(fifo, inv);
      expect(k.movimientos.map((m: any) => m.costoUnitario)).toEqual([10, 30]);
      expect(Number(k.costoFinal)).toBeCloseTo(200, 4);
    });

    // D3 (fase 2): la venta retroactiva no considera lo que ya consumieron ventas posteriores.
    test.failing(
      'rechaza una venta retroactiva que deja stock negativo más adelante',
      async () => {
        const inv = await crearInventario(fifo.api, escFifo);
        await comprar(fifo.api, escFifo, '2026-05-01', [
          { idInventario: inv, cantidad: 10, precio: 10 },
        ]);
        const posterior = await vender(fifo.api, escFifo, '2026-05-20', [
          { idInventario: inv, cantidad: 8, precio: 30 },
        ]);
        expect(posterior.status).toBe(201);

        const retroactiva = await vender(fifo.api, escFifo, '2026-05-05', [
          { idInventario: inv, cantidad: 5, precio: 30 },
        ]);
        expect(retroactiva.status).toBeGreaterThanOrEqual(400);
      },
    );
  });

  describe('Listados', () => {
    // Compras y ventas se filtran por ids fijos del catálogo (D8, fase 2).
    // Con el seed actual coinciden; estos tests avisan si eso cambia.
    it('el listado de compras incluye las compras registradas', async () => {
      const res = await fifo.api.get('/api/compras');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('el listado de ventas incluye las ventas registradas', async () => {
      const res = await fifo.api.get('/api/ventas');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });
});
