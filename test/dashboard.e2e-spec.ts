import { INestApplication } from '@nestjs/common';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus, idOf } from './support/api';
import {
  comprar,
  crearInventario,
  crearInventarioDe,
  Escenario,
  payloadComprobante,
  prepararEmpresa,
  vender,
} from './support/escenario';

/**
 * Portada de la empresa (FIFO):
 *   10/02  compra 4 u × S/ 25 (producto con stock mínimo 10)
 *   02/03  compra 10 u × S/ 10
 *   05/03  compra 10 u × S/ 20
 *   10/03  venta  15 u × S/ 30   → costo FIFO 10×10 + 5×20 = 200
 */
describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let otra: Empresa;
  let esc: Escenario;
  let inv: number;
  let idVenta: number;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Dashboard');
    otra = await crearEmpresa(app, 'Empresa Ajena Dashboard');
    esc = await prepararEmpresa(empresa, 'fifo');
    await prepararEmpresa(otra, 'fifo');

    inv = await crearInventario(empresa.api, esc);
    const producto = await empresa.api.post('/api/productos', {
      idCategoria: esc.idCategoria,
      tipo: 'producto',
      nombre: 'Producto con mínimo',
      descripcion: 'Producto con stock mínimo',
      unidadMedida: 'unidad',
      codigo: `DSH-${Date.now()}`,
      stockMinimo: 10,
    });
    esperarStatus(producto, 201);
    const invMinimo = await crearInventarioDe(
      empresa.api,
      esc.idAlmacen,
      idOf(producto.body),
    );

    esperarStatus(
      await comprar(empresa.api, esc, '2026-02-10', [
        { idInventario: invMinimo, cantidad: 4, precio: 25 },
      ]),
      201,
    );
    esperarStatus(
      await comprar(empresa.api, esc, '2026-03-02', [
        { idInventario: inv, cantidad: 10, precio: 10 },
      ]),
      201,
    );
    esperarStatus(
      await comprar(empresa.api, esc, '2026-03-05', [
        { idInventario: inv, cantidad: 10, precio: 20 },
      ]),
      201,
    );
    const venta = await vender(empresa.api, esc, '2026-03-10', [
      { idInventario: inv, cantidad: 15, precio: 30 },
    ]);
    esperarStatus(venta, 201);
    idVenta = idOf(venta.body);
  });

  afterAll(async () => {
    await app?.close();
  });

  const dashboard = async (e: Empresa, periodo = '2026-03') => {
    const res = await e.api.get(`/api/dashboard?periodo=${periodo}`);
    esperarStatus(res, 200);
    return res.body;
  };

  it('calcula ventas, compras, margen e IGV del mes', async () => {
    const d = await dashboard(empresa);
    expect(d.kpis.ventas).toEqual({ total: 450, cantidad: 1, variacion: null });
    expect(d.kpis.compras).toEqual({ total: 300, cantidad: 2, variacion: 200 });
    expect(d.kpis.costoVentas).toBe(200);
    expect(d.kpis.margen).toEqual({ monto: 250, porcentaje: 55.6 });
    expect(d.kpis.igv).toEqual({ ventas: 81, compras: 54, saldo: 27 });
  });

  it('devuelve la serie de 12 meses hasta el mes pedido', async () => {
    const d = await dashboard(empresa);
    expect(d.serieMensual).toHaveLength(12);
    expect(d.serieMensual[0].mes).toBe('2025-04');
    expect(d.serieMensual[10]).toEqual({
      mes: '2026-02',
      ventas: 0,
      compras: 100,
      costoVentas: 0,
    });
    expect(d.serieMensual[11]).toEqual({
      mes: '2026-03',
      ventas: 450,
      compras: 300,
      costoVentas: 200,
    });
  });

  it('valoriza el inventario y alerta el stock bajo', async () => {
    const d = await dashboard(empresa);
    // 5 u × S/ 20 que quedan + 4 u × S/ 25
    expect(d.inventario.valorTotal).toBe(200);
    expect(d.inventario.productosConStock).toBe(2);
    expect(d.inventario.porAlmacen).toEqual([
      { idAlmacen: esc.idAlmacen, nombre: 'Almacén Central', valor: 200 },
    ]);
    expect(d.alertas.totalStockBajo).toBe(1);
    expect(d.alertas.stockBajo[0]).toMatchObject({
      producto: 'Producto con mínimo',
      stock: 4,
      minimo: 10,
    });
    expect(d.alertas.totalFaltantes).toBe(0);
  });

  it('arma los rankings, los últimos movimientos y el período', async () => {
    const d = await dashboard(empresa);
    expect(d.topProductos).toHaveLength(1);
    expect(d.topProductos[0]).toMatchObject({ cantidad: 15, monto: 450 });
    expect(d.topClientes[0]).toMatchObject({
      id: esc.idCliente,
      monto: 450,
      comprobantes: 1,
    });
    expect(d.topProveedores[0]).toMatchObject({
      id: esc.idProveedor,
      monto: 300,
      comprobantes: 2,
    });
    expect(d.ultimosMovimientos[0]).toMatchObject({
      id: idVenta,
      tipo: 'VENTA',
      fecha: '2026-03-10',
      total: 531,
      moneda: 'PEN',
    });
    expect(d.periodo).toMatchObject({
      mes: '2026-03',
      año: 2026,
      cierre: '2026-12-31',
      cerrado: false,
    });
  });

  it('resta las notas de crédito de venta', async () => {
    esperarStatus(
      await empresa.api.post('/api/comprobante', {
        ...payloadComprobante(
          esc.idCliente,
          esc.venta,
          esc.notaCredito,
          '2026-03-12',
          [{ idInventario: inv, cantidad: 1, precio: 30 }],
        ),
        idComprobanteAfecto: idVenta,
      }),
      201,
    );
    const d = await dashboard(empresa);
    expect(d.kpis.ventas.total).toBe(420);
    expect(d.topProductos[0]).toMatchObject({ cantidad: 14, monto: 420 });
    // La devolución reingresa al costo con que salió y baja el costo de ventas
    expect(d.kpis.costoVentas).toBeLessThan(200);
    expect(d.kpis.costoVentas).toBeGreaterThanOrEqual(180);
  });

  it('no muestra datos de otra empresa', async () => {
    const d = await dashboard(otra);
    expect(d.kpis.ventas.total).toBe(0);
    expect(d.kpis.compras.total).toBe(0);
    expect(d.inventario.valorTotal).toBe(0);
    expect(d.topProductos).toEqual([]);
    expect(d.ultimosMovimientos).toEqual([]);
  });

  it('valida el formato del período', async () => {
    const res = await empresa.api.get('/api/dashboard?periodo=2026-13');
    esperarStatus(res, 400);
  });
});
