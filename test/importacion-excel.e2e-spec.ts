import { INestApplication } from '@nestjs/common';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus, idOf } from './support/api';
import {
  crearInventarioDe,
  Escenario,
  prepararEmpresa,
  stockActual,
} from './support/escenario';

describe('Importación con la plantilla Excel (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let esc: Escenario;
  let idAceite: number;
  let invAceite: number;
  let plantilla: { nombre: string; contenido: string };

  const api = () => empresa.api;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Importa Excel');
    esc = await prepararEmpresa(empresa, 'promedio');
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

  it('descarga la plantilla y la lee con sus ejemplos', async () => {
    const res = await api().descargar(
      '/api/reportes/plantilla-comprobantes?formato=xlsx',
    );
    esperarStatus(res, 200);
    plantilla = {
      nombre: 'plantilla.xlsx',
      contenido: (res.body as Buffer).toString('base64'),
    };

    const previa = await api().post('/api/importacion/cpe/previsualizar', {
      archivos: [plantilla],
    });
    esperarStatus(previa, 200);
    const [compra, boleta, nota] = previa.body;
    expect(compra).toMatchObject({
      origen: 'excel',
      indice: 2,
      valido: true,
      operacion: 'compra',
      conDetalle: true,
      documento: {
        serie: 'F001',
        numero: '1234',
        totales: { gravada: 650, igv: 117, total: 767 },
      },
    });
    expect(compra.lineas[0].sugerencia).toMatchObject({
      idProducto: idAceite,
      origen: 'codigo',
      segura: true,
    });
    expect(compra.lineas[1].sugerencia).toMatchObject({
      tipo: 'servicio',
      codigoCuenta: '6371',
      origen: 'plantilla',
    });
    expect(boleta).toMatchObject({
      valido: true,
      operacion: 'venta',
      conDetalle: false,
      documento: { totales: { gravada: 100, igv: 18, total: 118 } },
    });
    expect(nota.afectado).toMatchObject({
      serieNumero: 'F001-1234',
      enEstaCarga: true,
    });
  });

  it('registra los comprobantes de la plantilla uno por uno', async () => {
    const uno = (indice: number, extra: object) =>
      api().post('/api/importacion/registrar-uno', {
        archivo: plantilla,
        indice,
        idAlmacen: esc.idAlmacen,
        ...extra,
      });

    esperarStatus(
      await uno(2, {
        lineas: [
          { orden: 1, tipo: 'producto', idProducto: idAceite },
          { orden: 2, tipo: 'servicio', codigoCuenta: '6371' },
        ],
      }),
      200,
    );
    expect(await stockActual(api(), invAceite)).toBe(24);

    esperarStatus(await uno(3, { sinDetalle: true }), 200);

    esperarStatus(
      await uno(4, {
        lineas: [{ orden: 1, tipo: 'producto', idProducto: idAceite }],
      }),
      200,
    );
    expect(await stockActual(api(), invAceite)).toBe(12);
  });
});
