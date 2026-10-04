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
   * Obtiene los datos mensuales de compras para un año específico
   */
  async getComprasMensuales(
    filtros: CostoVentaFiltros,
  ): Promise<{ mes: number; total: number }[]> {
    let sql = `
      SELECT 
        EXTRACT(MONTH FROM c."fechaEmision") as mes,
        COALESCE(SUM(
          CASE 
            WHEN COALESCE(m.tipo, 'ENTRADA') = 'ENTRADA' 
            THEN cd.cantidad * cd."precioUnitario"
            ELSE 0
          END
        ), 0) as total
      FROM comprobante c
      INNER JOIN comprobante_detalle cd ON c."idComprobante" = cd.id_comprobante
      INNER JOIN inventario i ON cd.id_inventario = i.id
      INNER JOIN producto p ON i.id_producto = p.id
      INNER JOIN almacen a ON i.id_almacen = a.id
      LEFT JOIN movimientos m ON m.id_comprobante = c."idComprobante"
      LEFT JOIN movimiento_detalles md ON m.id = md.id_movimiento AND md.id_inventario = i.id
      WHERE EXTRACT(YEAR FROM c."fechaEmision") = $1
    `;

    const params: any[] = [filtros.año];
    let paramIndex = 2;

    sql += ` AND a.id_persona = $${paramIndex}`;
    params.push(filtros.personaId);
    paramIndex++;

    if (filtros.idAlmacen) {
      sql += ` AND a.id = $${paramIndex}`;
      params.push(filtros.idAlmacen);
      paramIndex++;
    }

    if (filtros.idProducto) {
      sql += ` AND p.id = $${paramIndex}`;
      params.push(filtros.idProducto);
      paramIndex++;
    }

    sql += `
      GROUP BY EXTRACT(MONTH FROM c."fechaEmision")
      ORDER BY mes
    `;

    const result: Array<{ mes: string | number; total: string | number }> =
      await this.dataSource.query(sql, params);
    return result.map((row) => ({
      mes: parseInt(String(row.mes)),
      total: parseFloat(String(row.total)) || 0,
    }));
  }

  /**
   * Obtiene los datos mensuales de salidas para un año específico
   */
  async getSalidasMensuales(
    filtros: CostoVentaFiltros,
  ): Promise<{ mes: number; total: number }[]> {
    let sql = `
      SELECT 
        EXTRACT(MONTH FROM c."fechaEmision") as mes,
        COALESCE(SUM(
          CASE 
            WHEN COALESCE(m.tipo, 'ENTRADA') = 'SALIDA' 
            THEN cd.cantidad * cd."precioUnitario"
            ELSE 0
          END
        ), 0) as total
      FROM comprobante c
      INNER JOIN comprobante_detalle cd ON c."idComprobante" = cd.id_comprobante
      INNER JOIN inventario i ON cd.id_inventario = i.id
      INNER JOIN producto p ON i.id_producto = p.id
      INNER JOIN almacen a ON i.id_almacen = a.id
      LEFT JOIN movimientos m ON m.id_comprobante = c."idComprobante"
      LEFT JOIN movimiento_detalles md ON m.id = md.id_movimiento AND md.id_inventario = i.id
      WHERE EXTRACT(YEAR FROM c."fechaEmision") = $1
        AND COALESCE(m.tipo, 'ENTRADA') = 'SALIDA'
    `;

    const params: any[] = [filtros.año];
    let paramIndex = 2;

    sql += ` AND a.id_persona = $${paramIndex}`;
    params.push(filtros.personaId);
    paramIndex++;

    if (filtros.idAlmacen) {
      sql += ` AND a.id = $${paramIndex}`;
      params.push(filtros.idAlmacen);
      paramIndex++;
    }

    if (filtros.idProducto) {
      sql += ` AND p.id = $${paramIndex}`;
      params.push(filtros.idProducto);
      paramIndex++;
    }

    sql += `
      GROUP BY EXTRACT(MONTH FROM c."fechaEmision")
      ORDER BY mes
    `;

    const result: Array<{ mes: string | number; total: string | number }> =
      await this.dataSource.query(sql, params);
    return result.map((row) => ({
      mes: parseInt(String(row.mes)),
      total: parseFloat(String(row.total)) || 0,
    }));
  }

  /**
   * Calcula el inventario final para un mes específico
   */
  async getInventarioFinalMensual(
    filtros: CostoVentaFiltros,
    mes: number,
  ): Promise<number> {
    // Fecha de corte: último día del mes
    const fechaCorte = new Date(filtros.año, mes, 0, 23, 59, 59, 999);

    let sql = `
      SELECT 
        COALESCE(SUM(
          CASE 
            WHEN COALESCE(m.tipo, 'ENTRADA') = 'ENTRADA' 
            THEN cd.cantidad * cd."precioUnitario"
            ELSE -cd.cantidad * cd."precioUnitario"
          END
        ), 0) as total
      FROM comprobante c
      INNER JOIN comprobante_detalle cd ON c."idComprobante" = cd.id_comprobante
      INNER JOIN inventario i ON cd.id_inventario = i.id
      INNER JOIN producto p ON i.id_producto = p.id
      INNER JOIN almacen a ON i.id_almacen = a.id
      LEFT JOIN movimientos m ON m.id_comprobante = c."idComprobante"
      LEFT JOIN movimiento_detalles md ON m.id = md.id_movimiento AND md.id_inventario = i.id
      WHERE c."fechaEmision" <= $1
    `;

    const params: any[] = [fechaCorte];
    let paramIndex = 2;

    sql += ` AND a.id_persona = $${paramIndex}`;
    params.push(filtros.personaId);
    paramIndex++;

    if (filtros.idAlmacen) {
      sql += ` AND a.id = $${paramIndex}`;
      params.push(filtros.idAlmacen);
      paramIndex++;
    }

    if (filtros.idProducto) {
      sql += ` AND p.id = $${paramIndex}`;
      params.push(filtros.idProducto);
      paramIndex++;
    }

    const result: Array<{ total: string | number }> =
      await this.dataSource.query(sql, params);
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
   * Obtiene los datos de entradas por inventario para un año específico
   */
  async getEntradasPorInventario(
    filtros: CostoVentaPorInventarioFiltros,
  ): Promise<{ idInventario: number; total: number }[]> {
    let sql = `
      SELECT 
        i.id as "idInventario",
        COALESCE(SUM(
          CASE 
            WHEN COALESCE(m.tipo, 'ENTRADA') = 'ENTRADA' 
            THEN cd.cantidad * cd."precioUnitario"
            ELSE 0
          END
        ), 0) as total
      FROM inventario i
      INNER JOIN producto p ON i.id_producto = p.id
      INNER JOIN almacen a ON i.id_almacen = a.id
      LEFT JOIN comprobante_detalle cd ON cd.id_inventario = i.id
      LEFT JOIN comprobante c ON c."idComprobante" = cd.id_comprobante
      LEFT JOIN movimientos m ON m.id_comprobante = c."idComprobante"
      WHERE (c."fechaEmision" IS NULL OR EXTRACT(YEAR FROM c."fechaEmision") = $1)
    `;

    const params: any[] = [filtros.año];
    let paramIndex = 2;

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

    sql += ` GROUP BY i.id ORDER BY i.id`;

    const result: Array<{
      idInventario: string | number;
      total: string | number;
    }> = await this.dataSource.query(sql, params);
    return result.map((row) => ({
      idInventario: parseInt(String(row.idInventario)),
      total: parseFloat(String(row.total)) || 0,
    }));
  }

  /**
   * Obtiene los datos de salidas por inventario para un año específico
   */
  async getSalidasPorInventario(
    filtros: CostoVentaPorInventarioFiltros,
  ): Promise<{ idInventario: number; total: number }[]> {
    let sql = `
      SELECT 
        i.id as "idInventario",
        COALESCE(SUM(
          CASE 
            WHEN COALESCE(m.tipo, 'ENTRADA') = 'SALIDA' 
            THEN cd.cantidad * cd."precioUnitario"
            ELSE 0
          END
        ), 0) as total
      FROM inventario i
      INNER JOIN producto p ON i.id_producto = p.id
      INNER JOIN almacen a ON i.id_almacen = a.id
      LEFT JOIN comprobante_detalle cd ON cd.id_inventario = i.id
      LEFT JOIN comprobante c ON c."idComprobante" = cd.id_comprobante
      LEFT JOIN movimientos m ON m.id_comprobante = c."idComprobante"
      WHERE (c."fechaEmision" IS NULL OR EXTRACT(YEAR FROM c."fechaEmision") = $1)
    `;

    const params: any[] = [filtros.año];
    let paramIndex = 2;

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

    sql += ` GROUP BY i.id ORDER BY i.id`;

    const result: Array<{
      idInventario: string | number;
      total: string | number;
    }> = await this.dataSource.query(sql, params);
    return result.map((row) => ({
      idInventario: parseInt(String(row.idInventario)),
      total: parseFloat(String(row.total)) || 0,
    }));
  }

  /**
   * Obtiene el inventario final por inventario para un año específico
   */
  async getInventarioFinalPorInventario(
    filtros: CostoVentaPorInventarioFiltros,
  ): Promise<{ idInventario: number; total: number }[]> {
    let sql = `
      SELECT 
        i.id as "idInventario",
        COALESCE(SUM(
          CASE 
            WHEN COALESCE(m.tipo, 'ENTRADA') = 'ENTRADA' 
            THEN cd.cantidad * cd."precioUnitario"
            WHEN m.tipo = 'SALIDA' 
            THEN -(cd.cantidad * cd."precioUnitario")
            ELSE 0
          END
        ), 0) as total
      FROM inventario i
      INNER JOIN producto p ON i.id_producto = p.id
      INNER JOIN almacen a ON i.id_almacen = a.id
      LEFT JOIN comprobante_detalle cd ON cd.id_inventario = i.id
      LEFT JOIN comprobante c ON c."idComprobante" = cd.id_comprobante
      LEFT JOIN movimientos m ON m.id_comprobante = c."idComprobante"
      LEFT JOIN movimiento_detalles md ON m.id = md.id_movimiento AND md.id_inventario = i.id
      WHERE (c."fechaEmision" IS NULL OR EXTRACT(YEAR FROM c."fechaEmision") <= $1)
    `;

    const params: any[] = [filtros.año];
    let paramIndex = 2;

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

    sql += ` GROUP BY i.id ORDER BY i.id`;

    const result: Array<{
      idInventario: string | number;
      total: string | number;
    }> = await this.dataSource.query(sql, params);
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
