import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CostoVentaRepository,
  CostoVentaFiltros,
  CostoVentaPorInventarioFiltros,
  CostoVentaPorInventarioData,
} from '../repository/costo-venta.repository';
import {
  CostoVentaRequestDto,
  CostoVentaResponseDto,
  CostoVentaMensualDto,
  CostoVentaSumatoriaDto,
  CostoVentaPorInventarioRequestDto,
  CostoVentaPorInventarioResponseDto,
  CostoVentaInventarioDto,
  CostoVentaInventarioSumatoriaDto,
} from '../dto/costo-venta';

/**
 * Servicio para la generación de reportes de Estado de Costo de Venta
 */
@Injectable()
export class CostoVentaService {
  constructor(private readonly costoVentaRepository: CostoVentaRepository) {}

  /**
   * Nombres de los meses en español
   */
  private readonly nombresMeses = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];

  /**
   * Genera el reporte anual de Estado de Costo de Venta
   */
  async generateCostoVentaReport(
    request: CostoVentaRequestDto,
    personaId: number,
  ): Promise<CostoVentaResponseDto> {
    try {
      // Preparar filtros para el repositorio
      const filtros: CostoVentaFiltros = {
        año: request.año,
        personaId,
        idAlmacen: request.idAlmacen,
        idProducto: request.idProducto,
      };

      // Obtener datos mensuales del repositorio
      const datosMensualesRaw =
        await this.costoVentaRepository.getCostoVentaAnual(filtros);

      // Transformar datos mensuales al formato del DTO
      const datosMensuales: CostoVentaMensualDto[] = datosMensualesRaw.map(
        (dato) => ({
          mes: dato.mes,
          nombreMes: this.nombresMeses[dato.mes - 1],
          comprasTotales: Number(dato.comprasTotales).toFixed(2),
          salidasTotales: Number(dato.salidasTotales).toFixed(2),
          inventarioFinal: Number(dato.inventarioFinal).toFixed(2),
        }),
      );

      // Calcular sumatorias anuales
      const sumatorias: CostoVentaSumatoriaDto =
        this.calcularSumatorias(datosMensualesRaw);

      // Obtener información adicional si se especificaron filtros
      let nombreAlmacen: string | undefined;
      let nombreProducto: string | undefined;

      if (request.idAlmacen) {
        const almacenInfo = await this.costoVentaRepository.getAlmacenInfo(
          request.idAlmacen,
        );
        if (!almacenInfo) {
          throw new NotFoundException(
            `Almacén con ID ${request.idAlmacen} no encontrado`,
          );
        }
        nombreAlmacen = almacenInfo.nombre;
      }

      if (request.idProducto) {
        const productoInfo = await this.costoVentaRepository.getProductoInfo(
          request.idProducto,
        );
        if (!productoInfo) {
          throw new NotFoundException(
            `Producto con ID ${request.idProducto} no encontrado`,
          );
        }
        nombreProducto = productoInfo.nombre;
      }

      // Construir respuesta
      const response: CostoVentaResponseDto = {
        año: request.año,
        almacen: nombreAlmacen,
        producto: nombreProducto,
        datosMensuales,
        sumatorias,
        fechaGeneracion: new Date(),
      };

      return response;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const msg = (error as Error)?.message || 'Error desconocido';
      throw new Error(`Error al generar el reporte de costo de venta: ${msg}`);
    }
  }

  /**
   * Calcula las sumatorias anuales a partir de los datos mensuales
   */
  private calcularSumatorias(
    datosMensuales: Array<{
      comprasTotales: number | string;
      salidasTotales: number | string;
      inventarioFinal: number | string;
    }>,
  ): CostoVentaSumatoriaDto {
    const totalComprasAnual = datosMensuales.reduce(
      (sum, dato) => sum + Number(dato.comprasTotales),
      0,
    );

    const totalSalidasAnual = datosMensuales.reduce(
      (sum, dato) => sum + Number(dato.salidasTotales),
      0,
    );

    // El inventario final anual es el inventario final del último mes (diciembre)
    const inventarioFinalAnual =
      datosMensuales.length > 0
        ? Number(
            datosMensuales[datosMensuales.length - 1]?.inventarioFinal || 0,
          )
        : 0;

    return {
      totalComprasAnual: totalComprasAnual.toFixed(2),
      totalSalidasAnual: totalSalidasAnual.toFixed(2),
      inventarioFinalAnual: inventarioFinalAnual.toFixed(2),
    };
  }

  /**
   * Valida que el año especificado sea válido
   */
  private validarAño(año: number): void {
    const añoActual = new Date().getFullYear();
    if (año < 2000 || año > añoActual + 1) {
      throw new Error(
        `El año ${año} no es válido. Debe estar entre 2000 y ${añoActual + 1}`,
      );
    }
  }

  /**
   * Genera el reporte anual de Estado de Costo de Venta por inventario individual
   */
  async generateCostoVentaPorInventarioReport(
    request: CostoVentaPorInventarioRequestDto,
    personaId: number,
  ): Promise<CostoVentaPorInventarioResponseDto> {
    try {
      // Validar año
      this.validarAño(request.año);

      // Preparar filtros para el repositorio
      const filtros: CostoVentaPorInventarioFiltros = {
        año: request.año,
        personaId,
        idAlmacen: request.idAlmacen,
        idProducto: request.idProducto,
      };

      // Obtener datos por inventario del repositorio
      const datosInventarioRaw =
        await this.costoVentaRepository.getCostoVentaPorInventario(filtros);

      if (datosInventarioRaw.length === 0) {
        throw new NotFoundException(
          `No se encontraron datos para el año ${request.año}` +
            (request.idAlmacen ? ` en el almacén ${request.idAlmacen}` : '') +
            (request.idProducto
              ? ` para el producto ${request.idProducto}`
              : ''),
        );
      }

      // Transformar datos al formato del DTO
      const datosInventario: CostoVentaInventarioDto[] = datosInventarioRaw.map(
        (dato) => ({
          idInventario: dato.idInventario,
          nombreProducto: dato.nombreProducto,
          nombreAlmacen: dato.nombreAlmacen,
          nombreProductoAlmacen: `${dato.nombreProducto} - ${dato.nombreAlmacen}`,
          entradasTotales: Number(dato.entradas).toFixed(2),
          salidasTotales: Number(dato.salidas).toFixed(2),
          inventarioFinal: Number(dato.inventarioFinal).toFixed(2),
        }),
      );

      // Calcular sumatorias
      const sumatorias =
        this.calcularSumatoriasPorInventario(datosInventarioRaw);

      // Obtener información adicional para el reporte
      let nombreAlmacen: string | undefined;
      let nombreProducto: string | undefined;

      if (request.idAlmacen) {
        const almacenInfo = await this.costoVentaRepository.getAlmacenInfo(
          request.idAlmacen,
        );
        nombreAlmacen = almacenInfo?.nombre;
      }

      if (request.idProducto) {
        const productoInfo = await this.costoVentaRepository.getProductoInfo(
          request.idProducto,
        );
        nombreProducto = productoInfo?.nombre;
      }

      return {
        año: request.año,
        almacen: nombreAlmacen,
        producto: nombreProducto,
        datosInventarios: datosInventario,
        sumatorias,
        fechaGeneracion: new Date(),
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const msg = (error as Error)?.message || 'Error desconocido';
      throw new Error(
        `Error al generar el reporte de costo de venta por inventario: ${msg}`,
      );
    }
  }

  /**
   * Calcula las sumatorias totales a partir de los datos por inventario
   */
  private calcularSumatoriasPorInventario(
    datosInventario: CostoVentaPorInventarioData[],
  ): CostoVentaInventarioSumatoriaDto {
    const totalEntradasAnual = datosInventario.reduce(
      (sum, dato) => sum + Number(dato.entradas),
      0,
    );

    const totalSalidasAnual = datosInventario.reduce(
      (sum, dato) => sum + Number(dato.salidas),
      0,
    );

    const totalInventarioFinalAnual = datosInventario.reduce(
      (sum, dato) => sum + Number(dato.inventarioFinal),
      0,
    );

    return {
      totalEntradasAnual: totalEntradasAnual.toFixed(2),
      totalSalidasAnual: totalSalidasAnual.toFixed(2),
      totalInventarioFinalAnual: totalInventarioFinalAnual.toFixed(2),
      cantidadInventarios: datosInventario.length,
    };
  }
}
