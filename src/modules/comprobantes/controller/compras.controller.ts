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
import { ComprasService } from '../service/compras.service';
import { ResponseComprobanteDto } from '../dto/comprobante/response-comprobante.dto';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';

/**
 * Controlador especializado para el manejo de comprobantes de compra
 * Proporciona endpoints específicos para operaciones de compras
 */
@ApiTags('Compras')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/compras')
export class ComprasController {
  constructor(private readonly comprasService: ComprasService) {}

  /**
   * Obtiene todos los comprobantes de compra
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes de compra
   */
  @Get()
  @ApiOperation({ summary: 'Obtener todos los comprobantes de compra' })
  @ApiResponse({
    status: 200,
    description: 'Lista de comprobantes de compra obtenida exitosamente',
    type: [ResponseComprobanteDto],
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() paginacion: PaginacionDto,
  ): Promise<ResponseComprobanteDto[] | Pagina<ResponseComprobanteDto>> {
    return this.comprasService.findAll(empresaDe(user), paginacion);
  }

  /**
   * Busca un comprobante de compra por su ID
   * @param id - ID del comprobante
   * @returns Promise<ResponseComprobanteDto | null> Comprobante encontrado o null
   */
  @Get(':id')
  @ApiOperation({ summary: 'Obtener un comprobante de compra por ID' })
  @ApiParam({
    name: 'id',
    description: 'ID del comprobante de compra',
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Comprobante de compra encontrado',
    type: ResponseComprobanteDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Comprobante de compra no encontrado',
  })
  async findById(
    @Param('id') id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseComprobanteDto | null> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    return this.comprasService.findById(id, user.personaId);
  }

  /**
   * Busca comprobantes de compra por rango de fechas
   * @param fechaInicio - Fecha de inicio del rango (formato: YYYY-MM-DD)
   * @param fechaFin - Fecha de fin del rango (formato: YYYY-MM-DD)
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes en el rango
   */
  @Get('fecha-rango/buscar')
  @ApiOperation({
    summary: 'Buscar comprobantes de compra por rango de fechas',
  })
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
    description: 'Lista de comprobantes de compra en el rango de fechas',
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
    return this.comprasService.findByDateRange(inicio, fin, user.personaId);
  }

  /**
   * Busca comprobantes de compra por proveedor
   * @param proveedorId - ID del proveedor
   * @returns Promise<ResponseComprobanteDto[]> Lista de comprobantes del proveedor
   */
  @Get('proveedor/:proveedorId')
  @ApiOperation({ summary: 'Obtener comprobantes de compra por proveedor' })
  @ApiParam({
    name: 'proveedorId',
    description: 'ID del proveedor',
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de comprobantes de compra del proveedor',
    type: [ResponseComprobanteDto],
  })
  async findByProveedor(
    @Param('proveedorId') proveedorId: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseComprobanteDto[]> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    return this.comprasService.findByProveedor(proveedorId, user.personaId);
  }
}
