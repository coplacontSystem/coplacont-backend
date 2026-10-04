import { INestApplication } from '@nestjs/common';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus } from './support/api';
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
    esperarStatus(c1, 201);
    const c2 = await comprar(empresa.api, esc, '2026-03-05', [
      { idInventario: inv, cantidad: 10, precio: 20 },
    ]);
    esperarStatus(c2, 201);
    const v1 = await vender(empresa.api, esc, '2026-03-10', [
      { idInventario: inv, cantidad: 15, precio: 30 },
    ]);
    esperarStatus(v1, 201);
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

    it('el Estado de Costo de Ventas valoriza al costo, no al precio de venta', async () => {
      const inventario = await fifo.api.get(`/api/inventario/${inv}`);
      const idProducto = inventario.body.producto.id;
      const res = await fifo.api.get(
        `/api/costo-venta/reporte?año=2026&idProducto=${idProducto}`,
      );
      esperarStatus(res, 200);
      const marzo = res.body.datosMensuales.find((d: any) => d.mes === 3);
      // Compras 10×10 + 10×20; salida FIFO 10×10 + 5×20 (no 15×30 de venta)
      expect(Number(marzo.comprasTotales)).toBeCloseTo(300, 2);
      expect(Number(marzo.salidasTotales)).toBeCloseTo(200, 2);
      expect(Number(marzo.inventarioFinal)).toBeCloseTo(100, 2);
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

    // Fase 4: el reporte usa el mismo motor que el kardex (antes sumaba costos FIFO)
    it('el Estado de Costo de Ventas coincide con el kardex', async () => {
      const inventario = await promedio.api.get(`/api/inventario/${inv}`);
      const res = await promedio.api.get(
        `/api/costo-venta/reporte?año=2026&idProducto=${inventario.body.producto.id}`,
      );
      esperarStatus(res, 200);
      const marzo = res.body.datosMensuales.find((d: any) => d.mes === 3);
      expect(Number(marzo.comprasTotales)).toBeCloseTo(300, 2);
      expect(Number(marzo.salidasTotales)).toBeCloseTo(225, 2);
      expect(Number(marzo.inventarioFinal)).toBeCloseTo(75, 2);
    });
  });

  describe('Kardex por rango de fechas', () => {
    let inv: number;
    const kardexEntre = (desde: string, hasta: string) =>
      fifo.api.get(
        `/api/kardex?idInventario=${inv}&fechaInicio=${desde}&fechaFin=${hasta}`,
      );

    beforeAll(async () => {
      inv = await escenarioBase(fifo, escFifo);
    });

    it('el saldo inicial es el saldo valorizado del día anterior', async () => {
      const res = await kardexEntre('2026-03-06', '2026-12-31');
      esperarStatus(res, 200);
      expect(Number(res.body.inventarioInicialCantidad)).toBe(20);
      expect(Number(res.body.inventarioInicialCostoTotal)).toBeCloseTo(300, 4);
      expect(res.body.movimientos.map((m: any) => m.tipo)).toEqual([
        'Salida',
        'Salida',
      ]);
      expect(Number(res.body.costoFinal)).toBeCloseTo(100, 4);
    });

    it('incluye los movimientos del último día del rango', async () => {
      const res = await kardexEntre('2026-03-01', '2026-03-10');
      esperarStatus(res, 200);
      expect(res.body.movimientos).toHaveLength(4);
      expect(Number(res.body.cantidadActual)).toBe(5);
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

    // D3: la venta con fecha pasada también se valida contra las ventas posteriores
    it('rechaza una venta retroactiva que deja stock negativo más adelante', async () => {
      const inv = await crearInventario(fifo.api, escFifo);
      await comprar(fifo.api, escFifo, '2026-05-01', [
        { idInventario: inv, cantidad: 10, precio: 10 },
      ]);
      const posterior = await vender(fifo.api, escFifo, '2026-05-20', [
        { idInventario: inv, cantidad: 8, precio: 30 },
      ]);
      esperarStatus(posterior, 201);

      const retroactiva = await vender(fifo.api, escFifo, '2026-05-05', [
        { idInventario: inv, cantidad: 5, precio: 30 },
      ]);
      expect(retroactiva.status).toBe(400);
    });

    it('una venta retroactiva toma los lotes de su fecha y el kardex reordena los consumos', async () => {
      const inv = await crearInventario(fifo.api, escFifo);
      await comprar(fifo.api, escFifo, '2026-05-01', [
        { idInventario: inv, cantidad: 10, precio: 10 },
      ]);
      await comprar(fifo.api, escFifo, '2026-05-10', [
        { idInventario: inv, cantidad: 10, precio: 20 },
      ]);
      esperarStatus(
        await vender(fifo.api, escFifo, '2026-05-20', [
          { idInventario: inv, cantidad: 8, precio: 30 },
        ]),
        201,
      );
      esperarStatus(
        await vender(fifo.api, escFifo, '2026-05-05', [
          { idInventario: inv, cantidad: 5, precio: 30 },
        ]),
        201,
      );
      const k = await kardex(fifo, inv);
      expect(
        k.movimientos.map((m: any) => [m.tipo, m.cantidad, m.costoUnitario]),
      ).toEqual([
        ['Entrada', 10, 10],
        ['Salida', 5, 10],
        ['Entrada', 10, 20],
        ['Salida', 5, 10],
        ['Salida', 3, 20],
      ]);
      expect(Number(k.costoFinal)).toBeCloseTo(7 * 20, 4);
      // Los lotes de la venta posterior se reasignan: el stock por lotes cuadra
      expect(await stockActual(fifo.api, inv)).toBe(7);
    });
  });

  describe('Listados', () => {
    // Compras y ventas se filtran por ids fijos del catálogo (D8, fase 2).
    // Con el seed actual coinciden; estos tests avisan si eso cambia.
    it('el listado de compras incluye las compras registradas', async () => {
      const res = await fifo.api.get('/api/compras');
      esperarStatus(res, 200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('el listado de ventas incluye las ventas registradas', async () => {
      const res = await fifo.api.get('/api/ventas');
      esperarStatus(res, 200);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });
});
