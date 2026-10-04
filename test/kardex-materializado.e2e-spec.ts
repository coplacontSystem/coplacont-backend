import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KardexMaterializadoService } from 'src/modules/inventario/valoracion/kardex-materializado.service';
import { ValoracionService } from 'src/modules/inventario/valoracion/valoracion.service';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus } from './support/api';
import {
  comprar,
  crearInventario,
  Escenario,
  kardex,
  payloadComprobante,
  prepararEmpresa,
  stockActual,
  vender,
} from './support/escenario';

/**
 * Kardex materializado (fase 5): lo guardado coincide siempre con un cálculo
 * desde cero y se recalcula desde la fecha afectada cuando cambia el historial.
 */
describe('Kardex materializado (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let materializado: KardexMaterializadoService;
  let empresa: Empresa;
  let esc: Escenario;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    materializado = app.get(KardexMaterializadoService);
    empresa = await crearEmpresa(app, 'Empresa Materializado');
    esc = await prepararEmpresa(empresa, 'promedio');
  });

  afterAll(async () => {
    await app?.close();
  });

  const api = () => empresa.api;
  const lineasGuardadas = async (inv: number) =>
    await ds.query(
      'SELECT count(*)::int AS n FROM kardex_linea WHERE id_inventario = $1',
      [inv],
    );

  it('cada registro deja el kardex guardado igual al calculado desde cero', async () => {
    const inv = await crearInventario(api(), esc);
    await comprar(api(), esc, '2026-03-01', [
      { idInventario: inv, cantidad: 10, precio: 10 },
    ]);
    await vender(api(), esc, '2026-03-10', [
      { idInventario: inv, cantidad: 4, precio: 30 },
    ]);
    await comprar(api(), esc, '2026-03-12', [
      { idInventario: inv, cantidad: 6, precio: 16 },
    ]);
    await vender(api(), esc, '2026-03-15', [
      { idInventario: inv, cantidad: 7, precio: 30 },
    ]);

    expect((await lineasGuardadas(inv))[0].n).toBe(4);
    expect(await materializado.verificar([inv])).toEqual([]);
    const [saldo] = await ds.query(
      'SELECT cantidad, pendiente_desde FROM inventario_saldo WHERE id_inventario = $1',
      [inv],
    );
    expect(Number(saldo.cantidad)).toBe(5);
    expect(saldo.pendiente_desde).toBeNull();
    expect(await stockActual(api(), inv)).toBe(5);
  });

  it('una venta con la fecha más reciente solo lee los movimientos de ese día', async () => {
    const inv = await crearInventario(api(), esc);
    for (const dia of ['02', '03', '04']) {
      await comprar(api(), esc, `2026-09-${dia}`, [
        { idInventario: inv, cantidad: 5, precio: 10 },
      ]);
    }
    const espia = jest.spyOn(app.get(ValoracionService), 'cargarMovimientos');
    try {
      esperarStatus(
        await vender(api(), esc, '2026-09-20', [
          { idInventario: inv, cantidad: 2, precio: 30 },
        ]),
        201,
      );
      // Ninguna lectura del historial completo (desdeDia null)
      const desde = espia.mock.calls
        .filter(([ids]) => ids.map(Number).includes(inv))
        .map(([, d]) => d);
      expect(desde.length).toBeGreaterThan(0);
      expect(desde.every((d) => d === '2026-09-20')).toBe(true);
    } finally {
      espia.mockRestore();
    }
    expect(await materializado.verificar([inv])).toEqual([]);
  });

  it('una compra retroactiva recalcula el costo de las ventas posteriores', async () => {
    const inv = await crearInventario(api(), esc);
    await comprar(api(), esc, '2026-04-01', [
      { idInventario: inv, cantidad: 10, precio: 10 },
    ]);
    await vender(api(), esc, '2026-04-10', [
      { idInventario: inv, cantidad: 5, precio: 30 },
    ]);
    let venta = (await kardex(empresa, inv)).movimientos[1];
    expect(venta.costoUnitario).toBeCloseTo(10, 4);

    // Compra con fecha anterior a la venta: el promedio de la venta pasa a 15
    await comprar(api(), esc, '2026-04-05', [
      { idInventario: inv, cantidad: 10, precio: 20 },
    ]);
    const k = await kardex(empresa, inv);
    venta = k.movimientos.find((m: any) => m.tipo === 'Salida');
    expect(venta.costoUnitario).toBeCloseTo(15, 4);
    expect(venta.costoTotal).toBeCloseTo(75, 4);
    expect(Number(k.costoFinal)).toBeCloseTo(225, 4);
    expect(await materializado.verificar([inv])).toEqual([]);
  });

  it('reconstruye el kardex de un inventario que nunca se materializó', async () => {
    const inv = await crearInventario(api(), esc);
    await comprar(api(), esc, '2026-05-01', [
      { idInventario: inv, cantidad: 8, precio: 12.5 },
    ]);
    await vender(api(), esc, '2026-05-02', [
      { idInventario: inv, cantidad: 3, precio: 30 },
    ]);
    const antes = await kardex(empresa, inv);

    // Como los datos registrados antes de la fase 5
    await ds.query('DELETE FROM kardex_linea WHERE id_inventario = $1', [inv]);
    await ds.query('DELETE FROM inventario_saldo WHERE id_inventario = $1', [
      inv,
    ]);

    expect(await kardex(empresa, inv)).toEqual(antes);
    expect((await lineasGuardadas(inv))[0].n).toBe(2);
  });

  it('editar el costo de un lote recalcula el kardex', async () => {
    const inv = await crearInventario(api(), esc);
    await comprar(api(), esc, '2026-06-01', [
      { idInventario: inv, cantidad: 10, precio: 10 },
    ]);
    await vender(api(), esc, '2026-06-05', [
      { idInventario: inv, cantidad: 10, precio: 30 },
    ]);
    const [lote] = await ds.query(
      'SELECT id FROM inventario_lote WHERE id_inventario = $1',
      [inv],
    );
    esperarStatus(
      await api().patch(`/api/inventario-lote/${lote.id}`, {
        costoUnitario: 12,
      }),
      200,
    );
    const venta = (await kardex(empresa, inv)).movimientos[1];
    expect(venta.costoUnitario).toBeCloseTo(12, 4);
    expect(await materializado.verificar([inv])).toEqual([]);
  });

  it('con KARDEX_MATERIALIZADO=false el cálculo dinámico da los mismos números', async () => {
    const inv = await crearInventario(api(), esc);
    await comprar(api(), esc, '2026-07-01', [
      { idInventario: inv, cantidad: 9, precio: 11 },
    ]);
    await vender(api(), esc, '2026-07-03', [
      { idInventario: inv, cantidad: 4, precio: 30 },
    ]);
    const leerTodo = async () => ({
      kardex: await kardex(empresa, inv),
      stock: await stockActual(api(), inv),
      costo: (await api().get('/api/costo-venta/reporte?año=2026')).body,
    });
    const guardado = await leerTodo();
    process.env.KARDEX_MATERIALIZADO = 'false';
    try {
      const dinamico = await leerTodo();
      expect(dinamico.kardex).toEqual(guardado.kardex);
      expect(dinamico.stock).toBe(guardado.stock);
      for (const [i, mes] of guardado.costo.datosMensuales.entries()) {
        const otro = dinamico.costo.datosMensuales[i];
        for (const campo of [
          'comprasTotales',
          'salidasTotales',
          'inventarioFinal',
        ]) {
          expect(Number(otro[campo])).toBeCloseTo(Number(mes[campo]), 2);
        }
      }
    } finally {
      delete process.env.KARDEX_MATERIALIZADO;
    }
  });

  describe('Método de valoración', () => {
    it('no se puede cambiar si el período ya tiene movimientos', async () => {
      const res = await api().put(
        '/api/periodos-contables/configuracion/metodo-valoracion',
        { metodoValoracion: 'fifo' },
      );
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/inicio del ejercicio/);
    });

    it('se puede cambiar mientras el período no tenga movimientos', async () => {
      const nueva = await crearEmpresa(app, 'Empresa Sin Movimientos');
      await prepararEmpresa(nueva, 'promedio');
      const res = await nueva.api.put(
        '/api/periodos-contables/configuracion/metodo-valoracion',
        { metodoValoracion: 'fifo' },
      );
      esperarStatus(res, 200);
    });
  });

  it('una nota de crédito sobre una venta antigua usa el costo guardado de la venta', async () => {
    const inv = await crearInventario(api(), esc);
    await comprar(api(), esc, '2026-08-01', [
      { idInventario: inv, cantidad: 10, precio: 10 },
    ]);
    const venta = await vender(api(), esc, '2026-08-02', [
      { idInventario: inv, cantidad: 4, precio: 30 },
    ]);
    // Una compra posterior más cara no cambia el costo de la devolución
    await comprar(api(), esc, '2026-08-10', [
      { idInventario: inv, cantidad: 10, precio: 40 },
    ]);
    esperarStatus(
      await api().post('/api/comprobante', {
        ...payloadComprobante(
          esc.idCliente,
          esc.venta,
          esc.notaCredito,
          '2026-08-20',
          [{ idInventario: inv, cantidad: 2, precio: 30 }],
        ),
        idComprobanteAfecto: venta.body.idComprobante,
      }),
      201,
    );
    const k = await kardex(empresa, inv);
    const devolucion = k.movimientos[k.movimientos.length - 1];
    expect(devolucion.costoUnitario).toBeCloseTo(10, 4);
    expect(await materializado.verificar([inv])).toEqual([]);
  });
});
