import type { Naturaleza } from './entities/cuenta-contable.entity';

export const ELEMENTOS: Record<string, string> = {
  '0': 'Cuentas de orden',
  '1': 'Activo disponible y exigible',
  '2': 'Activo realizable',
  '3': 'Activo inmovilizado',
  '4': 'Pasivo',
  '5': 'Patrimonio',
  '6': 'Gastos por naturaleza',
  '7': 'Ingresos',
  '8': 'Saldos intermediarios de gestión y determinación del resultado',
  '9': 'Contabilidad analítica de explotación (costos y gastos por función)',
};

const D: Naturaleza = 'deudora';
const A: Naturaleza = 'acreedora';
const M: Naturaleza = 'mixta';

/** Naturaleza por elemento; las excepciones van en NATURALEZA_CUENTA */
const NATURALEZA_ELEMENTO: Record<string, Naturaleza> = {
  '1': D,
  '2': D,
  '3': D,
  '4': A,
  '5': A,
  '6': D,
  '7': A,
  '8': M,
  '9': D,
};

/**
 * Cuentas cuyo saldo normal no es el de su elemento: estimaciones y
 * depreciaciones (correctoras del activo), anticipos, variaciones de
 * inventario, descuentos concedidos, cuentas de orden y de resultado.
 * Gana el prefijo más largo.
 */
const NATURALEZA_CUENTA: Record<string, Naturaleza> = {
  '01': D,
  '02': D,
  '03': D,
  '04': A,
  '06': A,
  '07': A,
  '08': A,
  '09': D,
  '122': A,
  '132': A,
  '19': A,
  '29': A,
  '36': A,
  '39': A,
  '422': D,
  '432': D,
  '56': M,
  '59': M,
  '591': A,
  '592': D,
  '61': M,
  '71': M,
  '74': D,
  '88': D,
  '891': A,
  '892': D,
};

export function naturalezaDe(codigo: string): Naturaleza {
  for (let n = codigo.length; n >= 2; n--) {
    const regla = NATURALEZA_CUENTA[codigo.slice(0, n)];
    if (regla) return regla;
  }
  return NATURALEZA_ELEMENTO[codigo[0]] ?? M;
}

/** Nivel según la longitud del código: 2 dígitos = 1 (cuenta), 3 = 2 … */
export const nivelDe = (codigo: string) => Math.max(1, codigo.length - 1);
