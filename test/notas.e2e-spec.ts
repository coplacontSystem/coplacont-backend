import { INestApplication } from '@nestjs/common';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus, idOf } from './support/api';
import {
  comprar,
  crearInventario,
  detalleCatalogo,
  Escenario,
  payloadComprobante,
  prepararEmpresa,
  stockActual,
  vender,
} from './support/escenario';

/**
 * Notas de crédito (07) y débito (08): a qué comprobante pueden aplicarse y
 * cuánto pueden devolver, solas o sumadas a las anteriores.
 */
describe('Notas de crédito y débito (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let esc: Escenario;
  let notaDebito: number;
  const api = () => empresa.api;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Notas');
    esc = await prepararEmpresa(empresa, 'promedio');
    notaDebito = await detalleCatalogo(api(), 10, '08');
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Compra de 10 unidades a S/ 10 (S/ 118 con IGV) el 01/03. */
  async function compraBase() {
    const inv = await crearInventario(api(), esc);
    const compra = await comprar(api(), esc, '2026-03-01', [
      { idInventario: inv, cantidad: 10, precio: 10 },
    ]);
    esperarStatus(compra, 201);
    return { inv, id: compra.body.idComprobante as number };
  }

  const notaCompra = (
    idAfecto: number | undefined,
    fecha: string,
    lineas: { idInventario: number; cantidad: number; precio: number }[],
    tipo = esc.notaCredito,
  ) =>
    api().post('/api/comprobante', {
      ...payloadComprobante(esc.idProveedor, esc.compra, tipo, fecha, lineas),
      idComprobanteAfecto: idAfecto,
    });

  const mensaje = (r: { body: { message?: string | string[] } }) =>
    [r.body.message].flat().join(' ');

  it('exige el comprobante que modifica', async () => {
    const { inv } = await compraBase();
    const r = await notaCompra(undefined, '2026-03-05', [
      { idInventario: inv, cantidad: 1, precio: 10 },
    ]);
    esperarStatus(r, 400);
    expect(mensaje(r)).toMatch(/debe indicar el comprobante/);
    expect(await stockActual(api(), inv)).toBe(10);
  });

  it('no devuelve más unidades de las compradas, ni sumando notas', async () => {
    const { inv, id } = await compraBase();
    const exceso = await notaCompra(id, '2026-03-05', [
      { idInventario: inv, cantidad: 11, precio: 10 },
    ]);
    esperarStatus(exceso, 400);

    esperarStatus(
      await notaCompra(id, '2026-03-05', [
        { idInventario: inv, cantidad: 6, precio: 10 },
      ]),
      201,
    );
    // Importe bajo para que falle por unidades y no por saldo
    const segunda = await notaCompra(id, '2026-03-06', [
      { idInventario: inv, cantidad: 5, precio: 1 },
    ]);
    esperarStatus(segunda, 400);
    expect(mensaje(segunda)).toMatch(/más unidades/);
    expect(await stockActual(api(), inv)).toBe(4);

    // Lo que queda sí se puede devolver
    esperarStatus(
      await notaCompra(id, '2026-03-06', [
        { idInventario: inv, cantidad: 4, precio: 10 },
      ]),
      201,
    );
    expect(await stockActual(api(), inv)).toBe(0);
  });

  it('no supera el importe del comprobante (nota sin detalle)', async () => {
    const { id } = await compraBase();
    const base = payloadComprobante(
      esc.idProveedor,
      esc.compra,
      esc.notaCredito,
      '2026-03-05',
      [],
    );
    const sinDetalle = (total: number) =>
      api().post('/api/comprobante', {
        ...base,
        numero: `${base.numero}${total}`,
        detalles: undefined,
        total,
        idComprobanteAfecto: id,
      });
    esperarStatus(await sinDetalle(100), 201);
    const r = await sinDetalle(20);
    esperarStatus(r, 400);
    expect(mensaje(r)).toMatch(/supera el saldo/);
  });

  it('no devuelve un producto que no estaba en el comprobante', async () => {
    const { id } = await compraBase();
    const otro = await crearInventario(api(), esc);
    const r = await notaCompra(id, '2026-03-05', [
      { idInventario: otro, cantidad: 1, precio: 10 },
    ]);
    esperarStatus(r, 400);
    expect(mensaje(r)).toMatch(/no está en/);
  });

  it('no puede ser anterior al comprobante', async () => {
    const { inv, id } = await compraBase();
    const r = await notaCompra(id, '2026-02-28', [
      { idInventario: inv, cantidad: 1, precio: 10 },
    ]);
    esperarStatus(r, 400);
    expect(mensaje(r)).toMatch(/anterior/);
  });

  it('una nota de compra no modifica una venta ni otra nota', async () => {
    const { inv, id } = await compraBase();
    const venta = await vender(api(), esc, '2026-03-02', [
      { idInventario: inv, cantidad: 1, precio: 20 },
    ]);
    esperarStatus(venta, 201);
    const cruzada = await notaCompra(venta.body.idComprobante, '2026-03-05', [
      { idInventario: inv, cantidad: 1, precio: 10 },
    ]);
    esperarStatus(cruzada, 400);
    expect(mensaje(cruzada)).toMatch(/mismo tipo de operación/);

    const nc = await notaCompra(id, '2026-03-05', [
      { idInventario: inv, cantidad: 1, precio: 10 },
    ]);
    esperarStatus(nc, 201);
    const sobreNota = await notaCompra(nc.body.idComprobante, '2026-03-06', [
      { idInventario: inv, cantidad: 1, precio: 10 },
    ]);
    esperarStatus(sobreNota, 400);
    expect(mensaje(sobreNota)).toMatch(/otra nota/);
  });

  it('debe ser de la misma contraparte y moneda', async () => {
    const { inv, id } = await compraBase();
    const otro = await api().post('/api/entidades', {
      tipo: 'JURIDICA',
      numeroDocumento: '20601030013',
      razonSocial: 'Otro Proveedor S.A.C.',
      esProveedor: true,
    });
    esperarStatus(otro, 201);
    const deOtro = await api().post('/api/comprobante', {
      ...payloadComprobante(
        idOf(otro.body),
        esc.compra,
        esc.notaCredito,
        '2026-03-05',
        [{ idInventario: inv, cantidad: 1, precio: 10 }],
      ),
      idComprobanteAfecto: id,
    });
    esperarStatus(deOtro, 400);
    expect(mensaje(deOtro)).toMatch(/misma contraparte/);

    const enDolares = await api().post('/api/comprobante', {
      ...payloadComprobante(
        esc.idProveedor,
        esc.compra,
        esc.notaCredito,
        '2026-03-05',
        [{ idInventario: inv, cantidad: 1, precio: 10 }],
      ),
      moneda: 'USD',
      tipoCambio: 3.7,
      idComprobanteAfecto: id,
    });
    esperarStatus(enDolares, 400);
    expect(mensaje(enDolares)).toMatch(/misma moneda/);
  });

  it('la nota de débito de compra se registra referida a la compra', async () => {
    const { id } = await compraBase();
    const base = payloadComprobante(
      esc.idProveedor,
      esc.compra,
      notaDebito,
      '2026-03-05',
      [],
    );
    const nd = await api().post('/api/comprobante', {
      ...base,
      detalles: undefined,
      total: 11.8,
      idComprobanteAfecto: id,
    });
    esperarStatus(nd, 201);
    const sinRef = await api().post('/api/comprobante', {
      ...base,
      numero: `${base.numero}9`,
      detalles: undefined,
      total: 11.8,
    });
    esperarStatus(sinRef, 400);
  });

  it('la nota de crédito de venta respeta lo vendido', async () => {
    const { inv } = await compraBase();
    const venta = await vender(api(), esc, '2026-03-02', [
      { idInventario: inv, cantidad: 3, precio: 20 },
    ]);
    esperarStatus(venta, 201);
    const nota = (cantidad: number) =>
      api().post('/api/comprobante', {
        ...payloadComprobante(
          esc.idCliente,
          esc.venta,
          esc.notaCredito,
          '2026-03-05',
          [{ idInventario: inv, cantidad, precio: 20 }],
        ),
        idComprobanteAfecto: venta.body.idComprobante,
      });
    esperarStatus(await nota(4), 400);
    esperarStatus(await nota(3), 201);
    expect(await stockActual(api(), inv)).toBe(10);
  });
});
