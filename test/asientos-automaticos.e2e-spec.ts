import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus, idOf } from './support/api';
import {
  comprar,
  crearInventario,
  Escenario,
  payloadComprobante,
  prepararEmpresa,
  vender,
} from './support/escenario';

type Linea = { codigoCuenta: string; debe: number; haber: number };

/** Líneas de un asiento como "cuenta D/H importe", ordenadas */
const resumen = (lineas: Linea[]) =>
  lineas
    .map(
      (l) =>
        `${l.codigoCuenta} ${l.debe ? 'D' : 'H'} ${(l.debe || l.haber).toFixed(2)}`,
    )
    .sort();

describe('Asientos automáticos de compras y ventas (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let esc: Escenario;
  let inv: number;
  const api = () => empresa.api;

  /** Asiento del comprobante (por su id) */
  const asientoDe = async (idComprobante: number) => {
    const [a] = await app
      .get(DataSource)
      .query(`SELECT id FROM asiento_contable WHERE id_comprobante = $1`, [
        idComprobante,
      ]);
    if (!a) throw new Error(`El comprobante ${idComprobante} no tiene asiento`);
    const res = await api().get(`/api/asientos/${a.id}`);
    esperarStatus(res, 200);
    return res.body;
  };

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Asientos Automaticos');
    esc = await prepararEmpresa(empresa, 'promedio');
    inv = await crearInventario(api(), esc);
  });

  afterAll(async () => {
    await app.close();
  });

  let idCompra: number;
  let idVenta: number;

  it('compra de mercaderías: 60 + 40 contra 42 y destino 20 contra 61', async () => {
    const res = await comprar(api(), esc, '2026-04-01', [
      { idInventario: inv, cantidad: 10, precio: 5 },
    ]);
    esperarStatus(res, 201);
    idCompra = idOf(res.body);
    const a = await asientoDe(idCompra);
    expect(a).toMatchObject({
      origen: 'compra',
      editable: false,
      totalDebe: 109,
    });
    expect(a.glosa).toMatch(/^Compra: Factura F001-/);
    expect(resumen(a.lineas)).toEqual(
      [
        '6011 D 50.00',
        '40111 D 9.00',
        '4212 H 59.00',
        '20111 D 50.00',
        '6111 H 50.00',
      ].sort(),
    );
  });

  it('gasto con área: destino 9x contra 79', async () => {
    const areas = (await api().get('/api/areas')).body;
    const admin = areas.find((x: any) => x.nombre === 'Administración');
    const base = payloadComprobante(
      esc.idProveedor,
      esc.compra,
      esc.factura,
      '2026-04-02',
      [],
    );
    const res = await api().post('/api/comprobante', {
      ...base,
      detalles: [
        {
          tipoLinea: 'servicio',
          codigoCuenta: '6371',
          idArea: admin.id,
          cantidad: 1,
          unidadMedida: 'ZZ',
          precioUnitario: 200,
          subtotal: 200,
          igv: 36,
          isc: 0,
          total: 236,
          descripcion: 'Publicidad',
        },
      ],
    });
    esperarStatus(res, 201);
    const a = await asientoDe(idOf(res.body));
    expect(resumen(a.lineas)).toEqual(
      [
        '6371 D 200.00',
        '40111 D 36.00',
        '4212 H 236.00',
        '94 D 200.00',
        '791 H 200.00',
      ].sort(),
    );
  });

  it('venta: 12 contra 40 y 70, y costo de ventas 69 contra 20 desde el kardex', async () => {
    const res = await vender(api(), esc, '2026-04-05', [
      { idInventario: inv, cantidad: 4, precio: 20 },
    ]);
    esperarStatus(res, 201);
    idVenta = idOf(res.body);
    const a = await asientoDe(idVenta);
    expect(a.origen).toBe('venta');
    expect(resumen(a.lineas)).toEqual(
      [
        '1212 D 94.40',
        '40111 H 14.40',
        '70121 H 80.00',
        '69121 D 20.00',
        '20111 H 20.00',
      ].sort(),
    );
  });

  it('nota de crédito de venta: el asiento al revés con 709', async () => {
    const res = await api().post('/api/comprobante', {
      ...payloadComprobante(
        esc.idCliente,
        esc.venta,
        esc.notaCredito,
        '2026-04-06',
        [{ idInventario: inv, cantidad: 1, precio: 20 }],
      ),
      idComprobanteAfecto: idVenta,
    });
    esperarStatus(res, 201);
    const a = await asientoDe(idOf(res.body));
    expect(resumen(a.lineas)).toEqual(
      [
        '70921 D 20.00',
        '40111 D 3.60',
        '1212 H 23.60',
        '20111 D 5.00',
        '69121 H 5.00',
      ].sort(),
    );
  });

  it('compra en dólares: importes en soles con el tipo de cambio', async () => {
    const res = await api().post('/api/comprobante', {
      ...payloadComprobante(
        esc.idProveedor,
        esc.compra,
        esc.factura,
        '2026-04-07',
        [{ idInventario: inv, cantidad: 2, precio: 10 }],
      ),
      moneda: 'USD',
      tipoCambio: 3.5,
    });
    esperarStatus(res, 201);
    const a = await asientoDe(idOf(res.body));
    expect(a.glosa).toMatch(/T\.C\. 3\.5/);
    expect(resumen(a.lineas)).toEqual(
      [
        '6011 D 70.00',
        '40111 D 12.60',
        '4212 H 82.60',
        '20111 D 70.00',
        '6111 H 70.00',
      ].sort(),
    );
  });

  it('los asientos automáticos no se editan a mano', async () => {
    const a = await asientoDe(idCompra);
    const res = await api().put(`/api/asientos/${a.id}`, {
      fecha: '2026-04-01',
      glosa: 'Cambio',
      lineas: [
        { codigoCuenta: '6011', debe: 1, haber: 0 },
        { codigoCuenta: '4212', debe: 0, haber: 1 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('cambia las cuentas y regenera conservando el número', async () => {
    const cuentas = await api().get('/api/asientos/automaticos/cuentas');
    esperarStatus(cuentas, 200);
    expect(cuentas.body.find((c: any) => c.clave === 'igv')).toMatchObject({
      codigo: '40111',
      error: null,
    });
    expect(
      (
        await api().put('/api/asientos/automaticos/cuentas', {
          ventaMercaderias: '701',
        })
      ).status,
    ).toBe(400);
    esperarStatus(
      await api().put('/api/asientos/automaticos/cuentas', {
        ventaMercaderias: '70111',
      }),
      200,
    );

    const antes = await asientoDe(idVenta);
    const gen = await api().post('/api/asientos/automaticos/generar', {
      desde: '2026-04-01',
      hasta: '2026-04-30',
    });
    esperarStatus(gen, 200);
    expect(gen.body).toMatchObject({
      generados: 0,
      actualizados: 5,
      errores: [],
    });
    const despues = await asientoDe(idVenta);
    expect(despues.numero).toBe(antes.numero);
    expect(resumen(despues.lineas)).toContain('70111 H 80.00');
  });
});
