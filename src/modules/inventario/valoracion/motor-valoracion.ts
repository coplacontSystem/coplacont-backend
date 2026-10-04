import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';

/**
 * Motor único de valoración de inventario.
 *
 * Función pura (sin base de datos): recibe los movimientos de UN inventario y
 * devuelve, línea por línea, el costo de cada entrada/salida y el saldo. La usan
 * el registro de salidas, el kardex y el Estado de Costo de Ventas, así que el
 * costo guardado en una venta y el que muestran los reportes siempre coinciden.
 *
 * Reglas:
 * - Orden: por día; dentro del mismo día primero las entradas y luego las
 *   salidas; a igualdad, por orden de registro.
 * - Entradas: crean un lote a su costo. Una devolución de venta (nota de crédito)
 *   entra al costo con que salió la venta original (`costoDeSalidas`).
 * - Salidas: los lotes físicos se consumen siempre por FIFO (trazabilidad).
 *   El costo depende del método: FIFO = costo de los lotes consumidos;
 *   PROMEDIO = promedio ponderado móvil del saldo.
 * - Si una salida supera el saldo se consume lo disponible y se informa el
 *   `faltante`; el saldo no queda negativo.
 */

export type TipoValorizable = 'ENTRADA' | 'SALIDA';

export interface MovimientoValorizable {
  /** Id del detalle de movimiento (o uno provisional para salidas por registrar). */
  id: number;
  fecha: Date;
  tipo: TipoValorizable;
  cantidad: number;
  /** Entradas: lote que crea (o al que suma). */
  idLote?: number | null;
  /** Entradas: costo unitario en soles. */
  costoUnitario?: number;
  /** Entradas: ids de las salidas cuyo costo hereda (devolución de una venta). */
  costoDeSalidas?: number[];
}

export interface ConsumoLote {
  idLote: number;
  cantidad: number;
  costoUnitario: number;
}

export interface LineaValorizada {
  id: number;
  fecha: Date;
  tipo: TipoValorizable;
  cantidad: number;
  costoUnitario: number;
  costoTotal: number;
  /** Lotes consumidos por una salida (FIFO físico). */
  consumos: ConsumoLote[];
  /** Cantidad que la salida no pudo cubrir con el saldo disponible. */
  faltante: number;
  saldoCantidad: number;
  saldoValor: number;
  saldoCostoUnitario: number;
}

export interface LoteEnSaldo {
  idLote: number;
  cantidad: number;
  costoUnitario: number;
  /** Para el orden FIFO. */
  orden: number;
}

export interface SaldoValorizado {
  cantidad: number;
  valor: number;
  lotes: LoteEnSaldo[];
}

export interface ResultadoValoracion {
  lineas: LineaValorizada[];
  saldoFinal: SaldoValorizado;
}

/** Cantidades por debajo de esto se consideran cero. */
export const EPSILON = 1e-9;

export const saldoVacio = (): SaldoValorizado => ({
  cantidad: 0,
  valor: 0,
  lotes: [],
});

/** Día calendario de una fecha contable (las fechas contables están en UTC). */
export const diaDe = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Orden contable de los movimientos (ver reglas arriba). No modifica la lista. */
export function ordenarMovimientos<T extends MovimientoValorizable>(
  movimientos: T[],
): T[] {
  return movimientos
    .map((m, i) => ({ m, i, dia: diaDe(m.fecha) }))
    .sort((a, b) => {
      if (a.dia !== b.dia) return a.dia < b.dia ? -1 : 1;
      if (a.m.tipo !== b.m.tipo) return a.m.tipo === 'ENTRADA' ? -1 : 1;
      if (a.m.id !== b.m.id) return a.m.id - b.m.id;
      return a.i - b.i;
    })
    .map((x) => x.m);
}

/** Método fijo, o según la fecha (cada período contable guarda el suyo). */
export type MetodoSegunFecha =
  | MetodoValoracion
  | ((fecha: Date) => MetodoValoracion);

/** Costo de salidas anteriores al tramo valorizado (para devoluciones). */
export type CostosDeSalidas = Map<number, { cantidad: number; costo: number }>;

/**
 * Valoriza los movimientos (ya ordenados con `ordenarMovimientos`) a partir de
 * un saldo inicial. No modifica el saldo recibido.
 */
