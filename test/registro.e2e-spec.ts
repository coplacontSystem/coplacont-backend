import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus, idOf } from './support/api';
import {
  comprar,
  crearInventario,
  crearInventarioDe,
  crearProductoEInventario,
  detalleCatalogo,
  Escenario,
  kardex,
  payloadComprobante,
  prepararEmpresa,
  stockActual,
  vender,
} from './support/escenario';

/**
 * Integridad del registro de comprobantes (fase 2): transacción, concurrencia,
 * importes, moneda, duplicados, notas, catálogo, fechas y transferencias.
 */
describe('Registro de comprobantes (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let esc: Escenario;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Registro');
    esc = await prepararEmpresa(empresa, 'fifo');
  });

  afterAll(async () => {
    await app?.close();
  });

  const api = () => empresa.api;

  /** Inventario con 10 unidades compradas a S/ 10 el 01/03. */
  async function inventarioConStock(cantidad = 10) {
    const inv = await crearInventario(api(), esc);
    esperarStatus(
      await comprar(api(), esc, '2026-03-01', [
        { idInventario: inv, cantidad, precio: 10 },
      ]),
      201,
    );
    return inv;
  }

  describe('Transacción', () => {
    it('si el registro falla a mitad no deja lotes, comprobantes ni correlativo', async () => {
      const ds = app.get(DataSource);
      // Hace fallar la inserción del movimiento (último paso del registro)
      await ds.query(`
        CREATE OR REPLACE FUNCTION falla_movimiento() RETURNS trigger AS $$
        BEGIN
          IF NEW."numeroDocumento" = 'FALLA-00000001' THEN
            RAISE EXCEPTION 'falla forzada';
          END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS falla_movimiento ON movimientos;
        CREATE TRIGGER falla_movimiento BEFORE INSERT ON movimientos
          FOR EACH ROW EXECUTE FUNCTION falla_movimiento();`);
      try {
        const inv = await crearInventario(api(), esc);
        const contar = async () => {
          const [r] = await ds.query(
            `SELECT
               (SELECT count(*) FROM inventario_lote WHERE id_inventario = $1)::int AS lotes,
               (SELECT count(*) FROM comprobante WHERE serie = 'FALLA')::int AS comprobantes,
               (SELECT COALESCE(max("ultimoNumero"), 0) FROM correlativos
                 WHERE "personaId" = $2 AND tipo = $3)::int AS correlativo`,
            [inv, empresa.personaId, String(esc.compra)],
          );
          return r;
        };
        const antes = await contar();
        const res = await api().post('/api/comprobante', {
          ...payloadComprobante(
            esc.idProveedor,
            esc.compra,
            esc.factura,
            '2026-03-02',
            [{ idInventario: inv, cantidad: 5, precio: 10 }],
          ),
          serie: 'FALLA',
          numero: '00000001',
        });
        expect(res.status).toBe(500);
        expect(await contar()).toEqual(antes);
      } finally {
        await ds.query(
          'DROP TRIGGER IF EXISTS falla_movimiento ON movimientos',
        );
      }
    });
  });

  describe('Stock', () => {
    it('dos ventas simultáneas no pueden vender el mismo stock', async () => {
      const inv = await inventarioConStock(10);
      const [v1, v2] = await Promise.all([
        vender(api(), esc, '2026-03-05', [
          { idInventario: inv, cantidad: 6, precio: 20 },
        ]),
        vender(api(), esc, '2026-03-05', [
          { idInventario: inv, cantidad: 6, precio: 20 },
        ]),
      ]);
      expect([v1.status, v2.status].sort()).toEqual([201, 400]);
      expect(await stockActual(api(), inv)).toBe(4);
    });

    it('varias líneas del mismo producto suman su cantidad', async () => {
      const inv = await inventarioConStock(10);
      const excedida = await vender(api(), esc, '2026-03-05', [
        { idInventario: inv, cantidad: 6, precio: 20 },
        { idInventario: inv, cantidad: 6, precio: 20 },
      ]);
      expect(excedida.status).toBe(400);

      const valida = await vender(api(), esc, '2026-03-05', [
        { idInventario: inv, cantidad: 4, precio: 20 },
        { idInventario: inv, cantidad: 3, precio: 20 },
      ]);
      esperarStatus(valida, 201);
      expect(await stockActual(api(), inv)).toBe(3);
      const k = await kardex(empresa, inv);
      expect(
        k.movimientos.filter((m: any) => m.tipo === 'Salida'),
      ).toHaveLength(2);
      expect(Number(k.cantidadActual)).toBe(3);
    });
  });

  describe('Importes y moneda', () => {
    it('rechaza un subtotal que no es cantidad × precio', async () => {
      const inv = await crearInventario(api(), esc);
      const payload = payloadComprobante(
        esc.idProveedor,
        esc.compra,
        esc.factura,
        '2026-03-02',
        [{ idInventario: inv, cantidad: 2, precio: 10 }],
      );
      payload.detalles[0].subtotal = 5;
      payload.detalles[0].total = 5 + payload.detalles[0].igv;
      const res = await api().post('/api/comprobante', payload);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/subtotal/);
    });

    it('rechaza un IGV mayor al 18 %', async () => {
      const inv = await crearInventario(api(), esc);
      const payload = payloadComprobante(
        esc.idProveedor,
        esc.compra,
        esc.factura,
        '2026-03-02',
        [{ idInventario: inv, cantidad: 2, precio: 10 }],
      );
      payload.detalles[0].igv = 10;
      payload.detalles[0].total = 30;
      expect((await api().post('/api/comprobante', payload)).status).toBe(400);
    });

    it('acepta IGV 0 (operación exonerada)', async () => {
      const inv = await crearInventario(api(), esc);
      const payload = payloadComprobante(
        esc.idProveedor,
        esc.compra,
        esc.factura,
        '2026-03-02',
        [{ idInventario: inv, cantidad: 2, precio: 10 }],
      );
      payload.detalles[0].igv = 0;
      payload.detalles[0].total = 20;
      esperarStatus(await api().post('/api/comprobante', payload), 201);
    });

    it('una compra en dólares guarda el costo del lote en soles', async () => {
      const inv = await crearInventario(api(), esc);
      const payload = {
        ...payloadComprobante(
          esc.idProveedor,
          esc.compra,
          esc.factura,
          '2026-03-02',
          [{ idInventario: inv, cantidad: 10, precio: 10 }],
        ),
        moneda: 'USD',
        tipoCambio: 3.5,
      };
      esperarStatus(await api().post('/api/comprobante', payload), 201);
      const k = await kardex(empresa, inv);
      expect(k.movimientos[0].costoUnitario).toBeCloseTo(35, 4);
      expect(Number(k.costoFinal)).toBeCloseTo(350, 4);
    });

    it('exige tipo de cambio en dólares', async () => {
      const inv = await crearInventario(api(), esc);
      const payload = {
        ...payloadComprobante(
          esc.idProveedor,
          esc.compra,
          esc.factura,
          '2026-03-02',
          [{ idInventario: inv, cantidad: 1, precio: 10 }],
        ),
        moneda: 'USD',
        tipoCambio: undefined,
      };
      expect((await api().post('/api/comprobante', payload)).status).toBe(400);
    });
  });

  describe('Documentos', () => {
    it('no registra dos veces el mismo comprobante del mismo proveedor', async () => {
      const inv = await crearInventario(api(), esc);
      const payload = payloadComprobante(
        esc.idProveedor,
        esc.compra,
        esc.factura,
        '2026-03-02',
        [{ idInventario: inv, cantidad: 1, precio: 10 }],
      );
      esperarStatus(await api().post('/api/comprobante', payload), 201);
      const repetido = await api().post('/api/comprobante', payload);
      expect(repetido.status).toBe(409);
      expect(await stockActual(api(), inv)).toBe(1);
    });

    it('una nota de crédito sobre una compra devuelve mercadería (salida)', async () => {
      const inv = await crearInventario(api(), esc);
      const compra = await comprar(api(), esc, '2026-03-01', [
        { idInventario: inv, cantidad: 10, precio: 10 },
      ]);
      esperarStatus(compra, 201);
      const res = await api().post('/api/comprobante', {
        ...payloadComprobante(
          esc.idProveedor,
          esc.compra,
          esc.notaCredito,
          '2026-03-06',
          [{ idInventario: inv, cantidad: 3, precio: 10 }],
        ),
        idComprobanteAfecto: compra.body.idComprobante,
      });
      esperarStatus(res, 201);
      expect(await stockActual(api(), inv)).toBe(7);
    });

    it('una nota de crédito sobre una venta reingresa la mercadería', async () => {
      const inv = await inventarioConStock(10);
      const venta = await vender(api(), esc, '2026-03-05', [
        { idInventario: inv, cantidad: 4, precio: 20 },
      ]);
      esperarStatus(venta, 201);
      const res = await api().post('/api/comprobante', {
        ...payloadComprobante(
          esc.idCliente,
          esc.venta,
          esc.notaCredito,
          '2026-03-06',
          [{ idInventario: inv, cantidad: 1, precio: 20 }],
        ),
        idComprobanteAfecto: venta.body.idComprobante,
      });
      esperarStatus(res, 201);
      expect(await stockActual(api(), inv)).toBe(7);
      // Reingresa al costo con que salió (S/ 10), no al precio de venta (S/ 20)
      const k = await kardex(empresa, inv);
      const devolucion = k.movimientos[k.movimientos.length - 1];
      expect(devolucion.tipo).toBe('Entrada');
      expect(devolucion.costoUnitario).toBeCloseTo(10, 4);
      expect(Number(k.costoFinal)).toBeCloseTo(70, 4);
    });
  });

  describe('Catálogo y listados', () => {
    it('Operaciones no muestra compras, ventas ni transferencias', async () => {
      const otros = await detalleCatalogo(api(), 12, '99');
      const op = await api().post('/api/comprobante', {
        idPersona: esc.idProveedor,
        idTipoOperacion: otros,
        idTipoComprobante: esc.factura,
        fechaEmision: '2026-03-02',
        moneda: 'PEN',
        tipoCambio: 1,
        serie: 'OP01',
        numero: '00000001',
        total: 150,
      });
      esperarStatus(op, 201);
      const lista = await api().get('/api/comprobante');
      esperarStatus(lista, 200);
      const codigos = new Set(
        lista.body.map((c: any) => c.tipoOperacion?.codigo),
      );
      expect(codigos.has('99')).toBe(true);
      for (const codigo of ['01', '02', '100', '101']) {
        expect(codigos.has(codigo)).toBe(false);
      }
    });
  });

  describe('Productos', () => {
    it('dos empresas pueden usar el mismo código de producto', async () => {
      const otra = await crearEmpresa(app, 'Empresa Codigos');
      const escOtra = await prepararEmpresa(otra, 'fifo');
      const codigo = `MISMO-${Date.now() % 100000}`;
      const crear = (e: Empresa, idCategoria: number) =>
        e.api.post('/api/productos', {
          idCategoria,
          tipo: 'producto',
          nombre: 'Producto compartido',
          descripcion: 'Mismo código en dos empresas',
          unidadMedida: 'unidad',
          codigo,
        });
      esperarStatus(await crear(empresa, esc.idCategoria), 201);
      esperarStatus(await crear(otra, escOtra.idCategoria), 201);
      expect((await crear(empresa, esc.idCategoria)).status).toBe(409);
    });
  });

  describe('Fechas', () => {
    it('guarda la fecha de emisión sin cambiar de día', async () => {
      const inv = await crearInventario(api(), esc);
      const res = await comprar(api(), esc, '2026-03-02', [
        { idInventario: inv, cantidad: 1, precio: 10 },
      ]);
      esperarStatus(res, 201);
      expect(String(res.body.fechaEmision)).toMatch(/^2026-03-02/);
      const k = await kardex(empresa, inv);
      expect(k.movimientos[0].fecha).toMatch(/02/);
    });

    it('acepta el último día del período', async () => {
      const inv = await crearInventario(api(), esc);
      esperarStatus(
        await comprar(api(), esc, '2026-12-31', [
          { idInventario: inv, cantidad: 1, precio: 10 },
        ]),
        201,
      );
    });

    it('rechaza fechas fuera del período', async () => {
      const inv = await crearInventario(api(), esc);
      const res = await comprar(api(), esc, '2027-01-01', [
        { idInventario: inv, cantidad: 1, precio: 10 },
      ]);
      expect(res.status).toBe(400);
    });
  });

  describe('Transferencias', () => {
    it('mueve stock entre almacenes y aparece una sola vez en el listado', async () => {
      const destino = await api().post('/api/almacenes', {
        nombre: 'Almacén Destino',
        ubicacion: 'Av. Destino 321, Lima',
      });
      esperarStatus(destino, 201);
      const idDestino = idOf(destino.body);
      const { idProducto, idInventario } = await crearProductoEInventario(
        api(),
        esc,
      );
      esperarStatus(
        await comprar(api(), esc, '2026-03-01', [
          { idInventario, cantidad: 10, precio: 10 },
        ]),
        201,
      );
      const invDestino = await crearInventarioDe(api(), idDestino, idProducto);

      const transferir = (cantidad: number, numero: string) =>
        api().post('/api/transferencias', {
          idAlmacenOrigen: esc.idAlmacen,
          idAlmacenDestino: idDestino,
          fechaEmision: '2026-03-03',
          moneda: 'PEN',
          serie: 'T001',
          numero,
          detalles: [{ idProducto, cantidad }],
        });

      expect((await transferir(11, '00000001')).status).toBe(400);
      esperarStatus(await transferir(4, '00000002'), 201);
      expect(await stockActual(api(), idInventario)).toBe(6);
      expect(await stockActual(api(), invDestino)).toBe(4);

      const k = await kardex(empresa, invDestino);
      expect(k.movimientos[0].costoUnitario).toBeCloseTo(10, 4);

      // Para la empresa una transferencia no es compra ni costo de ventas
      const reporte = await api().get(
        `/api/costo-venta/reporte?año=2026&idProducto=${idProducto}`,
      );
      esperarStatus(reporte, 200);
      const marzo = reporte.body.datosMensuales.find((d: any) => d.mes === 3);
      expect(Number(marzo.comprasTotales)).toBeCloseTo(100, 2);
      expect(Number(marzo.salidasTotales)).toBeCloseTo(0, 2);
      expect(Number(marzo.inventarioFinal)).toBeCloseTo(100, 2);

      const lista = await api().get('/api/transferencias');
      esperarStatus(lista, 200);
      expect(
        lista.body.filter((c: any) => c.numero === '00000002'),
      ).toHaveLength(1);
    });
  });
});
