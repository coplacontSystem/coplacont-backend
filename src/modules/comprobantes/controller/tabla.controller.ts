import { Controller, Get, Param, UseGuards, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { TablaService } from '../service/tabla.service';
import { TablaResponseDto } from '../dto/tabla/tabla-response.dto';
import { TablaDetalleResponseDto } from '../dto/tabla/tabla-detalle-response.dto';

/**
 * Controlador para el manejo de tablas maestras del sistema
 * Proporciona endpoints para obtener tablas y sus detalles
 */
@ApiTags('Tablas Maestras')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/tablas')
export class TablaController {
  constructor(private readonly tablaService: TablaService) {}

  /**
   * Obtiene todas las tablas disponibles
   */
  @Get()
  @ApiOperation({
    summary: 'Obtener todas las tablas',
    description:
      'Obtiene la lista completa de tablas maestras disponibles en el sistema',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de tablas obtenida exitosamente',
    type: [TablaResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'No autorizado - Token JWT requerido',
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor',
  })
  async findAll(): Promise<TablaResponseDto[]> {
    return this.tablaService.findAll();
  }

  /**
   * Obtiene una tabla específica por su número
   */
  @Get(':numeroTabla')
  @ApiOperation({
    summary: 'Obtener tabla por número',
    description:
      'Obtiene una tabla específica con todos sus detalles usando el número de tabla',
  })
  @ApiParam({
    name: 'numeroTabla',
    description: 'Número de la tabla (ej: 12 para Tipos de Operación)',
    example: '12',
  })
  @ApiResponse({
    status: 200,
    description: 'Tabla obtenida exitosamente',
    type: TablaResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Tabla no encontrada',
  })
  @ApiResponse({
    status: 401,
    description: 'No autorizado - Token JWT requerido',
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor',
  })
  async findByNumero(
    @Param('numeroTabla') numeroTabla: string,
  ): Promise<TablaResponseDto> {
    return this.tablaService.findByNumero(numeroTabla);
  }

  /**
   * Obtiene solo los detalles de una tabla específica
   */
  @Get(':numeroTabla/detalles')
  @ApiOperation({
    summary: 'Obtener detalles de una tabla',
    description:
      'Obtiene únicamente los detalles de una tabla específica sin la información de la tabla padre',
  })
  @ApiParam({
    name: 'numeroTabla',
    description: 'Número de la tabla (ej: 12 para Tipos de Operación)',
    example: '12',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalles de la tabla obtenidos exitosamente',
    type: [TablaDetalleResponseDto],
  })
  @ApiResponse({
    status: 404,
    description: 'Tabla no encontrada',
  })
  @ApiResponse({
    status: 401,
    description: 'No autorizado - Token JWT requerido',
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor',
  })
  async findDetallesByNumero(
    @Param('numeroTabla') numeroTabla: string,
  ): Promise<TablaDetalleResponseDto[]> {
    return this.tablaService.findDetallesByNumero(numeroTabla);
  }

  /**
   * Obtiene un detalle específico por código y número de tabla
   */
  @Get(':numeroTabla/detalles/:codigo')
  @ApiOperation({
    summary: 'Obtener detalle específico',
    description:
      'Obtiene un detalle específico de una tabla usando el número de tabla y el código del detalle',
  })
  @ApiParam({
    name: 'numeroTabla',
    description: 'Número de la tabla (ej: 12 para Tipos de Operación)',
    example: '12',
  })
  @ApiParam({
    name: 'codigo',
    description: 'Código del detalle (ej: 01 para VENTA)',
    example: '01',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalle obtenido exitosamente',
    type: TablaDetalleResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Detalle no encontrado',
  })
  @ApiResponse({
    status: 401,
    description: 'No autorizado - Token JWT requerido',
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor',
  })
  async findDetalleByCodigo(
    @Param('numeroTabla') numeroTabla: string,
    @Param('codigo') codigo: string,
  ): Promise<TablaDetalleResponseDto> {
    return this.tablaService.findDetalleByCodigo(numeroTabla, codigo);
  }

  /**
   * Obtiene detalles por una lista de IDs (idTablaDetalle)
   */
  @Get('detalles/by-ids')
  @ApiOperation({
    summary: 'Obtener detalles por lista de IDs',
    description:
      'Recibe un arreglo de idTablaDetalle y devuelve los detalles activos correspondientes',
  })
  @ApiQuery({
    name: 'ids',
    description: 'Lista de IDs separados por coma (ej: 1,2,3)',
    required: true,
    example: '1,2,3',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalles obtenidos exitosamente',
    type: [TablaDetalleResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'No autorizado - Token JWT requerido',
  })
  @ApiResponse({ status: 500, description: 'Error interno del servidor' })
  async findDetallesByIds(
    @Query('ids') ids: string,
  ): Promise<TablaDetalleResponseDto[]> {
    const idList = (ids || '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    return this.tablaService.findDetallesByIds(idList);
  }
}
