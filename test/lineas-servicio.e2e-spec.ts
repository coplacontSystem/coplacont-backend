import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus, idOf } from './support/api';
import {
  crearInventario,
  Escenario,
  payloadComprobante,
  prepararEmpresa,
  stockActual,
} from './support/escenario';

/** Línea de servicio: gasto con cuenta contable y, opcional, área */
const servicio = (codigoCuenta: string, monto: number, idArea?: number) => ({
  tipoLinea: 'servicio',
  codigoCuenta,
  idArea,
  cantidad: 1,
  unidadMedida: 'ZZ',
  precioUnitario: monto,
  subtotal: monto,
  igv: Math.round(monto * 18) / 100,
  isc: 0,
  total: Math.round(monto * 118) / 100,
  descripcion: 'Servicio de prueba',
});

describe('Líneas de servicio y áreas (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let otra: Empresa;
  let esc: Escenario;
  let inv: number;
  let areas: { id: number; nombre: string; cuentaDestino: string }[];
  let areaAjena: number;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Servicios');
    otra = await crearEmpresa(app, 'Empresa Servicios Ajena');
    esc = await prepararEmpresa(empresa, 'promedio');
    await prepararEmpresa(otra, 'promedio');
    inv = await crearInventario(empresa.api, esc);
    areaAjena = (await otra.api.get('/api/areas')).body[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => empresa.api;
  const compra = (detalles: object[], fecha = '2026-05-10') => {
    const base = payloadComprobante(
      esc.idProveedor,
      esc.compra,
      esc.factura,
      fecha,
      [],
    );
    return api().post('/api/comprobante', { ...base, detalles });
  };

  it('crea las áreas por defecto con sus cuentas de destino', async () => {
    const res = await api().get('/api/areas');
    esperarStatus(res, 200);
    areas = res.body;
    expect(areas.map((a) => [a.nombre, a.cuentaDestino])).toEqual(
      expect.arrayContaining([
        ['Administración', '94'],
        ['Ventas', '95'],
        ['Producción', '92'],
      ]),
    );
    const c94 = await api().get('/api/plan-contable/cuentas/94');
    expect(c94.body.cuenta).toMatchObject({ propia: true, imputable: true });
  });

  it('administra áreas: crear, validar destino y desactivar', async () => {
    const nueva = await api().post('/api/areas', {
      nombre: 'Logística',
      cuentaDestino: '95',
    });
    esperarStatus(nueva, 201);
    expect(
      (await api().post('/api/areas', { nombre: 'Logística' })).status,
    ).toBe(409);
    expect(
      (await api().post('/api/areas', { nombre: 'Mala', cuentaDestino: '62' }))
        .status,
    ).toBe(400);
    expect(
      (
        await api().post('/api/areas', {
          nombre: 'Sin cuenta',
          cuentaDestino: '98',
        })
      ).status,
    ).toBe(400);
    const logistica = nueva.body.find((a: any) => a.nombre === 'Logística');
    const des = await api().patch(`/api/areas/${logistica.id}`, {
      activa: false,
    });
    esperarStatus(des, 200);
    expect(des.body.find((a: any) => a.id === logistica.id).activa).toBe(false);
  });

  it('registra una compra mixta: el producto mueve kardex y el servicio no', async () => {
    const admin = areas.find((a) => a.nombre === 'Administración')!;
    const base = payloadComprobante(
      esc.idProveedor,
      esc.compra,
      esc.factura,
      '2026-05-10',
      [{ idInventario: inv, cantidad: 10, precio: 5 }],
    );
    const res = await api().post('/api/comprobante', {
      ...base,
      detalles: [...base.detalles, servicio('6361', 200, admin.id)],
    });
    esperarStatus(res, 201);
    const lineas = res.body.detalles;
    const srv = lineas.find((d: any) => d.tipoLinea === 'servicio');
    expect(srv).toMatchObject({
      cuenta: { codigo: '6361', nombre: 'Energía eléctrica' },
      area: { id: admin.id, nombre: 'Administración' },
    });
    expect(srv.idInventario).toBeUndefined();
    expect(
      Number(lineas.find((d: any) => d.tipoLinea === 'producto').idInventario),
    ).toBe(Number(inv));
    // Totales con ambas líneas; stock solo con el producto
    expect(Number(res.body.totales.totalGeneral)).toBeCloseTo(59 + 236, 2);
    expect(await stockActual(empresa.api, inv)).toBe(10);
  });

  it('registra una factura solo de servicios sin movimiento de inventario', async () => {
    const res = await compra([servicio('6371', 150)]);
    esperarStatus(res, 201);
    const ds = app.get(DataSource);
    const movs = await ds.query(
      `SELECT 1 FROM movimientos WHERE id_comprobante = $1`,
      [idOf(res.body)],
    );
    expect(movs).toHaveLength(0);
  });

  it('valida cada tipo de línea', async () => {
    const sinCuenta = { ...servicio('6361', 10), codigoCuenta: undefined };
    expect((await compra([sinCuenta])).status).toBe(400);
    const conInventario = { ...servicio('6361', 10), idInventario: inv };
    expect((await compra([conInventario])).status).toBe(400);
    const agrupa = await compra([servicio('636', 10)]);
    expect(agrupa.status).toBe(400);
    expect(JSON.stringify(agrupa.body)).toMatch(/agrupa subcuentas/);
    expect((await compra([servicio('6999999', 10)])).status).toBe(400);
    expect((await compra([servicio('6361', 10, areaAjena)])).status).toBe(400);
    const productoSinInventario = {
      ...servicio('6361', 10),
      tipoLinea: 'producto',
      codigoCuenta: undefined,
    };
    expect((await compra([productoSinInventario])).status).toBe(400);
  });

  it('el listado de compras incluye la cuenta y el área de la línea', async () => {
    const res = await api().get('/api/compras');
    esperarStatus(res, 200);
    const lista = Array.isArray(res.body) ? res.body : res.body.datos;
    const conServicio = lista.find((c: any) =>
      c.detalles?.some(
        (d: any) => d.tipoLinea === 'servicio' && d.cuenta?.codigo === '6371',
      ),
    );
    expect(conServicio).toBeDefined();
  });
});
