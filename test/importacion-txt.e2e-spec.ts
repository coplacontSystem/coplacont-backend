import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus } from './support/api';
import {
  crearProductoEInventario,
  Escenario,
  prepararEmpresa,
  stockActual,
} from './support/escenario';

const EJEMPLOS = join(__dirname, '../src/modules/importacion/sire/ejemplos');
const RUC_EJEMPLO = '20999888777';

describe('Importación de TXT de SIRE en cola (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let esc: Escenario;
  let ruc: string;

  const txt = (nombre: string) => ({
    nombre: `${nombre}.txt`,
    contenido: Buffer.from(
      readFileSync(join(EJEMPLOS, `${nombre}.txt`), 'utf8')
        .split(RUC_EJEMPLO)
        .join(ruc),
      'utf8',
    ).toString('base64'),
  });
  const api = () => empresa.api;
  const registrarUno = (body: object) =>
    api().post('/api/importacion/registrar-uno', body);
  const totales = async (id: number) =>
    (
      await app.get(DataSource).query(
        `SELECT "totalGravada", "totalExonerada", "totalInafecta", "totalIgv", "totalGeneral"
             FROM comprobante_totales WHERE id_comprobante = $1`,
        [id],
      )
    )[0] as Record<string, string>;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Importa TXT');
    esc = await prepararEmpresa(empresa, 'promedio');
    const [p] = await app
      .get(DataSource)
      .query(`SELECT ruc FROM persona WHERE id = $1`, [empresa.personaId]);
    ruc = p.ruc;
  });

  afterAll(async () => {
    await app.close();
  });

  it('previsualiza el registro de ventas: una entrada por fila', async () => {
    const res = await api().post('/api/importacion/cpe/previsualizar', {
      archivos: [txt('rvie-ventas')],
    });
    esperarStatus(res, 200);
    const items = res.body;
    expect(items.map((i: any) => [i.indice, i.valido, i.origen])).toEqual([
      [2, true, 'txt'],
      [3, true, 'txt'],
      [4, true, 'txt'],
      [5, true, 'txt'],
      [6, false, 'txt'],
    ]);
    expect(items[0]).toMatchObject({
      operacion: 'venta',
      conDetalle: false,
      contraparte: { razonSocial: 'VARIOS' },
      lineas: [],
    });
    expect(items[0].avisos.join()).toMatch(/no trae el detalle/);
    expect(items[3].afectado).toMatchObject({
      serieNumero: 'F001-101',
      enEstaCarga: true,
    });
    expect(items[4].errores[0]).toMatch(/no soportado/);
  });

  it('registra una boleta sin detalle con su desglose', async () => {
    const res = await registrarUno({
      archivo: txt('rvie-ventas'),
      indice: 2,
      sinDetalle: true,
    });
    esperarStatus(res, 200);
    expect(res.body).toMatchObject({ ok: true, serieNumero: 'EB01-2052' });
    expect(await totales(res.body.idComprobante)).toMatchObject({
      totalGravada: '255.00',
      totalIgv: '45.90',
      totalGeneral: '300.90',
    });
  });

  it('registra una factura con detalle escrito y valida el cuadre', async () => {
    const malo = await registrarUno({
      archivo: txt('rvie-ventas'),
      indice: 3,
      lineasManuales: [
        {
          tipo: 'servicio',
          codigoCuenta: '70411',
          cantidad: 1,
          valor: 900,
          afectacionIgv: '10',
        },
      ],
    });
    expect(malo.status).toBe(400);
    expect(JSON.stringify(malo.body)).toMatch(/no cuadra/);

    const sinNada = await registrarUno({
      archivo: txt('rvie-ventas'),
      indice: 3,
    });
    expect(sinNada.status).toBe(400);

    const res = await registrarUno({
      archivo: txt('rvie-ventas'),
      indice: 3,
      lineasManuales: [
        {
          tipo: 'servicio',
          codigoCuenta: '70411',
          cantidad: 3,
          valor: 333.33,
          afectacionIgv: '10',
        },
        {
          tipo: 'servicio',
          codigoCuenta: '70411',
          cantidad: 1,
          valor: 666.67,
          afectacionIgv: '10',
        },
        {
          tipo: 'servicio',
          codigoCuenta: '70411',
          cantidad: 1,
          valor: 50,
          afectacionIgv: '20',
        },
      ],
    });
    esperarStatus(res, 200);
    expect(await totales(res.body.idComprobante)).toMatchObject({
      totalGravada: '1000.00',
      totalExonerada: '50.00',
      totalIgv: '180.00',
      totalGeneral: '1230.00',
    });

    // La nota de crédito encuentra la factura recién registrada
    const nota = await registrarUno({
      archivo: txt('rvie-ventas'),
      indice: 5,
      lineasManuales: [
        {
          tipo: 'servicio',
          codigoCuenta: '70411',
          cantidad: 1,
          valor: 100,
          afectacionIgv: '10',
        },
      ],
    });
    esperarStatus(nota, 200);
  });

  it('registra una compra en dólares con producto y parte inafecta', async () => {
    const { idProducto, idInventario } = await crearProductoEInventario(
      api(),
      esc,
    );
    const res = await registrarUno({
      archivo: txt('rce-compras'),
      indice: 3,
      idAlmacen: esc.idAlmacen,
      lineasManuales: [
        {
          tipo: 'producto',
          idProducto,
          cantidad: 10,
          valor: 100,
          afectacionIgv: '10',
        },
        {
          tipo: 'servicio',
          codigoCuenta: '6371',
          cantidad: 1,
          valor: 25,
          afectacionIgv: '30',
        },
      ],
    });
    esperarStatus(res, 200);
    expect(await stockActual(api(), idInventario)).toBe(10);
    const [c] = await app
      .get(DataSource)
      .query(
        `SELECT moneda, "tipoCambio" FROM comprobante WHERE "idComprobante" = $1`,
        [res.body.idComprobante],
      );
    expect(c).toMatchObject({ moneda: 'USD', tipoCambio: '3.7500' });

    // Repetido: ya está registrado
    const otra = await registrarUno({
      archivo: txt('rce-compras'),
      indice: 3,
      sinDetalle: true,
    });
    expect(otra.status).toBe(409);
  });
});
