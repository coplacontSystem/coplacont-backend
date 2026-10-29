import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface CcnuVista {
  codigo: string;
  nombre: string;
  nivel: number;
  codigoPadre: string | null;
}

type Fila = Record<string, unknown>;

const vista = (f: Fila): CcnuVista => ({
  codigo: String(f.codigo),
  nombre: String(f.nombre),
  nivel: Number(f.nivel),
  codigoPadre: (f.codigo_padre as string | null) ?? null,
});

/** Sin tildes y en minúsculas, para buscar "cafe" y encontrar "Café" */
const SIN_TILDES = `translate(lower(%s), 'áéíóúüñ', 'aeiouun')`;

@Injectable()
export class CatalogosService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Busca por código (prefijo) o por palabras del nombre. Sin texto, lista
   * los hijos de `padre` (o los segmentos). Por defecto solo productos y
   * clases, que son los que se asignan a un producto.
   */
  async buscarCcnu(
    q?: string,
    padre?: string,
    limite = 30,
  ): Promise<CcnuVista[]> {
    const texto = (q ?? '').trim();
    if (!texto) {
      const filas: Fila[] = await this.dataSource.query(
        `SELECT codigo, nombre, nivel, codigo_padre FROM catalogo_ccnu
          WHERE ${padre ? 'codigo_padre = $1' : 'nivel = 1'}
          ORDER BY codigo LIMIT 500`,
        padre ? [padre] : [],
      );
      return filas.map(vista);
    }
    if (/^\d+$/.test(texto)) {
      const filas: Fila[] = await this.dataSource.query(
        `SELECT codigo, nombre, nivel, codigo_padre FROM catalogo_ccnu
          WHERE codigo LIKE $1 AND nivel >= 3 ORDER BY codigo LIMIT $2`,
        [`${texto}%`, limite],
      );
      return filas.map(vista);
    }
    const palabras = texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/\s+/)
      .filter((p) => p.length > 1)
      .slice(0, 5);
    if (!palabras.length) return [];
    const condiciones = palabras
      .map((_, i) => `${SIN_TILDES.replace('%s', 'nombre')} LIKE $${i + 1}`)
      .join(' AND ');
    const filas: Fila[] = await this.dataSource.query(
      `SELECT codigo, nombre, nivel, codigo_padre FROM catalogo_ccnu
        WHERE nivel >= 3 AND ${condiciones}
        ORDER BY nivel DESC, length(nombre), codigo LIMIT $${palabras.length + 1}`,
      [...palabras.map((p) => `%${p}%`), limite],
    );
    return filas.map(vista);
  }

  /** Un código con su ruta (segmento › familia › clase) */
  async ccnu(codigo: string) {
    const filas: Fila[] = await this.dataSource.query(
      `WITH RECURSIVE ruta AS (
         SELECT codigo, nombre, nivel, codigo_padre FROM catalogo_ccnu WHERE codigo = $1
         UNION ALL
         SELECT c.codigo, c.nombre, c.nivel, c.codigo_padre
           FROM catalogo_ccnu c JOIN ruta r ON c.codigo = r.codigo_padre)
       SELECT * FROM ruta ORDER BY nivel`,
      [codigo],
    );
    if (!filas.length)
      throw new NotFoundException(`Código CCNU ${codigo} no existe`);
    const todos = filas.map(vista);
    return { ...todos[todos.length - 1], ruta: todos.slice(0, -1) };
  }

  /** Valida un código para asignarlo a un producto (clase o producto) */
  async validarCcnu(codigo: string) {
    const [f] = await this.dataSource.query(
      `SELECT nivel FROM catalogo_ccnu WHERE codigo = $1`,
      [codigo],
    );
    if (!f) {
      throw new BadRequestException(
        `El código SUNAT ${codigo} no está en el catálogo CCNU`,
      );
    }
    if (Number(f.nivel) < 3) {
      throw new BadRequestException(
        `El código SUNAT ${codigo} es un segmento o familia: elige una clase o un producto`,
      );
    }
  }
}
