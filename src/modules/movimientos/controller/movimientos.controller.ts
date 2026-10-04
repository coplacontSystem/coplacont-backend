import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { RolesGuard } from '../../users/guards/roles.guard';
import { Roles } from '../../users/decorators/roles.decorator';
import { RolEnum } from '../../users/enums/RoleEnum';
import { PertenenciaService } from '../../../common/pertenencia.service';
import { empresaDe } from '../../../common/empresa';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';
import { MovimientosService } from '../service/movimientos.service';
import { CreateMovimientoDto } from '../dto/create-movimiento.dto';
import { ResponseMovimientoDto } from '../dto/response-movimiento.dto';
import { TipoMovimiento } from '../enum/tipo-movimiento.enum';
import { EstadoMovimiento } from '../enum/estado-movimiento.enum';

/**
 * Controlador para la gestión de movimientos de inventario
 */
@ApiTags('Movimientos')
@Controller('movimientos')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class MovimientosController {
  constructor(
    private readonly movimientosService: MovimientosService,
    private readonly pertenencia: PertenenciaService,
  ) {}

  /**
   * Crear un nuevo movimiento
   */
  // Los movimientos de kardex se generan desde comprobantes; editarlos a mano solo lo hace un ADMIN
  @Roles(RolEnum.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Crear un nuevo movimiento de inventario' })
  @ApiBody({ type: CreateMovimientoDto })
  @ApiResponse({
    status: 201,
    description: 'Movimiento creado exitosamente',
    type: ResponseMovimientoDto,
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Producto o almacén no encontrado' })
  async create(
    @Body() createMovimientoDto: CreateMovimientoDto,
  ): Promise<ResponseMovimientoDto> {
    return await this.movimientosService.create(createMovimientoDto);
  }

  /**
   * Obtener todos los movimientos
   */
  @Get()
  @ApiOperation({ summary: 'Obtener todos los movimientos' })
  @ApiQuery({
    name: 'tipo',
    required: false,
    enum: TipoMovimiento,
    description: 'Filtrar por tipo de movimiento',
  })
  @ApiQuery({
    name: 'estado',
    required: false,
    enum: EstadoMovimiento,
    description: 'Filtrar por estado del movimiento',
  })
  @ApiQuery({
    name: 'idComprobante',
    required: false,
    type: Number,
    description: 'Filtrar por ID de comprobante',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de movimientos',
    type: [ResponseMovimientoDto],
  })
  async findAll(
    @Query('tipo') tipo?: TipoMovimiento,
    @Query('estado') estado?: EstadoMovimiento,
    @Query('idComprobante', new ParseIntPipe({ optional: true }))
    idComprobante?: number,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<ResponseMovimientoDto[]> {
    const personaId = empresaDe(user!);
    if (tipo) {
      return await this.movimientosService.findByTipo(tipo, personaId);
    }
    if (estado) {
      return await this.movimientosService.findByEstado(estado, personaId);
    }
    if (idComprobante) {
      await this.pertenencia.comprobantes([idComprobante], personaId);
      return await this.movimientosService.findByComprobante(idComprobante);
    }
    return await this.movimientosService.findAll(personaId);
  }

  /**
   * Obtener un movimiento por ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Obtener un movimiento por ID' })
  @ApiParam({ name: 'id', description: 'ID del movimiento' })
  @ApiResponse({
    status: 200,
    description: 'Movimiento encontrado',
    type: ResponseMovimientoDto,
  })
  @ApiResponse({ status: 404, description: 'Movimiento no encontrado' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseMovimientoDto> {
    await this.pertenencia.movimientos([id], empresaDe(user));
    return await this.movimientosService.findOne(id);
  }

  /**
   * Procesar un movimiento (actualizar inventarios)
   */
  /**
   * Cancelar un movimiento
   */
  // Los movimientos de kardex se generan desde comprobantes; editarlos a mano solo lo hace un ADMIN
  @Roles(RolEnum.ADMIN)
  @Patch(':id/cancelar')
  @ApiOperation({ summary: 'Cancelar un movimiento' })
  @ApiParam({ name: 'id', description: 'ID del movimiento' })
  @ApiResponse({
    status: 200,
    description: 'Movimiento cancelado exitosamente',
    type: ResponseMovimientoDto,
  })
  @ApiResponse({ status: 404, description: 'Movimiento no encontrado' })
  @ApiResponse({
    status: 400,
    description: 'El movimiento no se puede cancelar',
  })
  async cancelarMovimiento(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ResponseMovimientoDto> {
    return await this.movimientosService.cancelarMovimiento(id);
  }

  /**
   * Actualizar estado de un movimiento
   */
  // Los movimientos de kardex se generan desde comprobantes; editarlos a mano solo lo hace un ADMIN
  @Roles(RolEnum.ADMIN)
  @Patch(':id/estado')
  @ApiOperation({ summary: 'Actualizar el estado de un movimiento' })
  @ApiParam({ name: 'id', description: 'ID del movimiento' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        estado: {
          type: 'string',
          enum: Object.values(EstadoMovimiento),
          description: 'Nuevo estado del movimiento',
        },
      },
      required: ['estado'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Estado actualizado exitosamente',
    type: ResponseMovimientoDto,
  })
  @ApiResponse({ status: 404, description: 'Movimiento no encontrado' })
  async updateEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body('estado') estado: EstadoMovimiento,
  ): Promise<ResponseMovimientoDto> {
    return await this.movimientosService.updateEstado(id, estado);
  }

  /**
   * Eliminar un movimiento
   */
  // Los movimientos de kardex se generan desde comprobantes; editarlos a mano solo lo hace un ADMIN
  @Roles(RolEnum.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un movimiento' })
  @ApiParam({ name: 'id', description: 'ID del movimiento' })
  @ApiResponse({
    status: 204,
    description: 'Movimiento eliminado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Movimiento no encontrado' })
  @ApiResponse({
    status: 400,
    description: 'El movimiento no se puede eliminar',
  })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.movimientosService.remove(id);
  }

  /**
   * Obtener movimientos por tipo
   */
  @Get('tipo/:tipo')
  @ApiOperation({ summary: 'Obtener movimientos por tipo' })
  @ApiParam({
    name: 'tipo',
    enum: TipoMovimiento,
    description: 'Tipo de movimiento',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de movimientos por tipo',
    type: [ResponseMovimientoDto],
  })
  async findByTipo(
    @Param('tipo') tipo: TipoMovimiento,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseMovimientoDto[]> {
    return await this.movimientosService.findByTipo(tipo, empresaDe(user));
  }

  /**
   * Obtener movimientos por estado
   */
  @Get('estado/:estado')
  @ApiOperation({ summary: 'Obtener movimientos por estado' })
  @ApiParam({
    name: 'estado',
    enum: EstadoMovimiento,
    description: 'Estado del movimiento',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de movimientos por estado',
    type: [ResponseMovimientoDto],
  })
  async findByEstado(
    @Param('estado') estado: EstadoMovimiento,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseMovimientoDto[]> {
    return await this.movimientosService.findByEstado(estado, empresaDe(user));
  }

  /**
   * Obtener movimientos por comprobante
   */
  @Get('comprobante/:idComprobante')
  @ApiOperation({ summary: 'Obtener movimientos por comprobante' })
  @ApiParam({ name: 'idComprobante', description: 'ID del comprobante' })
  @ApiResponse({
    status: 200,
    description: 'Lista de movimientos por comprobante',
    type: [ResponseMovimientoDto],
  })
  async findByComprobante(
    @Param('idComprobante', ParseIntPipe) idComprobante: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseMovimientoDto[]> {
    await this.pertenencia.comprobantes([idComprobante], empresaDe(user));
    return await this.movimientosService.findByComprobante(idComprobante);
  }
}
