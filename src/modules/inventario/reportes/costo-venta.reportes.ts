import { Injectable, OnModuleInit } from '@nestjs/common';
import { PertenenciaService } from 'src/common/pertenencia.service';
import { DocumentoTabular } from 'src/modules/reportes/documento-tabular';
import { ReportesService } from 'src/modules/reportes/reportes.service';
import { CostoVentaRequestDto } from '../dto/costo-venta/costo-venta-request.dto';
import { CostoVentaPorInventarioRequestDto } from '../dto/costo-venta/costo-venta-por-inventario-request.dto';
import { CostoVentaService } from '../service/costo-venta.service';

/**
 * Reportes exportables del Estado de Costo de Ventas (mensual y por inventario).
 * Usan el mismo servicio que la pantalla: los números del archivo son los mismos.
 */
@Injectable()
export class CostoVentaReportes implements OnModuleInit {
  constructor(
    private readonly reportes: ReportesService,
    private readonly costoVenta: CostoVentaService,
    private readonly pertenencia: PertenenciaService,
  ) {}

  onModuleInit(): void {
    this.reportes.registrar<CostoVentaRequestDto>({
      clave: 'costo-ventas',
      filtros: CostoVentaRequestDto,
      generar: (personaId, filtros) => this.mensual(personaId, filtros),
    });
    this.reportes.registrar<CostoVentaPorInventarioRequestDto>({
      clave: 'costo-ventas-inventario',
      filtros: CostoVentaPorInventarioRequestDto,
      generar: (personaId, filtros) => this.porInventario(personaId, filtros),
    });
  }

  /** Almacén y producto de los filtros deben ser de la empresa (404 si no). */
  private async verificarFiltros(
    personaId: number,
    filtros: { idAlmacen?: number; idProducto?: number },
  ): Promise<void> {
    if (filtros.idAlmacen) {
      await this.pertenencia.almacenes([filtros.idAlmacen], personaId);
    }
    if (filtros.idProducto) {
      await this.pertenencia.productos([filtros.idProducto], personaId);
    }
  }

  private static datos(reporte: {
    año: number;
    producto?: string;
    almacen?: string;
  }): DocumentoTabular['datos'] {
    return [
      { etiqueta: 'Año', valor: String(reporte.año) },
      { etiqueta: 'Producto', valor: reporte.producto ?? 'Todos' },
      { etiqueta: 'Almacén', valor: reporte.almacen ?? 'Todos' },
    ];
  }

  private async mensual(
    personaId: number,
    filtros: CostoVentaRequestDto,
  ): Promise<DocumentoTabular> {
    await this.verificarFiltros(personaId, filtros);
    const reporte = await this.costoVenta.generateCostoVentaReport(
      filtros,
      personaId,
    );
    return {
      titulo: 'ESTADO DE COSTO DE VENTAS',
      nombreArchivo: [
        'estado_costo_ventas',
        reporte.producto,
        reporte.almacen,
        reporte.año,
      ]
        .filter(Boolean)
        .join('_'),
      datos: CostoVentaReportes.datos(reporte),
      generado: reporte.fechaGeneracion,
      secciones: [
        {
          nombre: 'Costo de ventas',
          titulo: 'Datos mensuales (al costo, en soles)',
          columnas: [
            { clave: 'mes', titulo: 'Mes', tipo: 'texto', ancho: 1.2 },
            { clave: 'compras', titulo: 'Compras', tipo: 'moneda' },
            { clave: 'salidas', titulo: 'Costo de ventas', tipo: 'moneda' },
            { clave: 'final', titulo: 'Inventario final', tipo: 'moneda' },
          ],
          filas: reporte.datosMensuales.map((m) => ({
            mes: m.nombreMes,
            compras: m.comprasTotales,
            salidas: m.salidasTotales,
            final: m.inventarioFinal,
          })),
          totales: {
            mes: 'Total anual',
            compras: reporte.sumatorias.totalComprasAnual,
            salidas: reporte.sumatorias.totalSalidasAnual,
            final: reporte.sumatorias.inventarioFinalAnual,
          },
        },
      ],
    };
  }

  private async porInventario(
    personaId: number,
    filtros: CostoVentaPorInventarioRequestDto,
  ): Promise<DocumentoTabular> {
    await this.verificarFiltros(personaId, filtros);
    const reporte = await this.costoVenta.generateCostoVentaPorInventarioReport(
      filtros,
      personaId,
    );
    return {
      titulo: 'ESTADO DE COSTO DE VENTAS POR INVENTARIO',
      nombreArchivo: `estado_costo_ventas_inventario_${reporte.año}`,
      datos: CostoVentaReportes.datos(reporte),
      generado: reporte.fechaGeneracion,
      secciones: [
        {
          nombre: 'Por inventario',
          titulo: 'Por producto y almacén (al costo, en soles)',
          columnas: [
            { clave: 'producto', titulo: 'Producto', tipo: 'texto', ancho: 2 },
            { clave: 'almacen', titulo: 'Almacén', tipo: 'texto', ancho: 1.5 },
            { clave: 'entradas', titulo: 'Entradas', tipo: 'moneda' },
            { clave: 'salidas', titulo: 'Costo de ventas', tipo: 'moneda' },
            { clave: 'final', titulo: 'Inventario final', tipo: 'moneda' },
          ],
          filas: reporte.datosInventarios.map((i) => ({
            producto: i.nombreProducto,
            almacen: i.nombreAlmacen,
            entradas: i.entradasTotales,
            salidas: i.salidasTotales,
            final: i.inventarioFinal,
          })),
          totales: {
            producto: `Total (${reporte.sumatorias.cantidadInventarios} inventarios)`,
            entradas: reporte.sumatorias.totalEntradasAnual,
            salidas: reporte.sumatorias.totalSalidasAnual,
            final: reporte.sumatorias.totalInventarioFinalAnual,
          },
        },
      ],
    };
  }
}
