import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';
import {
  MovimientoValorizable,
  ordenarMovimientos,
  valorizar,
} from './motor-valoracion';

const { FIFO, PROMEDIO } = MetodoValoracion;

let siguienteId = 1;
const dia = (d: string) => new Date(`${d}T12:00:00Z`);
const entrada = (
  fecha: string,
  cantidad: number,
  costoUnitario: number,
  extra: Partial<MovimientoValorizable> = {},
): MovimientoValorizable => {
  const id = siguienteId++;
  return {
    id,
    fecha: dia(fecha),
    tipo: 'ENTRADA',
    cantidad,
    costoUnitario,
    idLote: id,
    ...extra,
  };
};
const salida = (fecha: string, cantidad: number): MovimientoValorizable => ({
  id: siguienteId++,
  fecha: dia(fecha),
  tipo: 'SALIDA',
  cantidad,
});

/** [tipo, cantidad, costo unitario, costo total, saldo cantidad, saldo valor] */
const resumen = (movs: MovimientoValorizable[], metodo: MetodoValoracion) =>
  valorizar(ordenarMovimientos(movs), metodo).lineas.map((l) => [
    l.tipo,
    l.cantidad,
    round(l.costoUnitario),
    round(l.costoTotal),
    round(l.saldoCantidad),
    round(l.saldoValor),
  ]);
const round = (n: number) => Math.round(n * 1e6) / 1e6;

