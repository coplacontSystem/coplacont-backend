import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus, idOf } from './support/api';
import {
  crearInventarioDe,
  Escenario,
  prepararEmpresa,
  stockActual,
} from './support/escenario';

const EJEMPLOS = join(__dirname, '../src/modules/importacion/cpe/ejemplos');
/** RUC de la empresa en los XML de ejemplo; se cambia por el de la empresa de prueba */
const RUC_EJEMPLO = '20999888777';

describe('Importación de XML (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let esc: Escenario;
  let ruc: string;
  let idAceite: number;
  let invAceite: number;

  /** XML de ejemplo en base64, a nombre de la empresa de prueba */
  const xml = (nombre: string, deOtraEmpresa = false) => {
    const archivo = join(EJEMPLOS, `${nombre}.xml`);
    const latino = nombre.includes('usd');
    let texto = readFileSync(archivo, latino ? 'latin1' : 'utf8');
    if (!deOtraEmpresa) texto = texto.split(RUC_EJEMPLO).join(ruc);
    return {
      nombre: `${nombre}.xml`,
      contenido: Buffer.from(texto, latino ? 'latin1' : 'utf8').toString(
        'base64',
      ),
    };
  };

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Importa XML');
    esc = await prepararEmpresa(empresa, 'promedio');
    const [p] = await app
      .get(DataSource)
      .query(`SELECT ruc FROM persona WHERE id = $1`, [empresa.personaId]);
    ruc = p.ruc;
    const aceite = await api().post('/api/productos', {
      idCategoria: esc.idCategoria,
      tipo: 'producto',
      nombre: 'Aceite Primor 1 L',
      descripcion: 'Botella de 1 litro',
      unidadMedida: 'unidad',
      codigo: 'ACE-001',
    });
    esperarStatus(aceite, 201);
    idAceite = idOf(aceite.body);
    invAceite = await crearInventarioDe(api(), esc.idAlmacen, idAceite);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => empresa.api;
  const previsualizar = (archivos: object[]) =>
    api().post('/api/importacion/cpe/previsualizar', { archivos });
  const registrar = (archivos: object[]) =>
    api().post('/api/importacion/cpe/registrar', {
      idAlmacen: esc.idAlmacen,
      archivos,
    });

  it('previsualiza: compra, venta, notas, errores y sugerencias', async () => {
    const res = await previsualizar([
      xml('factura-mercaderias-pen'),
      xml('factura-servicio-usd-detraccion'),
      xml('boleta-venta-propia'),
      xml('nota-credito-compra'),
      xml('nota-debito-compra'),
      xml('factura-mercaderias-pen', true),
      { nombre: 'roto.xml', contenido: Buffer.from('<<no').toString('base64') },
    ]);
    esperarStatus(res, 200);
    const [merc, usd, boleta, nc, nd, ajena, roto] = res.body;

    expect(merc).toMatchObject({
      valido: true,
      operacion: 'compra',
      contraparte: { numeroDocumento: '20100055237', idEntidad: null },
      documento: { serie: 'F001', numero: '120' },
    });
    expect(merc.avisos.join()).toMatch(/Se creará el proveedor/);
    // El aceite por caja se parece por nombre al producto existente: sugerencia a confirmar
    expect(merc.lineas[0].sugerencia).toMatchObject({
      idProducto: idAceite,
      origen: 'nombre',
      segura: false,
    });
    expect(merc.lineas[1].sugerencia).toBeNull();

    expect(usd).toMatchObject({ valido: true, operacion: 'compra' });
    expect(usd.avisos.join()).toMatch(/detracción/);

    expect(boleta).toMatchObject({ valido: true, operacion: 'venta' });
    expect(boleta.lineas[0].sugerencia).toMatchObject({
      idProducto: idAceite,
      origen: 'codigo',
      segura: true,
    });

    expect(nc).toMatchObject({
      valido: true,
      afectado: {
        serieNumero: 'F001-120',
        enEstaCarga: true,
        idComprobante: null,
      },
    });
    expect(nd.valido).toBe(true);

    expect(ajena.valido).toBe(false);
    expect(ajena.errores[0]).toMatch(/no es de tu empresa/);
    expect(roto.valido).toBe(false);
  });

  it('registra la carga: entidades, productos nuevos, factor y servicios', async () => {
    const res = await registrar([
      // La nota va primero en la carga: se registra después de su factura
      {
        ...xml('nota-credito-compra'),
        lineas: [
          { orden: 1, tipo: 'producto', idProducto: idAceite, factor: 12 },
        ],
      },
      {
        ...xml('factura-mercaderias-pen'),
        lineas: [
          { orden: 1, tipo: 'producto', idProducto: idAceite, factor: 12 },
          {
            orden: 2,
            tipo: 'producto',
            nuevoProducto: {
              nombre: 'Fideo Don Vittorio 500 g',
              idCategoria: esc.idCategoria,
              unidadMedida: 'unidad',
            },
          },
          {
            orden: 3,
            tipo: 'producto',
            nuevoProducto: {
              nombre: 'Papa blanca',
              idCategoria: esc.idCategoria,
              unidadMedida: 'kg',
            },
          },
        ],
      },
      {
        ...xml('factura-servicio-usd-detraccion'),
        tipoCambio: 3.75,
        lineas: [{ orden: 1, tipo: 'servicio', codigoCuenta: '6371' }],
      },
      {
        ...xml('boleta-venta-propia'),
        lineas: [{ orden: 1, tipo: 'producto', idProducto: idAceite }],
      },
      {
        ...xml('nota-debito-compra'),
        lineas: [{ orden: 1, tipo: 'servicio', codigoCuenta: '6371' }],
      },
    ]);
    esperarStatus(res, 200);
    expect(res.body.map((r: any) => [r.serieNumero, r.ok, r.error])).toEqual([
      ['FC01-7', true, undefined],
      ['F001-120', true, undefined],
      ['E001-236', true, undefined],
      ['B001-45', true, undefined],
      ['FD01-3', true, undefined],
    ]);

    // 2 cajas × 12 = 24; vende 10; devuelve 1 caja (12) al proveedor
    expect(await stockActual(api(), invAceite)).toBe(2);

    const ds = app.get(DataSource);
    const [compra] = await ds.query(
      `SELECT c.moneda, c."tipoCambio", t."totalGeneral"
         FROM comprobante c JOIN comprobante_totales t ON t.id_comprobante = c."idComprobante"
        WHERE c."idComprobante" = $1`,
      [res.body[1].idComprobante],
    );
    expect(Number(compra.totalGeneral)).toBeCloseTo(1210.4, 2);
    const cliente = await ds.query(
      `SELECT tipo, nombre, "apellidoPaterno" FROM entidades
        WHERE id_persona = $1 AND "numeroDocumento" = '45678912'`,
      [empresa.personaId],
    );
    expect(cliente[0]).toMatchObject({
      tipo: 'NATURAL',
      apellidoPaterno: 'JUAN',
    });
  });

  it('recuerda lo decidido y no registra dos veces', async () => {
    const res = await previsualizar([xml('factura-mercaderias-pen')]);
    esperarStatus(res, 200);
    const [merc] = res.body;
    expect(merc.valido).toBe(false);
    expect(merc.errores.join()).toMatch(/Ya está registrado/);
    expect(merc.contraparte.idEntidad).not.toBeNull();
    expect(merc.lineas[0].sugerencia).toMatchObject({
      idProducto: idAceite,
      factor: 12,
      origen: 'equivalencia',
      segura: true,
    });
    expect(merc.lineas[1].sugerencia).toMatchObject({
      nombre: 'Fideo Don Vittorio 500 g',
      origen: 'equivalencia',
    });

    const otra = await registrar([
      {
        ...xml('factura-mercaderias-pen'),
        lineas: [1, 2, 3].map((orden) => ({
          orden,
          tipo: 'producto',
          idProducto: idAceite,
        })),
      },
    ]);
    esperarStatus(otra, 200);
    expect(otra.body[0]).toMatchObject({ ok: false });
    expect(otra.body[0].error).toMatch(/ya está registrado/);

    const eq = await api().get('/api/importacion/equivalencias');
    expect(eq.body.length).toBeGreaterThanOrEqual(4);
  });

  it('exige resolver todas las líneas y el almacén', async () => {
    const res = await api().post('/api/importacion/cpe/registrar', {
      archivos: [
        {
          ...xml('boleta-venta-propia'),
          lineas: [],
        },
      ],
    });
    esperarStatus(res, 200);
    expect(res.body[0].error).toMatch(/Falta decidir/);
  });
});
