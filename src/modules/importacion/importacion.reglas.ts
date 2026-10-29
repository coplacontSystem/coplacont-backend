import type { CpeLinea } from './cpe/cpe.types';

/** Minúsculas, sin tildes ni signos, espacios simples */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Clave con la que se recuerda una línea: el código del emisor o su descripción */
export function claveLinea(
  l: Pick<CpeLinea, 'codigoVendedor' | 'descripcion'>,
) {
  return l.codigoVendedor
    ? `C:${l.codigoVendedor.trim().toUpperCase()}`
    : `D:${normalizar(l.descripcion).slice(0, 255)}`;
}

const VACIAS = new Set(['de', 'la', 'el', 'x', 'y', 'con', 'en', 'para']);

const palabras = (t: string) =>
  new Set(
    normalizar(t)
      .split(' ')
      .filter((p) => p.length > 1 && !VACIAS.has(p)),
  );

/** Parecido entre dos nombres de 0 a 1 (Dice sobre palabras) */
export function parecido(a: string, b: string): number {
  const x = palabras(a);
  const y = palabras(b);
  if (!x.size || !y.size) return 0;
  let comunes = 0;
  for (const p of x) if (y.has(p)) comunes++;
  return (2 * comunes) / (x.size + y.size);
}

/** Desde este parecido se sugiere el producto (el usuario lo confirma) */
export const PARECIDO_MINIMO = 0.5;

/** Diferencia aceptada entre el total del XML y la suma de sus líneas */
export const TOLERANCIA_TOTAL = 0.05;

export const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Separa un nombre de persona natural. SUNAT y RENIEC suelen escribir
 * "APELLIDO_P APELLIDO_M NOMBRES"; si no hay tres palabras se completa con '-'.
 */
export function separarNombre(completo: string) {
  const p = completo.trim().split(/\s+/).filter(Boolean);
  if (p.length < 3) {
    return {
      apellidoPaterno: p[0] ?? '-',
      apellidoMaterno: '-',
      nombre: p[1] ?? '-',
    };
  }
  return {
    apellidoPaterno: p[0],
    apellidoMaterno: p[1],
    nombre: p.slice(2).join(' '),
  };
}
