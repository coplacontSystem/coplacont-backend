import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OPERACION } from 'src/common/catalogo.service';
import { PeriodoContableService } from 'src/modules/periodos/service';
import { diaDe } from '../valoracion/motor-valoracion';
import {
  InventarioValorizado,
  ValoracionService,
} from '../valoracion/valoracion.service';

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
    private readonly periodoContableService: PeriodoContableService,
  ) {}

  /**
   * Inventarios de la empresa (con filtros) valorizados por el motor único, con
   * el método de valoración de la empresa: los importes son los mismos del kardex.
   */
  private async valorizados(filtros: CostoVentaFiltros): Promise<{
    inventarios: Awaited<
      ReturnType<CostoVentaRepository['getInventariosInfo']>
    >;
    valorizados: Map<number, InventarioValorizado>;
  }> {
    const inventarios = await this.getInventariosInfo(filtros);
    const metodo = (
      await this.periodoContableService.obtenerConfiguracion(filtros.personaId)
    ).metodoCalculoCosto;
    const valorizados = await this.valoracion.valorizarInventarios(
      inventarios.map((i) => i.idInventario),
      metodo,
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
    const { valorizados } = await this.valorizados(filtros);
    const año = String(filtros.año);
    const resultado: CostoVentaMensualData[] = Array.from(
      { length: 12 },
      (_, i) => ({
        mes: i + 1,
        comprasTotales: 0,
        salidasTotales: 0,
        inventarioFinal: 0,
      }),
    );

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
