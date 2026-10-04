import {
  Controller,
  Get,
  Query,
  ValidationPipe,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { CostoVentaService } from '../service/costo-venta.service';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';
import { PertenenciaService } from '../../../common/pertenencia.service';
import { empresaDe } from '../../../common/empresa';
import {
  CostoVentaRequestDto,
  CostoVentaResponseDto,
  CostoVentaPorInventarioRequestDto,
  CostoVentaPorInventarioResponseDto,
} from '../dto/costo-venta';

/**
 * Controlador para la gestión de reportes de Estado de Costo de Venta
 */
@ApiTags('Costo de Venta')
@UseGuards(JwtAuthGuard)
@Controller('api/costo-venta')
export class CostoVentaController {
  constructor(
    private readonly costoVentaService: CostoVentaService,
    private readonly pertenencia: PertenenciaService,
  ) {}

  /** Empresa del usuario, verificando que el almacén y el producto filtrados sean suyos. */
  private async empresa(
    user: AuthenticatedUser,
    filtros: { idAlmacen?: number; idProducto?: number },
  ): Promise<number> {
    const personaId = empresaDe(user);
    if (filtros.idAlmacen) {
      await this.pertenencia.almacenes([filtros.idAlmacen], personaId);
    }
    if (filtros.idProducto) {
      await this.pertenencia.productos([filtros.idProducto], personaId);
    }
    return personaId;
  }

  /**
   * Genera el reporte anual de Estado de Costo de Venta
   */
  @Get('reporte')
  @ApiOperation({
    summary: 'Generar reporte de Estado de Costo de Venta',
    description:
      'Genera un reporte anual con desglose mensual de compras totales, salidas totales e inventario final, incluyendo sumatorias anuales',
  })
  @ApiQuery({
    name: 'año',
    description: 'Año para el cual generar el reporte',
    example: 2024,
    type: Number,
  })
  @ApiQuery({
    name: 'idAlmacen',
    description:
      'ID del almacén (opcional, si no se especifica incluye todos los almacenes)',
    example: 1,
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'idProducto',
    description:
      'ID del producto (opcional, si no se especifica incluye todos los productos)',
    example: 1,
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Reporte de costo de venta generado exitosamente',
    type: CostoVentaResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Parámetros inválidos',
  })
  @ApiResponse({
    status: 404,
    description: 'Almacén o producto no encontrado',
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor',
  })
  async generateCostoVentaReport(
    @Query(new ValidationPipe({ transform: true })) query: CostoVentaRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CostoVentaResponseDto> {
    try {
      return await this.costoVentaService.generateCostoVentaReport(
        query,
        await this.empresa(user, query),
      );
    } catch (error) {
      const msg = (error as Error)?.message || 'Error al generar el reporte';
      throw new BadRequestException(`Error al generar el reporte: ${msg}`);
    }
  }

  /**
   * Obtiene un resumen rápido del estado de costo de venta para un año
   */
  @Get('resumen')
  @ApiOperation({
    summary: 'Obtener resumen de costo de venta',
    description:
      'Obtiene un resumen rápido con las sumatorias anuales de compras, salidas e inventario final',
  })
  @ApiQuery({
    name: 'año',
    description: 'Año para el resumen',
    example: 2024,
    type: Number,
  })
  @ApiQuery({
    name: 'idAlmacen',
    description: 'ID del almacén (opcional)',
    example: 1,
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'idProducto',
    description: 'ID del producto (opcional)',
    example: 1,
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Resumen obtenido exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Parámetros inválidos',
  })
  async getCostoVentaResumen(
    @Query(new ValidationPipe({ transform: true })) query: CostoVentaRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    sumatorias: any;
    año: number;
    almacen?: string;
    producto?: string;
  }> {
    try {
      const reporte = await this.costoVentaService.generateCostoVentaReport(
        query,
        await this.empresa(user, query),
      );
      return {
        año: reporte.año,
        almacen: reporte.almacen,
        producto: reporte.producto,
        sumatorias: reporte.sumatorias,
      };
    } catch (error) {
      const msg = (error as Error)?.message || 'Error al obtener el resumen';
      throw new BadRequestException(`Error al obtener el resumen: ${msg}`);
    }
  }

  /**
   * Genera el reporte anual de Estado de Costo de Venta por inventario individual
   */
  @Get('reporte-por-inventario')
  @ApiOperation({
    summary: 'Generar reporte de Estado de Costo de Venta por inventario',
    description:
      'Genera un reporte anual que muestra entradas, salidas e inventario final para cada inventario individual, con sumatorias totales',
  })
  @ApiQuery({
    name: 'año',
    description: 'Año para el cual generar el reporte',
    example: 2024,
    type: Number,
  })
  @ApiQuery({
    name: 'idAlmacen',
    description:
      'ID del almacén (opcional, si no se especifica incluye todos los almacenes)',
    example: 1,
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'idProducto',
    description:
      'ID del producto (opcional, si no se especifica incluye todos los productos)',
    example: 1,
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description:
      'Reporte de costo de venta por inventario generado exitosamente',
    type: CostoVentaPorInventarioResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Parámetros inválidos',
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontraron datos para los filtros especificados',
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor',
  })
  async generateCostoVentaPorInventarioReport(
    @Query(new ValidationPipe({ transform: true }))
    query: CostoVentaPorInventarioRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CostoVentaPorInventarioResponseDto> {
    try {
      return await this.costoVentaService.generateCostoVentaPorInventarioReport(
        query,
        await this.empresa(user, query),
      );
    } catch (error) {
      throw new BadRequestException(
        `Error al generar el reporte por inventario: ${error.message}`,
      );
    }
  }
}