export function valorizar(
  movimientos: MovimientoValorizable[],
  metodo: MetodoSegunFecha,
  saldoInicial: SaldoValorizado = saldoVacio(),
  costosConocidos?: CostosDeSalidas,
): ResultadoValoracion {
  let cantidad = saldoInicial.cantidad;
  let valor = saldoInicial.valor;
  const lotes = saldoInicial.lotes.map((l) => ({ ...l }));
  let siguienteOrden = lotes.reduce((max, l) => Math.max(max, l.orden), 0) + 1;
  const costoPorSalida: CostosDeSalidas = new Map(costosConocidos);
  const metodoDe = (fecha: Date) =>
    typeof metodo === 'function' ? metodo(fecha) : metodo;
  const lineas: LineaValorizada[] = [];

  for (const mov of movimientos) {
    const cant = Number(mov.cantidad);
    let costoUnitario: number;
    let costoTotal: number;
    let consumos: ConsumoLote[] = [];
    let faltante = 0;

    if (mov.tipo === 'ENTRADA') {
      costoUnitario = costoEntrada(mov, costoPorSalida);
      costoTotal = cant * costoUnitario;
      const idLote = mov.idLote ?? -mov.id;
      const existente = lotes.find((l) => l.idLote === idLote);
      if (existente && existente.costoUnitario === costoUnitario) {
        existente.cantidad += cant;
      } else {
        lotes.push({
          idLote,
          cantidad: cant,
          costoUnitario,
          orden: siguienteOrden++,
        });
      }
      cantidad += cant;
      valor += costoTotal;
    } else {
      const disponible = Math.min(cant, Math.max(0, cantidad));
      faltante = cant - disponible > EPSILON ? cant - disponible : 0;
      consumos = consumirFIFO(lotes, disponible);
      const costoLotes = consumos.reduce(
        (s, c) => s + c.cantidad * c.costoUnitario,
        0,
      );

      if (metodoDe(mov.fecha) === MetodoValoracion.PROMEDIO) {
        const promedio = cantidad > EPSILON ? valor / cantidad : 0;
        costoUnitario = promedio;
        costoTotal = disponible * promedio;
      } else {
        costoTotal = costoLotes;
        costoUnitario = disponible > EPSILON ? costoLotes / disponible : 0;
      }
      cantidad -= disponible;
      valor -= costoTotal;
      costoPorSalida.set(mov.id, { cantidad: disponible, costo: costoTotal });
    }

    // Sin existencias no queda valor (evita céntimos sueltos por redondeo)
    if (cantidad <= EPSILON) {
      cantidad = 0;
      valor = 0;
    }

    lineas.push({
      id: mov.id,
      fecha: mov.fecha,
      tipo: mov.tipo,
      cantidad: cant,
      costoUnitario,
      costoTotal,
      consumos,
      faltante,
      saldoCantidad: cantidad,
      saldoValor: valor,
      saldoCostoUnitario: cantidad > EPSILON ? valor / cantidad : 0,
    });
  }

  return {
    lineas,
    saldoFinal: {
      cantidad,
      valor,
      lotes: lotes.filter((l) => l.cantidad > EPSILON),
    },
  };
}

/** Costo de una entrada: el propio, o el de las salidas que devuelve. */
function costoEntrada(
  mov: MovimientoValorizable,
  costoPorSalida: Map<number, { cantidad: number; costo: number }>,
): number {
  if (mov.costoDeSalidas?.length) {
    let cant = 0;
    let costo = 0;
    for (const id of mov.costoDeSalidas) {
      const s = costoPorSalida.get(id);
      if (s) {
        cant += s.cantidad;
        costo += s.costo;
      }
    }
    if (cant > EPSILON) return costo / cant;
  }
  return Number(mov.costoUnitario) || 0;
}

/** Descuenta `cantidad` de los lotes más antiguos y devuelve lo consumido. */
function consumirFIFO(lotes: LoteEnSaldo[], cantidad: number): ConsumoLote[] {
  const consumos: ConsumoLote[] = [];
  let restante = cantidad;
  lotes.sort((a, b) => a.orden - b.orden);
  for (const lote of lotes) {
    if (restante <= EPSILON) break;
    if (lote.cantidad <= EPSILON) continue;
    const usar = Math.min(restante, lote.cantidad);
    lote.cantidad -= usar;
    restante -= usar;
    consumos.push({
      idLote: lote.idLote,
      cantidad: usar,
      costoUnitario: lote.costoUnitario,
    });
  }
  return consumos;
}
