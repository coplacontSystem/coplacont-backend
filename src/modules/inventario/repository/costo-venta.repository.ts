import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OPERACION } from 'src/common/catalogo.service';
import { diaDe } from '../valoracion/motor-valoracion';
import {
  InventarioValorizado,
  ValoracionService,
} from '../valoracion/valoracion.service';
import {
  KardexMaterializadoService,
  leerKardexMaterializado,
} from '../valoracion/kardex-materializado.service';

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
    private readonly valoracion: ValoracionService,
    private readonly kardex: KardexMaterializadoService,
  ) {}

  /**
   * Entradas y salidas al costo del año, agrupadas por `grupo` (mes o inventario),
   * leídas del kardex materializado. Opcionalmente sin transferencias.
   */
  private async totalesMaterializados(
    ids: number[],
    año: number,
    grupo: 'mes' | 'inventario',
    sinTransferencias: boolean,
  ): Promise<{ clave: number; tipo: string; total: number }[]> {
    await this.kardex.asegurarAlDia(ids);
    const filas: { clave: string; tipo: string; total: string }[] =
      await this.dataSource.manager.query(
        `SELECT ${grupo === 'mes' ? 'EXTRACT(MONTH FROM k.dia)' : 'k.id_inventario'} AS clave,
                k.tipo, SUM(k.costo_total) AS total
           FROM kardex_linea k
           LEFT JOIN movimiento_detalles md ON md.id = k.id_movimiento_detalle
           LEFT JOIN movimientos m ON m.id = md.id_movimiento
           LEFT JOIN comprobante c ON c."idComprobante" = m.id_comprobante
           LEFT JOIN tabla_detalle t ON t."idTablaDetalle" = c.id_tipo_operacion
          WHERE k.id_inventario = ANY($1)
            AND k.dia BETWEEN make_date($2, 1, 1) AND make_date($2, 12, 31)
            AND (NOT $3 OR COALESCE(t.codigo, m."codigoTabla12", '') <> ALL($4))
          GROUP BY 1, 2`,
        [
          ids,
          año,
          sinTransferencias,
          [OPERACION.TRANSFERENCIA_INGRESO, OPERACION.TRANSFERENCIA_SALIDA],
        ],
      );
    return filas.map((f) => ({
      clave: Number(f.clave),
      tipo: f.tipo,
      total: Number(f.total) || 0,
    }));
  }

  /**
   * Valor del inventario al cierre de cada mes indicado (saldo de la última
   * línea del kardex hasta ese día), por inventario.
   */
  private async valoresAlCierre(
    ids: number[],
    año: number,
    meses: number[],
  ): Promise<{ mes: number; idInventario: number; valor: number }[]> {
    await this.kardex.asegurarAlDia(ids);
    const filas: { mes: number; id: string; valor: string | null }[] =
      await this.dataSource.manager.query(
        `SELECT mes, inv.id, u.saldo_valor AS valor
           FROM unnest($3::int[]) AS mes
          CROSS JOIN unnest($1::bigint[]) AS inv(id)
           LEFT JOIN LATERAL (
             SELECT k.saldo_valor FROM kardex_linea k
              WHERE k.id_inventario = inv.id
                AND k.dia <= (make_date($2, mes, 1) + interval '1 month - 1 day')::date
              ORDER BY k.dia DESC, k.orden DESC LIMIT 1) u ON true`,
        [ids, año, meses],
      );
    return filas.map((f) => ({
      mes: Number(f.mes),
      idInventario: Number(f.id),
      valor: Number(f.valor) || 0,
    }));
  }

  /**
   * Inventarios de la empresa (con filtros) valorizados desde cero por el motor
   * único (KARDEX_MATERIALIZADO=false): los importes son los mismos del kardex.
   */
  private async valorizados(filtros: CostoVentaFiltros): Promise<{
    inventarios: Awaited<
      ReturnType<CostoVentaRepository['getInventariosInfo']>
    >;
    valorizados: Map<number, InventarioValorizado>;
  }> {
    const inventarios = await this.getInventariosInfo(filtros);
    const valorizados = await this.valoracion.valorizarInventarios(
      inventarios.map((i) => i.idInventario),
    );
    return { inventarios, valorizados };
  }

  /** Valor del inventario al final del día `dia` ('YYYY-MM-DD'). */
  private static valorAl(inv: InventarioValorizado, dia: string): number {
    let valor = 0;
    for (const linea of inv.resultado.lineas) {
      if (diaDe(linea.fecha) > dia) break;
      valor = linea.saldoValor;
    }
    return valor;
  }

  private static esTransferencia(codigoOperacion: string | null): boolean {
    return (
      codigoOperacion === OPERACION.TRANSFERENCIA_INGRESO ||
      codigoOperacion === OPERACION.TRANSFERENCIA_SALIDA
    );
  }

  /**
   * Compras (entradas), salidas al costo e inventario final de cada mes del año.
   * Sin filtro de almacén se excluyen las transferencias entre almacenes: para la
   * empresa no son compras ni costo de ventas (la salida y la entrada se anulan).
   */
  async getCostoVentaAnual(
    filtros: CostoVentaFiltros,
  ): Promise<CostoVentaMensualData[]> {
    const resultado: CostoVentaMensualData[] = Array.from(
      { length: 12 },
      (_, i) => ({
        mes: i + 1,
        comprasTotales: 0,
        salidasTotales: 0,
        inventarioFinal: 0,
      }),
    );

    if (leerKardexMaterializado()) {
      const ids = (await this.getInventariosInfo(filtros)).map(
        (i) => i.idInventario,
      );
      if (ids.length === 0) return resultado;
      for (const t of await this.totalesMaterializados(
        ids,
        filtros.año,
        'mes',
        !filtros.idAlmacen,
      )) {
        const mes = resultado[t.clave - 1];
        if (t.tipo === 'ENTRADA') mes.comprasTotales += t.total;
        else mes.salidasTotales += t.total;
      }
      for (const v of await this.valoresAlCierre(
        ids,
        filtros.año,
        resultado.map((m) => m.mes),
      )) {
        resultado[v.mes - 1].inventarioFinal += v.valor;
      }
      return resultado;
    }

    const { valorizados } = await this.valorizados(filtros);
    const año = String(filtros.año);

    for (const inv of valorizados.values()) {
      inv.resultado.lineas.forEach((linea, i) => {
        const dia = diaDe(linea.fecha);
        if (dia.slice(0, 4) !== año) return;
        if (
          !filtros.idAlmacen &&
          CostoVentaRepository.esTransferencia(
            inv.movimientos[i].codigoOperacion,
          )
        ) {
          return;
        }
        const mes = resultado[Number(dia.slice(5, 7)) - 1];
        if (linea.tipo === 'ENTRADA') mes.comprasTotales += linea.costoTotal;
        else mes.salidasTotales += linea.costoTotal;
      });
      for (const mes of resultado) {
        const ultimoDia = new Date(Date.UTC(filtros.año, mes.mes, 0));
        mes.inventarioFinal += CostoVentaRepository.valorAl(
          inv,
          diaDe(ultimoDia),
        );
      }
    }
    return resultado;
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
   * Entradas, salidas al costo e inventario al cierre del año por inventario
   * (cada fila es un almacén, así que incluye las transferencias).
   */
  async getCostoVentaPorInventario(
    filtros: CostoVentaPorInventarioFiltros,
  ): Promise<CostoVentaPorInventarioData[]> {
    if (leerKardexMaterializado()) {
      const inventarios = await this.getInventariosInfo(filtros);
      const ids = inventarios.map((i) => i.idInventario);
      if (ids.length === 0) return [];
      const totales = await this.totalesMaterializados(
        ids,
        filtros.año,
        'inventario',
        false,
      );
      const finales = new Map(
        (await this.valoresAlCierre(ids, filtros.año, [12])).map((v) => [
          v.idInventario,
          v.valor,
        ]),
      );
      const total = (id: number, tipo: string) =>
        totales.find((t) => t.clave === id && t.tipo === tipo)?.total ?? 0;
      return inventarios.map((info) => ({
        idInventario: info.idInventario,
        nombreProducto: info.nombreProducto,
        nombreAlmacen: info.nombreAlmacen,
        entradas: total(info.idInventario, 'ENTRADA'),
        salidas: total(info.idInventario, 'SALIDA'),
        inventarioFinal: finales.get(info.idInventario) ?? 0,
      }));
    }

    const { inventarios, valorizados } = await this.valorizados(filtros);
    const año = String(filtros.año);

    return inventarios.map((info) => {
      const inv = valorizados.get(info.idInventario);
      let entradas = 0;
      let salidas = 0;
      for (const linea of inv?.resultado.lineas ?? []) {
        if (diaDe(linea.fecha).slice(0, 4) !== año) continue;
        if (linea.tipo === 'ENTRADA') entradas += linea.costoTotal;
        else salidas += linea.costoTotal;
      }
      return {
        idInventario: info.idInventario,
        nombreProducto: info.nombreProducto,
        nombreAlmacen: info.nombreAlmacen,
        entradas,
        salidas,
        inventarioFinal: inv
          ? CostoVentaRepository.valorAl(inv, `${año}-12-31`)
          : 0,
      };
    });
  }
}
