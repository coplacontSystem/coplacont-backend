import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  ParseIntPipe,
  HttpStatus,
  UseInterceptors,
  ClassSerializerInterceptor,
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
import { InventarioService } from '../service/inventario.service';
import {
  CreateInventarioDto,
  UpdateInventarioDto,
  ResponseInventarioDto,
} from '../dto';
import { ResponseProductoDto } from 'src/modules/productos/dto/response-producto.dto';
import { plainToClass } from 'class-transformer';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';

/**
 * Controlador para la gestión de inventario
 * Maneja las operaciones CRUD y consultas específicas de inventario
 */
@ApiTags('Inventario')
@Controller('api/inventario')
@UseInterceptors(ClassSerializerInterceptor)
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  /**
   * Crear un nuevo registro de inventario
   */
  @Post()
  @ApiOperation({
    summary: 'Crear inventario',
    description:
      'Crea un nuevo registro de inventario para un producto en un almacén específico',
  })
  @ApiBody({ type: CreateInventarioDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Inventario creado exitosamente',
    type: ResponseInventarioDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Datos de entrada inválidos',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Almacén o producto no encontrado',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Ya existe inventario para este producto en el almacén',
  })
  async create(
    @Body() createInventarioDto: CreateInventarioDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseInventarioDto> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    const inventario = await this.inventarioService.create(
      createInventarioDto,
      user.personaId,
    );
    return plainToClass(ResponseInventarioDto, inventario);
  }

  /**
   * Obtener todos los registros de inventario
   */
  @Get()
  @ApiOperation({
    summary: 'Listar inventarios',
    description: 'Obtiene todos los registros de inventario',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Lista de inventarios obtenida exitosamente',
    type: [ResponseInventarioDto],
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseInventarioDto[]> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    const inventarios = await this.inventarioService.findAll(user.personaId);
    return inventarios.map((inventario) =>
      plainToClass(ResponseInventarioDto, inventario),
    );
  }

  /**
   * Obtener un inventario por ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Obtener inventario por ID',
    description: 'Obtiene un registro de inventario específico por su ID',
  })
  @ApiParam({ name: 'id', description: 'ID del inventario', type: 'number' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Inventario encontrado',
    type: ResponseInventarioDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Inventario no encontrado',
  })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ResponseInventarioDto> {
    const inventario = await this.inventarioService.findOne(id);
    return plainToClass(ResponseInventarioDto, inventario);
  }

  /**
   * Obtener inventario por almacén
   */
  @Get('almacen/:idAlmacen')
  @ApiOperation({
    summary: 'Obtener inventario por almacén',
    description:
      'Obtiene todos los productos en inventario de un almacén específico',
  })
  @ApiParam({
    name: 'idAlmacen',
    description: 'ID del almacén',
    type: 'number',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Inventario del almacén obtenido exitosamente',
    type: [ResponseInventarioDto],
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Almacén no encontrado',
  })
  async findByAlmacen(
    @Param('idAlmacen', ParseIntPipe) idAlmacen: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseInventarioDto[]> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    const inventarios = await this.inventarioService.findByAlmacen(
      idAlmacen,
      user.personaId,
    );
    return inventarios.map((inventario) =>
      plainToClass(ResponseInventarioDto, inventario),
    );
  }

  /**
   * Obtener inventario por producto
   */
  @Get('producto/:idProducto')
  @ApiOperation({
    summary: 'Obtener inventario por producto',
    description: 'Obtiene el inventario de un producto en todos los almacenes',
  })
  @ApiParam({
    name: 'idProducto',
    description: 'ID del producto',
    type: 'number',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Inventario del producto obtenido exitosamente',
    type: [ResponseInventarioDto],
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Producto no encontrado',
  })
  async findByProducto(
    @Param('idProducto', ParseIntPipe) idProducto: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseInventarioDto[]> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    const inventarios = await this.inventarioService.findByProducto(
      idProducto,
      user.personaId,
    );
    return inventarios.map((inventario) =>
      plainToClass(ResponseInventarioDto, inventario),
    );
  }

  /**
   * Obtener inventarios de dos almacenes para productos comunes en ambos
   */
  @Get('almacenes/comunes')
  @ApiOperation({
    summary: 'Inventarios comunes entre dos almacenes',
    description:
      'Lista inventarios (almacén y producto) donde el producto existe en ambos almacenes',
  })
  @ApiQuery({ name: 'idAlmacen1', type: 'number', required: true })
  @ApiQuery({ name: 'idAlmacen2', type: 'number', required: true })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Productos comunes entre ambos almacenes',
    type: [ResponseProductoDto],
  })
  async findCommonByAlmacenes(
    @Query('idAlmacen1') idAlmacen1: number,
    @Query('idAlmacen2') idAlmacen2: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseProductoDto[]> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    const result = await this.inventarioService.findCommonByAlmacenes(
      Number(idAlmacen1),
      Number(idAlmacen2),
      user.personaId,
    );
    return result;
  }

  /**
   * Obtener inventario específico por almacén y producto
   */
  @Get('almacen/:idAlmacen/producto/:idProducto')
  @ApiOperation({
    summary: 'Obtener inventario específico',
    description:
      'Obtiene el inventario de un producto específico en un almacén específico',
  })
  @ApiParam({
    name: 'idAlmacen',
    description: 'ID del almacén',
    type: 'number',
  })
  @ApiParam({
    name: 'idProducto',
    description: 'ID del producto',
    type: 'number',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Inventario específico obtenido exitosamente',
    type: ResponseInventarioDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Inventario no encontrado para esta combinación',
  })
  async findByAlmacenAndProducto(
    @Param('idAlmacen', ParseIntPipe) idAlmacen: number,
    @Param('idProducto', ParseIntPipe) idProducto: number,
  ): Promise<ResponseInventarioDto> {
    const inventario = await this.inventarioService.findByAlmacenAndProducto(
      idAlmacen,
      idProducto,
    );
    return plainToClass(ResponseInventarioDto, inventario);
  }

  /**
   * Obtener información del inventario inicial (lote y movimiento INV-INIT) por inventario
   */
  @Get(':id/inicial')
  @ApiOperation({
    summary: 'Obtener inventario inicial',
    description:
      'Obtiene el lote inicial y el detalle de movimiento (INV-INIT) para un inventario dado',
  })
  @ApiParam({ name: 'id', description: 'ID del inventario', type: 'number' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Inventario inicial encontrado',
  })
  async getInventarioInicial(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<any> {
    return await this.inventarioService.getInventarioInicial(id);
  }

  /**
   * Editar el inventario inicial (cantidad y/o precio) por inventario
   */
  @Patch(':id/inicial')
  @ApiOperation({
    summary: 'Editar inventario inicial',
    description:
      'Actualiza la cantidad y/o precio del lote inicial y sincroniza el detalle de movimiento',
  })
  @ApiParam({ name: 'id', description: 'ID del inventario', type: 'number' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        cantidadInicial: {
          type: 'number',
          description: 'Nueva cantidad inicial del lote',
          example: 100,
        },
        costoUnitario: {
          type: 'number',
          description: 'Nuevo costo unitario del lote',
          example: 25.5,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Inventario inicial actualizado',
  })
  async updateInventarioInicial(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: { cantidadInicial?: number; costoUnitario?: number },
  ): Promise<any> {
    return await this.inventarioService.updateInventarioInicial(id, body);
  }

  /**
   * Obtener productos con stock bajo
   */
  @Get('reportes/stock-bajo')
  @ApiOperation({
    summary: 'Obtener productos con stock bajo',
    description:
      'Obtiene los productos que tienen stock igual o menor al stock mínimo configurado',
  })
  @ApiQuery({
    name: 'idAlmacen',
    description: 'ID del almacén (opcional)',
    type: 'number',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Productos con stock bajo obtenidos exitosamente',
    type: [ResponseInventarioDto],
  })
  async findLowStock(
    @Query('idAlmacen') idAlmacen?: number,
  ): Promise<ResponseInventarioDto[]> {
    const inventarios = await this.inventarioService.findLowStock(idAlmacen);
    return inventarios.map((inventario) =>
      plainToClass(ResponseInventarioDto, inventario),
    );
  }

  /**
   * Obtener resumen de inventario por almacén
   */
  @Get('reportes/resumen/:idAlmacen')
  @ApiOperation({
    summary: 'Obtener resumen de inventario',
    description: 'Obtiene un resumen estadístico del inventario de un almacén',
  })
  @ApiParam({
    name: 'idAlmacen',
    description: 'ID del almacén',
    type: 'number',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resumen de inventario obtenido exitosamente',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Almacén no encontrado',
  })
  async getResumenByAlmacen(
    @Param('idAlmacen', ParseIntPipe) idAlmacen: number,
  ): Promise<any> {
    return await this.inventarioService.getResumenByAlmacen(idAlmacen);
  }

  /**
   * Actualizar un inventario
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar inventario',
    description: 'Actualiza un registro de inventario existente',
  })
  @ApiParam({ name: 'id', description: 'ID del inventario', type: 'number' })
  @ApiBody({ type: UpdateInventarioDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Inventario actualizado exitosamente',
    type: ResponseInventarioDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Datos de entrada inválidos',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Inventario no encontrado',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Conflicto con combinación almacén-producto existente',
  })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateInventarioDto: UpdateInventarioDto,
  ): Promise<ResponseInventarioDto> {
    const inventario = await this.inventarioService.update(
      id,
      updateInventarioDto,
    );
    return plainToClass(ResponseInventarioDto, inventario);
  }

  /**
   * Actualizar stock de un inventario
   */
  @Patch(':id/stock')
  @ApiOperation({
    summary: 'Actualizar stock',
    description:
      'Actualiza el stock de un inventario sumando o restando una cantidad',
  })
  @ApiParam({ name: 'id', description: 'ID del inventario', type: 'number' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        cantidad: {
          type: 'number',
          description: 'Cantidad a sumar (positiva) o restar (negativa)',
          example: 10,
        },
      },
      required: ['cantidad'],
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Stock actualizado exitosamente',
    type: ResponseInventarioDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Stock insuficiente o cantidad inválida',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Inventario no encontrado',
  })
  async updateStock(
    @Param('id', ParseIntPipe) id: number,
    @Body('cantidad') cantidad: number,
  ): Promise<ResponseInventarioDto> {
    const inventario = await this.inventarioService.updateStock(id, cantidad);
    return plainToClass(ResponseInventarioDto, inventario);
  }
}
