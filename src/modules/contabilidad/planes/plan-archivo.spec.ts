import { planesIncluidos, validarPlan, PlanArchivo } from './plan-archivo';

describe('Planes de cuentas incluidos', () => {
  const planes = planesIncluidos();

  it('incluye el PCGE 2019 (por defecto) y el PCGE 2026', () => {
    expect(
      planes.map((p) => [p.codigo, p.cuentas.length, p.porDefecto]),
    ).toEqual([
      ['PCGE2019', 1772, true],
      ['PCGE2026', 1628, false],
    ]);
  });

  it.each(planes.map((p) => [p.codigo, p]))('%s es válido', (_c, p) => {
    expect(validarPlan(p as PlanArchivo)).toEqual([]);
  });

  it('el PCGE 2026 trae la errata corregida y las cuentas sugeridas', () => {
    const p = planes.find((x) => x.codigo === 'PCGE2026')!;
    const cuentas = new Map(p.cuentas);
    expect(cuentas.get('70902')).toBe('Relacionadas');
    expect(cuentas.get('70992')).toBe('Contrato de consultoría TI');
    expect(p.cuentasSugeridas.devolucionVentas).toBe('70911');
    expect(cuentas.has('94')).toBe(false);
  });

  it('detecta errores en un plan importado', () => {
    const malo: PlanArchivo = {
      codigo: 'X',
      nombre: 'Prueba',
      norma: '',
      codigoSunat: '1',
      vigenteDesde: '2030-01-01',
      porDefecto: false,
      elementos: {},
      cuentasSugeridas: { igv: '40111' },
      cuentas: [
        ['10', 'Caja'],
        ['101', 'Caja'],
        ['101', 'Repetida'],
        ['2011', 'Sin padre'],
        ['1A', 'Mala'],
      ],
    };
    expect(validarPlan(malo)).toEqual(
      expect.arrayContaining([
        'El código SUNAT (Tabla 17) debe tener 2 dígitos',
        'Código repetido: 101',
        'La cuenta 2011 no tiene cuenta padre',
        'Código inválido: "1A"',
        'La cuenta sugerida para "igv" (40111) no existe en el plan',
      ]),
    );
  });
});