describe('motor de valoración', () => {
  // Escenario base del e2e: 10 × 10, 10 × 20, venta de 15
  const base = () => [
    entrada('2026-03-02', 10, 10),
    entrada('2026-03-05', 10, 20),
    salida('2026-03-10', 15),
  ];

  it('FIFO: la salida cuesta lo que costaron los lotes más antiguos', () => {
    expect(resumen(base(), FIFO)).toEqual([
      ['ENTRADA', 10, 10, 100, 10, 100],
      ['ENTRADA', 10, 20, 200, 20, 300],
      ['SALIDA', 15, 13.333333, 200, 5, 100],
    ]);
  });

  it('PROMEDIO: la salida cuesta el promedio ponderado del saldo', () => {
    expect(resumen(base(), PROMEDIO)).toEqual([
      ['ENTRADA', 10, 10, 100, 10, 100],
      ['ENTRADA', 10, 20, 200, 20, 300],
      ['SALIDA', 15, 15, 225, 5, 75],
    ]);
  });

  it('PROMEDIO: el promedio se mueve con cada entrada', () => {
    const movs = [
      entrada('2026-01-01', 10, 10),
      salida('2026-01-02', 5), // 5 × 10
      entrada('2026-01-03', 5, 22), // saldo 10 u, valor 160
      salida('2026-01-04', 10), // 10 × 16
    ];
    expect(resumen(movs, PROMEDIO).map((l) => l.slice(2, 4))).toEqual([
      [10, 100],
      [10, 50],
      [22, 110],
      [16, 160],
    ]);
  });

  it('los lotes físicos se consumen por FIFO aunque el costo sea promedio', () => {
    const r = valorizar(ordenarMovimientos(base()), PROMEDIO);
    const venta = r.lineas[2];
    expect(venta.consumos.map((c) => [c.cantidad, c.costoUnitario])).toEqual([
      [10, 10],
      [5, 20],
    ]);
    expect(
      r.saldoFinal.lotes.map((l) => [l.cantidad, l.costoUnitario]),
    ).toEqual([[5, 20]]);
  });

  it('una compra con fecha anterior se ordena por fecha', () => {
    const movs = [entrada('2026-04-10', 5, 30), entrada('2026-04-01', 5, 10)];
    expect(resumen(movs, FIFO).map((l) => l[2])).toEqual([10, 30]);
  });

  it('una salida retroactiva consume los lotes que había en su fecha', () => {
    const movs = [
      entrada('2026-05-01', 10, 10),
      entrada('2026-05-10', 10, 20),
      salida('2026-05-20', 8),
      salida('2026-05-05', 5), // registrada después, con fecha anterior
    ];
    const r = valorizar(ordenarMovimientos(movs), FIFO);
    expect(r.lineas.map((l) => [l.tipo, round(l.costoTotal)])).toEqual([
      ['ENTRADA', 100],
      ['SALIDA', 50], // la retroactiva toma el lote de S/ 10
      ['ENTRADA', 200],
      ['SALIDA', 50 + 60], // 5 × 10 + 3 × 20
    ]);
  });

  it('en el mismo día las entradas van antes que las salidas', () => {
    const movs = [salida('2026-06-01', 4), entrada('2026-06-01', 10, 7)];
    const r = valorizar(ordenarMovimientos(movs), FIFO);
    expect(r.lineas.map((l) => l.tipo)).toEqual(['ENTRADA', 'SALIDA']);
    expect(r.lineas[1].faltante).toBe(0);
  });

  it('informa el faltante sin dejar el saldo negativo', () => {
    const movs = [entrada('2026-01-01', 3, 10), salida('2026-01-02', 5)];
    const venta = valorizar(ordenarMovimientos(movs), FIFO).lineas[1];
    expect(venta.faltante).toBe(2);
    expect(venta.saldoCantidad).toBe(0);
    expect(venta.costoTotal).toBe(30);
  });

  it('una devolución de venta entra al costo con que salió', () => {
    const venta = salida('2026-03-10', 15);
    const devolucion = entrada('2026-03-12', 3, 30 /* precio de venta */, {
      costoDeSalidas: [venta.id],
    });
    const movs = [...base().slice(0, 2), venta, devolucion];
    expect(resumen(movs, PROMEDIO)[3]).toEqual(['ENTRADA', 3, 15, 45, 8, 120]);
    expect(resumen(movs, FIFO)[3].slice(2, 4)).toEqual([
      round(200 / 15),
      round(3 * (200 / 15)),
    ]);
  });

  it('acepta cantidades decimales', () => {
    const movs = [entrada('2026-01-01', 2.5, 4), salida('2026-01-02', 1.25)];
    expect(resumen(movs, PROMEDIO)[1]).toEqual(['SALIDA', 1.25, 4, 5, 1.25, 5]);
  });

  it('con saldo cero no quedan céntimos sueltos', () => {
    const movs = [
      entrada('2026-01-01', 3, 10),
      entrada('2026-01-02', 3, 10.01),
      salida('2026-01-03', 1),
      salida('2026-01-04', 5),
    ];
    const ultima = valorizar(ordenarMovimientos(movs), PROMEDIO).lineas[3];
    expect(ultima.saldoCantidad).toBe(0);
    expect(ultima.saldoValor).toBe(0);
  });

  it('parte de un saldo inicial sin modificarlo', () => {
    const saldo = {
      cantidad: 4,
      valor: 40,
      lotes: [{ idLote: 99, cantidad: 4, costoUnitario: 10, orden: 1 }],
    };
    const r = valorizar([salida('2026-02-01', 1)], FIFO, saldo);
    expect(r.lineas[0].consumos[0]).toEqual({
      idLote: 99,
      cantidad: 1,
      costoUnitario: 10,
    });
    expect(saldo.lotes[0].cantidad).toBe(4);
  });

  it('aplica el método de cada período según la fecha', () => {
    // 2025 con FIFO, 2026 con PROMEDIO
    const metodo = (fecha: Date) =>
      fecha.getUTCFullYear() === 2025 ? FIFO : PROMEDIO;
    const movs = [
      entrada('2025-12-01', 10, 10),
      entrada('2025-12-02', 10, 20),
      salida('2025-12-03', 5), // FIFO: 5 × 10
      salida('2026-01-03', 5), // PROMEDIO: saldo 15 u, valor 250
    ];
    const r = valorizar(ordenarMovimientos(movs), metodo);
    expect(round(r.lineas[2].costoUnitario)).toBe(10);
    expect(round(r.lineas[3].costoUnitario)).toBe(round(250 / 15));
  });

  it('usa el costo conocido de una salida anterior al tramo', () => {
    const devolucion = entrada('2026-03-12', 2, 30, { costoDeSalidas: [999] });
    const r = valorizar(
      [devolucion],
      PROMEDIO,
      undefined,
      new Map([[999, { cantidad: 4, costo: 44 }]]),
    );
    expect(r.lineas[0].costoUnitario).toBe(11);
  });
});
