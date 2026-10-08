import { Pagina, PaginacionDto } from 'src/common/paginacion';
import { empresaDe } from 'src/common/empresa';
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { VentasService } from '../service/ventas.service';
import { ResponseComprobanteDto } from '../dto/comprobante/response-comprobante.dto';
import { ResponseComprobanteWithDetallesDto } from '../dto/comprobante/response-comprobante-with-detalles.dto';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';

/**
 * Controlador especializado para el manejo de comprobantes de venta
 * Proporciona endpoints específicos para operaciones de ventas
 */
@ApiTags('Ventas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/ventas')
export class VentasController {
  constructor(private readonly ventasService: VentasService) {}

  /**
   * Obtiene todos los comprobantes de venta
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes de venta
   */
  @Get()
  @ApiOperation({ summary: 'Obtener todos los comprobantes de venta' })
  @ApiResponse({
    status: 200,
    description: 'Lista de comprobantes de venta obtenida exitosamente',
    type: [ResponseComprobanteDto],
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() paginacion: PaginacionDto,
  ): Promise<ResponseComprobanteDto[] | Pagina<ResponseComprobanteDto>> {
    return this.ventasService.findAll(empresaDe(user), paginacion);
  }

  /**
   * Busca un comprobante de venta por su ID
   * @param id - ID del comprobante
   * @returns Promise<ResponseComprobanteWithDetallesDto | null> Comprobante encontrado o null
   */
  @Get(':id')
  @ApiOperation({ summary: 'Obtener un comprobante de venta por ID' })
  @ApiParam({
    name: 'id',
    description: 'ID del comprobante de venta',
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Comprobante de venta encontrado',
    type: ResponseComprobanteWithDetallesDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Comprobante de venta no encontrado',
  })
  async findById(
    @Param('id') id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseComprobanteWithDetallesDto | null> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    return this.ventasService.findById(id, user.personaId);
  }

  /**
   * Busca comprobantes de venta por rango de fechas
   * @param fechaInicio - Fecha de inicio del rango (formato: YYYY-MM-DD)
   * @param fechaFin - Fecha de fin del rango (formato: YYYY-MM-DD)
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes en el rango
   */
  @Get('fecha-rango/buscar')
  @ApiOperation({ summary: 'Buscar comprobantes de venta por rango de fechas' })
  @ApiQuery({
    name: 'fechaInicio',
    description: 'Fecha de inicio del rango (YYYY-MM-DD)',
    type: 'string',
    example: '2024-01-01',
  })
  @ApiQuery({
    name: 'fechaFin',
    description: 'Fecha de fin del rango (YYYY-MM-DD)',
    type: 'string',
    example: '2024-12-31',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de comprobantes de venta en el rango de fechas',
    type: [ResponseComprobanteDto],
  })
  async findByDateRange(
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseComprobanteDto[]> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    return this.ventasService.findByDateRange(inicio, fin, user.personaId);
  }

  /**
   * Busca comprobantes de venta por cliente
   * @param clienteId - ID del cliente
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes del cliente
   */
  @Get('cliente/:clienteId')
  @ApiOperation({ summary: 'Obtener comprobantes de venta por cliente' })
  @ApiParam({
    name: 'clienteId',
    description: 'ID del cliente',
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de comprobantes de venta del cliente',
    type: [ResponseComprobanteDto],
  })
  async findByCliente(
    @Param('clienteId') clienteId: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseComprobanteDto[]> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    return this.ventasService.findByCliente(clienteId, user.personaId);
  }

  /**
   * Obtiene el total de ventas en un rango de fechas
   * @param fechaInicio - Fecha de inicio del rango (formato: YYYY-MM-DD)
   * @param fechaFin - Fecha de fin del rango (formato: YYYY-MM-DD)
   * @returns Promise<{total: number}> Total de ventas en el período
   */
  @Get('totales/fecha-rango')
  @ApiOperation({ summary: 'Obtener total de ventas por rango de fechas' })
  @ApiQuery({
    name: 'fechaInicio',
    description: 'Fecha de inicio del rango (YYYY-MM-DD)',
    type: 'string',
    example: '2024-01-01',
  })
  @ApiQuery({
    name: 'fechaFin',
    description: 'Fecha de fin del rango (YYYY-MM-DD)',
    type: 'string',
    example: '2024-12-31',
  })
  @ApiResponse({
    status: 200,
    description: 'Total de ventas en el rango de fechas',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number', description: 'Total de ventas' },
        fechaInicio: {
          type: 'string',
          description: 'Fecha de inicio del rango',
        },
        fechaFin: { type: 'string', description: 'Fecha de fin del rango' },
      },
    },
  })
  async getTotalVentasByDateRange(
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ total: number; fechaInicio: string; fechaFin: string }> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    const total = await this.ventasService.getTotalVentasByDateRange(
      inicio,
      fin,
      user.personaId,
    );
    return { total, fechaInicio, fechaFin };
  }
}
