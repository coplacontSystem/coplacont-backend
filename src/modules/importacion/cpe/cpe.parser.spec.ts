import { readFileSync } from 'fs';
import { join } from 'path';
import { CpeError, leerCpe } from './cpe.parser';

const ejemplo = (nombre: string) =>
  leerCpe(readFileSync(join(__dirname, 'ejemplos', `${nombre}.xml`)));

describe('leerCpe', () => {
  it('lee una factura de servicio en USD con detracción (ISO-8859-1)', () => {
    const d = ejemplo('factura-servicio-usd-detraccion');
    expect(d).toMatchObject({
      tipoComprobante: '01',
      serie: 'E001',
      numero: '236',
      fechaEmision: '2026-08-31',
      fechaVencimiento: '2026-09-04',
      moneda: 'USD',
      formaPago: 'credito',
      cuotas: [{ monto: 25400.52, vencimiento: '2026-09-04' }],
      detraccion: {
        codigo: '037',
        porcentaje: 12,
        monto: 11624.21,
        moneda: 'PEN',
      },
      guias: ['0003-000245'],
    });
    expect(d.emisor).toMatchObject({
      tipoDocumento: '6',
      numeroDocumento: '10456789012',
      razonSocial: 'PROVEEDOR NATURAL DE PRUEBA',
    });
    // Acentos de ISO-8859-1 bien decodificados
    expect(d.receptor.razonSocial).toBe('COMPAÑIA DE PRUEBA S.A.A');
    expect(d.totales).toMatchObject({
      gravada: 24461.21,
      igv: 4403.02,
      total: 28864.23,
    });
    expect(d.lineas).toHaveLength(1);
    expect(d.lineas[0]).toMatchObject({
      cantidad: 1,
      unidad: 'NIU',
      descripcion: 'SERVICIO DE ASESORIA TECNICA DE PRUEBA',
      codigoVendedor: null,
      subtotal: 24461.21,
      igv: 4403.02,
      afectacionIgv: '10',
      gratuita: false,
    });
    expect(d.lineas[0].precioUnitario).toBeCloseTo(28864.2278, 4);
  });

  it('lee una factura de mercaderías con línea exonerada y crédito', () => {
    const d = ejemplo('factura-mercaderias-pen');
    expect(d).toMatchObject({
      serie: 'F001',
      numero: '120',
      moneda: 'PEN',
      fechaVencimiento: '2026-06-09',
      formaPago: 'credito',
      detraccion: null,
    });
    expect(d.totales).toEqual({
      gravada: 950,
      exonerada: 89.4,
      inafecta: 0,
      gratuita: 0,
      igv: 171,
      isc: 0,
      otrosTributos: 0,
      total: 1210.4,
    });
    expect(
      d.lineas.map((l) => [
        l.codigoVendedor,
        l.cantidad,
        l.unidad,
        l.valorUnitario,
      ]),
    ).toEqual([
      ['ACE-12', 2, 'BX', 300],
      ['FID-500', 50, 'NIU', 7],
      ['PAP-01', 20, 'KGM', 4.47],
    ]);
    expect(d.lineas[0].codigoGtin).toBe('7751271011111');
    expect(d.lineas[2]).toMatchObject({ afectacionIgv: '20', igv: 0 });
    expect(d.receptor.razonSocial).toBe('COMPAÑÍA DE PRUEBA S.A.A');
  });

  it('lee una boleta con cliente DNI', () => {
    const d = ejemplo('boleta-venta-propia');
    expect(d.tipoComprobante).toBe('03');
    expect(d.receptor).toMatchObject({
      tipoDocumento: '1',
      numeroDocumento: '45678912',
    });
    expect(d.formaPago).toBeNull();
    expect(d.totales.total).toBe(118);
  });

  it('lee notas de crédito y débito con su referencia y motivo', () => {
    const nc = ejemplo('nota-credito-compra');
    expect(nc).toMatchObject({
      tipoComprobante: '07',
      serie: 'FC01',
      numero: '7',
      referencias: [{ serieNumero: 'F001-120', tipo: '01' }],
      motivo: { codigo: '07', descripcion: 'DEVOLUCION POR ITEM' },
    });
    expect(nc.lineas[0]).toMatchObject({
      cantidad: 1,
      unidad: 'BX',
      codigoVendedor: 'ACE-12',
    });

    const nd = ejemplo('nota-debito-compra');
    expect(nd).toMatchObject({
      tipoComprobante: '08',
      motivo: { codigo: '02' },
    });
    expect(nd.totales.total).toBe(59);
    expect(nd.lineas[0].codigoVendedor).toBeNull();
  });

  it('rechaza lo que no es un CPE', () => {
    expect(() => leerCpe('<Hola/>')).toThrow(CpeError);
    expect(() => leerCpe('no es xml <<')).toThrow(CpeError);
    expect(() =>
      leerCpe(
        '<Invoice><ID>F1-1</ID><InvoiceTypeCode>09</InvoiceTypeCode></Invoice>',
      ),
    ).toThrow(/no soportado/);
  });
});
