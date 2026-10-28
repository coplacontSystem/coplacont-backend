import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Un plan de cuentas es un dato, no código: vive en un archivo JSON (en
 * data/planes) o se importa. Un plan nuevo o una actualización no obliga a
 * cambiar el código fuente.
 */
export interface PlanArchivo {
  /** Identificador único, p. ej. 'PCGE2026' */
  codigo: string;
  nombre: string;
  norma: string;
  /** Tabla 17 de SUNAT (01 = PCGE) */
  codigoSunat: string;
  vigenteDesde: string;
  porDefecto: boolean;
  fuente?: string;
  nota?: string;
  /** Correcciones hechas al texto oficial */
  erratas?: string[];
  /** Nombre de cada elemento (primer dígito) */
  elementos: Record<string, string>;
  /** Cuenta sugerida para cada rol de los asientos automáticos */
  cuentasSugeridas: Record<string, string>;
  cuentas: [codigo: string, nombre: string][];
}

/**
 * Junto al código compilado (los copia nest-cli) o, si no están ahí (p. ej.
 * un "start:dev" iniciado antes de agregar el archivo), en src.
 */
export const DIRECTORIO_PLANES = [
  join(__dirname, '..', 'data', 'planes'),
  join(process.cwd(), 'src', 'modules', 'contabilidad', 'data', 'planes'),
].find((d) => existsSync(d))!;

/** Planes oficiales incluidos en el sistema */
export function planesIncluidos(): PlanArchivo[] {
  return readdirSync(DIRECTORIO_PLANES)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map(
      (f) =>
        JSON.parse(
          readFileSync(join(DIRECTORIO_PLANES, f), 'utf8'),
        ) as PlanArchivo,
    );
}

/**
 * Revisa que el plan sea consistente: códigos de 2 a 6 dígitos, sin
 * repetidos, con nombre, y cada cuenta con su cuenta padre (salvo las de 2
 * dígitos). Devuelve los problemas encontrados (vacío = válido).
 */
export function validarPlan(p: PlanArchivo): string[] {
  const errores: string[] = [];
  if (!p.codigo?.trim()) errores.push('Falta el código del plan');
  if (!p.nombre?.trim()) errores.push('Falta el nombre del plan');
  if (!/^\d{2}$/.test(p.codigoSunat ?? ''))
    errores.push('El código SUNAT (Tabla 17) debe tener 2 dígitos');
  if (!Array.isArray(p.cuentas) || !p.cuentas.length) {
    errores.push('El plan no tiene cuentas');
    return errores;
  }
  const vistos = new Set<string>();
  for (const [codigo, nombre] of p.cuentas) {
    if (!/^\d{2,6}$/.test(codigo)) {
      errores.push(`Código inválido: "${codigo}"`);
      continue;
    }
    if (vistos.has(codigo)) errores.push(`Código repetido: ${codigo}`);
    vistos.add(codigo);
    if (!nombre?.trim()) errores.push(`La cuenta ${codigo} no tiene nombre`);
  }
  for (const codigo of vistos) {
    if (codigo.length > 2 && !vistos.has(codigo.slice(0, -1))) {
      // Algunas cuentas saltan un nivel (p. ej. 6 dígitos bajo 4): basta un ancestro
      let ancestro = false;
      for (let n = codigo.length - 2; n >= 2 && !ancestro; n--) {
        ancestro = vistos.has(codigo.slice(0, n));
      }
      if (!ancestro) errores.push(`La cuenta ${codigo} no tiene cuenta padre`);
    }
  }
  for (const [rol, codigo] of Object.entries(p.cuentasSugeridas ?? {})) {
    if (!vistos.has(codigo)) {
      errores.push(
        `La cuenta sugerida para "${rol}" (${codigo}) no existe en el plan`,
      );
    }
  }
  return errores;
}
