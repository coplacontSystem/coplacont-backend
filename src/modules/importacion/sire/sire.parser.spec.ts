import { readFileSync } from 'fs';
import { join } from 'path';
import { leerSire, SireError } from './sire.parser';

const ejemplo = (nombre: string) =>
  leerSire(readFileSync(join(__dirname, 'ejemplos', `${nombre}.txt`)));

describe('leerSire', () => {
  it('lee la propuesta del Registro de Ventas (RVIE)', () => {
    const { libro, filas } = ejemplo('rvie-ventas');
    expect(libro).toBe('ventas');
    expect(filas).toHaveLength(5);

    const boleta = filas[0];
    if (!boleta.ok) throw new Error(boleta.error);
    expect(boleta.datos.rucTitular).toBe('20999888777');
    expect(boleta.datos.documento).toMatchObject({
      tipoComprobante: '03',
      serie: 'EB01',
      numero: '2052',
      fechaEmision: '2026-05-03',
      lineas: [],
      emisor: { numeroDocumento: '20999888777' },
      receptor: { numeroDocumento: '', razonSocial: 'VARIOS' },
      totales: { gravada: 255, igv: 45.9, total: 300.9 },
    });
    // Acentos del titular bien leídos
    expect(boleta.datos.documento.emisor.razonSocial).toBe(
      'COMPAÑÍA DE PRUEBA S.A.A',
    );

    const factura = filas[1];
    if (!factura.ok) throw new Error(factura.error);
    expect(factura.datos.documento).toMatchObject({
      receptor: { tipoDocumento: '6', numeroDocumento: '20100055237' },
      totales: { gravada: 1000, igv: 180, exonerada: 50, total: 1230 },
      fechaVencimiento: '2026-06-04',
    });

    const nota = filas[3];
    if (!nota.ok) throw new Error(nota.error);
    expect(nota.datos.documento).toMatchObject({
      tipoComprobante: '07',
      referencias: [{ serieNumero: 'F001-101', tipo: '01' }],
    });

    // Tickets (12) aún no se registran
    expect(filas[4]).toMatchObject({ ok: false, fila: 6 });
  });

  it('lee la propuesta del Registro de Compras (RCE)', () => {
    const { libro, filas } = ejemplo('rce-compras');
    expect(libro).toBe('compras');
    const [f1, f2] = filas;
    if (!f1.ok || !f2.ok) throw new Error('fila inválida');
    expect(f1.datos.documento).toMatchObject({
      serie: 'E001',
      numero: '458',
      emisor: { numeroDocumento: '20100055237' },
      receptor: { numeroDocumento: '20999888777' },
      totales: { gravada: 1525.42, igv: 274.58, total: 1800 },
    });
    expect(f2.datos).toMatchObject({
      tipoCambio: 3.75,
      documento: { moneda: 'USD', totales: { inafecta: 25, total: 143 } },
    });
  });

  it('rechaza un TXT que no es de SIRE', () => {
    expect(() => leerSire('a|b|c\n1|2|3')).toThrow(SireError);
  });
});
