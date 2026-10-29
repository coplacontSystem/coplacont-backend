/** Pesos del dígito verificador del RUC (módulo 11). */
const PESOS_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const PREFIJOS_RUC = ['10', '15', '16', '17', '20'];

export type TipoDocumentoIdentidad = 'RUC' | 'DNI';

/** RUC de 11 dígitos con prefijo y dígito verificador correctos. */
export function rucValido(ruc: string): boolean {
  if (!/^\d{11}$/.test(ruc) || !PREFIJOS_RUC.includes(ruc.slice(0, 2))) {
    return false;
  }
  const suma = PESOS_RUC.reduce((s, p, i) => s + p * Number(ruc[i]), 0);
  const digito = (11 - (suma % 11)) % 10;
  return digito === Number(ruc[10]);
}

export function dniValido(dni: string): boolean {
  return /^\d{8}$/.test(dni);
}

/** Tipo del número, o el motivo por el que no es válido. */
export function tipoDocumento(
  numero: string,
): { tipo: TipoDocumentoIdentidad } | { error: string } {
  if (/^\d{8}$/.test(numero)) return { tipo: 'DNI' };
  if (/^\d{11}$/.test(numero)) {
    return rucValido(numero)
      ? { tipo: 'RUC' }
      : { error: `El RUC ${numero} no es válido (dígito verificador)` };
  }
  return { error: 'El documento debe tener 8 dígitos (DNI) u 11 (RUC)' };
}
