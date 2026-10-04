import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface CostoVentaMensualData {
  mes: number;
  comprasTotales: number;
  salidasTotales: number;
  inventarioFinal: number;
}

export interface CostoVentaFiltros {
  año: number;
  /** Empresa dueña de los datos (obligatorio: nunca mezclar empresas) */
  personaId: number;
  idAlmacen?: number;
  idProducto?: number;
}

export interface CostoVentaPorInventarioData {
  idInventario: number;
  nombreProducto: string;
  nombreAlmacen: string;
  entradas: number;
  salidas: number;
  inventarioFinal: number;
}

export interface CostoVentaPorInventarioFiltros {
  año: number;
  /** Empresa dueña de los datos (obligatorio: nunca mezclar empresas) */
  personaId: number;
  idAlmacen?: number;
  idProducto?: number;
}

@Injectable()
export class CostoVentaRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Movimientos de inventario de la empresa valorizados al costo (en soles):
   * entradas = cantidad × costo del lote; salidas = Σ cantidad × costo de los
   * lotes consumidos. Incluye lotes de inventario inicial sin movimientos.
   * Devuelve un CTE `mov(id_inventario, fecha, tipo, valor)` y sus parámetros.
   */
  private movimientosValorizados(filtros: {
    personaId: number;
    idAlmacen?: number;
    idProducto?: number;
  }): { cte: string; params: unknown[] } {
    const params: unknown[] = [filtros.personaId];
    let filtro = 'a.id_persona = $1';
    if (filtros.idAlmacen) {
      params.push(filtros.idAlmacen);
      filtro += ` AND a.id = $${params.length}`;
    }
    if (filtros.idProducto) {
      params.push(filtros.idProducto);
      filtro += ` AND i.id_producto = $${params.length}`;
    }
    const cte = `
      WITH mov AS (
        SELECT md.id_inventario, m.fecha, m.tipo::text AS tipo,
               CASE
                 WHEN m.tipo = 'ENTRADA' THEN md.cantidad * COALESCE(l."costoUnitario", 0)
                 WHEN m.tipo = 'SALIDA' THEN COALESCE((
                   SELECT SUM(ds.cantidad * ds.costo_unitario_de_lote)
                     FROM detalle_salidas ds
                    WHERE ds.id_movimiento_detalle = md.id), 0)
                 ELSE 0
               END AS valor
          FROM movimiento_detalles md
          JOIN movimientos m ON m.id = md.id_movimiento AND m.estado = 'PROCESADO'
          JOIN inventario i ON i.id = md.id_inventario
          JOIN almacen a ON a.id = i.id_almacen
          LEFT JOIN inventario_lote l ON l.id = md.id_lote
         WHERE ${filtro}
        UNION ALL
        SELECT l.id_inventario, l."fechaIngreso"::timestamp, 'ENTRADA',
               l."cantidadInicial" * l."costoUnitario"
          FROM inventario_lote l
          JOIN inventario i ON i.id = l.id_inventario
          JOIN almacen a ON a.id = i.id_almacen
         WHERE ${filtro} AND l."cantidadInicial" > 0
           AND NOT EXISTS (SELECT 1 FROM movimiento_detalles x WHERE x.id_lote = l.id)
      )`;
    return { cte, params };
  }

  /**
   * Compras (entradas) del año por mes, al costo
   */
  async getComprasMensuales(
    filtros: CostoVentaFiltros,
  ): Promise<{ mes: number; total: number }[]> {
    return this.totalesMensuales(filtros, 'ENTRADA');
  }

  /**
   * Salidas del año por mes, al costo de los lotes consumidos
   */
  async getSalidasMensuales(
    filtros: CostoVentaFiltros,
  ): Promise<{ mes: number; total: number }[]> {
    return this.totalesMensuales(filtros, 'SALIDA');
  }

  private async totalesMensuales(
    filtros: CostoVentaFiltros,
    tipo: 'ENTRADA' | 'SALIDA',
  ): Promise<{ mes: number; total: number }[]> {
    const { cte, params } = this.movimientosValorizados(filtros);
    const result: Array<{ mes: string | number; total: string | number }> =
      await this.dataSource.query(
        `${cte}
         SELECT EXTRACT(MONTH FROM fecha) AS mes, COALESCE(SUM(valor), 0) AS total
           FROM mov
          WHERE tipo = $${params.length + 1}
            AND EXTRACT(YEAR FROM fecha) = $${params.length + 2}
          GROUP BY 1
          ORDER BY 1`,
        [...params, tipo, filtros.año],
      );
    return result.map((row) => ({
      mes: parseInt(String(row.mes)),
      total: parseFloat(String(row.total)) || 0,
    }));
  }

  /**
   * Valor del inventario al cierre del mes (entradas − salidas acumuladas, al costo)
   */
  async getInventarioFinalMensual(
    filtros: CostoVentaFiltros,
    mes: number,
  ): Promise<number> {
    // Último instante del mes
    const fechaCorte = new Date(filtros.año, mes, 0, 23, 59, 59, 999);
    const { cte, params } = this.movimientosValorizados(filtros);
    const result: Array<{ total: string | number }> =
      await this.dataSource.query(
        `${cte}
       SELECT COALESCE(SUM(CASE WHEN tipo = 'SALIDA' THEN -valor ELSE valor END), 0) AS total
         FROM mov
        WHERE fecha <= $${params.length + 1}`,
        [...params, fechaCorte],
      );
    return parseFloat(String(result[0]?.total)) || 0;
  }

  /**
   * Obtiene información del almacén por ID
   */
  async getAlmacenInfo(idAlmacen: number): Promise<{ nombre: string } | null> {
    const sql = `SELECT nombre FROM almacen WHERE id = $1`;
    const result: Array<{ nombre: string }> = await this.dataSource.query(sql, [
      idAlmacen,
    ]);
    return result[0] || null;
  }

  /**
   * Obtiene información del producto por ID
   */
  async getProductoInfo(
    idProducto: number,
  ): Promise<{ nombre: string } | null> {
    const sql = `SELECT nombre FROM producto WHERE id = $1`;
    const result: Array<{ nombre: string }> = await this.dataSource.query(sql, [
      idProducto,
    ]);
    return result[0] || null;
  }

  /**
   * Obtiene los datos completos del reporte de costo de venta para un año
   */
  async getCostoVentaAnual(
    filtros: CostoVentaFiltros,
  ): Promise<CostoVentaMensualData[]> {
    const meses = Array.from({ length: 12 }, (_, i) => i + 1);
    const resultado: CostoVentaMensualData[] = [];

    // Obtener compras y salidas mensuales
    const comprasMensuales = await this.getComprasMensuales(filtros);
    const salidasMensuales = await this.getSalidasMensuales(filtros);

    // Crear mapa para acceso rápido
    const comprasMap = new Map(comprasMensuales.map((c) => [c.mes, c.total]));
    const salidasMap = new Map(salidasMensuales.map((s) => [s.mes, s.total]));

    // Calcular datos para cada mes
    for (const mes of meses) {
      const comprasTotales = comprasMap.get(mes) || 0;
      const salidasTotales = salidasMap.get(mes) || 0;
      const inventarioFinal = await this.getInventarioFinalMensual(
        filtros,
        mes,
      );

      resultado.push({
        mes,
        comprasTotales,
        salidasTotales,
        inventarioFinal,
      });
    }

    return resultado;
  }

  /**
   * Entradas del año por inventario, al costo
   */
  async getEntradasPorInventario(
    filtros: CostoVentaPorInventarioFiltros,
  ): Promise<{ idInventario: number; total: number }[]> {
    return this.totalesPorInventario(filtros, 'ENTRADA');
  }

  /**
   * Salidas del año por inventario, al costo de los lotes consumidos
   */
  async getSalidasPorInventario(
    filtros: CostoVentaPorInventarioFiltros,
  ): Promise<{ idInventario: number; total: number }[]> {
    return this.totalesPorInventario(filtros, 'SALIDA');
  }

  private async totalesPorInventario(
    filtros: CostoVentaPorInventarioFiltros,
    tipo: 'ENTRADA' | 'SALIDA',
  ): Promise<{ idInventario: number; total: number }[]> {
    const { cte, params } = this.movimientosValorizados(filtros);
    const result: Array<{
      idInventario: string | number;
      total: string | number;
    }> = await this.dataSource.query(
      `${cte}
       SELECT id_inventario AS "idInventario", COALESCE(SUM(valor), 0) AS total
         FROM mov
        WHERE tipo = $${params.length + 1}
          AND EXTRACT(YEAR FROM fecha) = $${params.length + 2}
        GROUP BY 1`,
      [...params, tipo, filtros.año],
    );
    return result.map((row) => ({
      idInventario: parseInt(String(row.idInventario)),
      total: parseFloat(String(row.total)) || 0,
    }));
  }

  /**
   * Valor del inventario al cierre del año por inventario (al costo)
   */
  async getInventarioFinalPorInventario(
    filtros: CostoVentaPorInventarioFiltros,
  ): Promise<{ idInventario: number; total: number }[]> {
    const fechaCorte = new Date(filtros.año, 11, 31, 23, 59, 59, 999);
    const { cte, params } = this.movimientosValorizados(filtros);
    const result: Array<{
      idInventario: string | number;
      total: string | number;
    }> = await this.dataSource.query(
      `${cte}
         SELECT id_inventario AS "idInventario",
                COALESCE(SUM(CASE WHEN tipo = 'SALIDA' THEN -valor ELSE valor END), 0) AS total
           FROM mov
          WHERE fecha <= $${params.length + 1}
          GROUP BY 1`,
      [...params, fechaCorte],
    );
    return result.map((row) => ({
      idInventario: parseInt(String(row.idInventario)),
      total: parseFloat(String(row.total)) || 0,
    }));
  }

  /**
   * Obtiene información completa de inventarios (producto y almacén)
   */
  async getInventariosInfo(
    filtros: CostoVentaPorInventarioFiltros,
  ): Promise<
    { idInventario: number; nombreProducto: string; nombreAlmacen: string }[]
  > {
    let sql = `
      SELECT 
        i.id as "idInventario",
        p.nombre as "nombreProducto",
        a.nombre as "nombreAlmacen"
      FROM inventario i
      INNER JOIN producto p ON i.id_producto = p.id
      INNER JOIN almacen a ON i.id_almacen = a.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    sql += ` AND a.id_persona = $${paramIndex}`;
    params.push(filtros.personaId);
    paramIndex++;

    if (filtros.idAlmacen) {
      sql += ` AND i.id_almacen = $${paramIndex}`;
      params.push(filtros.idAlmacen);
      paramIndex++;
    }

    if (filtros.idProducto) {
      sql += ` AND i.id_producto = $${paramIndex}`;
      params.push(filtros.idProducto);
      paramIndex++;
    }

    sql += ` ORDER BY a.nombre, p.nombre`;

    const result: Array<{
      idInventario: string | number;
      nombreProducto: string;
      nombreAlmacen: string;
    }> = await this.dataSource.query(sql, params);
    return result.map((row) => ({
      idInventario: parseInt(String(row.idInventario)),
      nombreProducto: row.nombreProducto,
      nombreAlmacen: row.nombreAlmacen,
    }));
  }

  /**
   * Obtiene los datos completos del reporte de costo de venta por inventario para un año
   */
  async getCostoVentaPorInventario(
    filtros: CostoVentaPorInventarioFiltros,
  ): Promise<CostoVentaPorInventarioData[]> {
    // Obtener información de inventarios
    const inventariosInfo = await this.getInventariosInfo(filtros);

    if (inventariosInfo.length === 0) {
      return [];
    }

    // Obtener datos de entradas, salidas e inventario final
    const entradas = await this.getEntradasPorInventario(filtros);
    const salidas = await this.getSalidasPorInventario(filtros);
    const inventarioFinal = await this.getInventarioFinalPorInventario(filtros);

    // Crear mapas para acceso rápido
    const entradasMap = new Map(entradas.map((e) => [e.idInventario, e.total]));
    const salidasMap = new Map(salidas.map((s) => [s.idInventario, s.total]));
    const inventarioFinalMap = new Map(
      inventarioFinal.map((i) => [i.idInventario, i.total]),
    );

    // Combinar todos los datos
    const resultado: CostoVentaPorInventarioData[] = inventariosInfo.map(
      (info) => ({
        idInventario: info.idInventario,
        nombreProducto: info.nombreProducto,
        nombreAlmacen: info.nombreAlmacen,
        entradas: entradasMap.get(info.idInventario) || 0,
        salidas: salidasMap.get(info.idInventario) || 0,
        inventarioFinal: inventarioFinalMap.get(info.idInventario) || 0,
      }),
    );

    return resultado;
  }
}
