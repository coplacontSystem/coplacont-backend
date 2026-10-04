import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PeriodoContableService } from '../service/periodo-contable.service';
import {
  CreatePeriodoContableDto,
  UpdatePeriodoContableDto,
  ResponsePeriodoContableDto,
  CerrarPeriodoDto,
  UpdateMetodoValoracionDto,
} from '../dto';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';

/**
 * Controlador para gestionar períodos contables
 * Proporciona endpoints para CRUD y operaciones especiales de períodos con soporte multi-tenant
 */
@ApiTags('Períodos Contables')
@Controller('/api/periodos-contables')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PeriodoContableController {
  constructor(
    private readonly periodoContableService: PeriodoContableService,
  ) {}

  /**
   * Crear un nuevo período contable para la empresa
   */
  @Post()
  @ApiOperation({
    summary: 'Crear período contable para la empresa',
    description:
      'Crea un nuevo período contable para la empresa del usuario autenticado',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Período contable creado exitosamente',
    type: ResponsePeriodoContableDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Ya existe un período para ese año',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Datos de entrada inválidos',
  })
  async crear(
    @CurrentUser() user: AuthenticatedUser,
    @Body() createDto: CreatePeriodoContableDto,
  ): Promise<ResponsePeriodoContableDto> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene empresa asociada');
    }
    return this.periodoContableService.crear(user.personaId, createDto);
  }

  /**
   * Obtener todos los períodos de la empresa
   */
  @Get()
  @ApiOperation({
    summary: 'Obtener períodos de la empresa',
    description:
      'Obtiene todos los períodos contables de la empresa del usuario autenticado',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Lista de períodos contables',
    type: [ResponsePeriodoContableDto],
  })
  async obtenerPorPersona(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponsePeriodoContableDto[]> {
    if (!user.persona?.id) {
      throw new Error('Usuario no tiene empresa asociada');
    }
    return this.periodoContableService.obtenerPorPersona(user.persona.id);
  }

  /**
   * Obtener período activo de la empresa
   */
  @Get('activo')
  @ApiOperation({
    summary: 'Obtener período activo de la empresa',
    description:
      'Obtiene el período contable activo de la empresa del usuario autenticado',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Período contable activo',
    type: ResponsePeriodoContableDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No se encontró período activo',
  })
  async obtenerPeriodoActivo(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponsePeriodoContableDto> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene empresa asociada');
    }
    return this.periodoContableService.obtenerPeriodoActivo(user.personaId);
  }

  /**
   * Obtener configuración del período activo de la empresa
   */
  @Get('configuracion')
  @ApiOperation({
    summary: 'Obtener configuración del período activo',
    description:
      'Obtiene la configuración (método de valoración, límites, etc.) de la empresa del usuario autenticado',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Configuración del período',
    schema: {
      type: 'object',
      properties: {
        metodoValoracion: {
          type: 'string',
          enum: Object.values(MetodoValoracion),
        },
        duracionMeses: { type: 'number' },
        mesInicio: { type: 'number' },
        diasLimiteRetroactivo: { type: 'number' },
        recalculoAutomaticoKardex: { type: 'boolean' },
      },
    },
  })
  async obtenerConfiguracion(@CurrentUser() user: AuthenticatedUser) {
    if (!user.personaId) {
      throw new Error('Usuario no tiene empresa asociada');
    }
    const config = await this.periodoContableService.obtenerConfiguracion(
      user.personaId,
    );
    return {
      metodoValoracion: (config as any).metodoCalculoCosto,
      duracionMeses: (config as any).duracionMeses,
      mesInicio: (config as any).mesInicio,
      diasLimiteRetroactivo: (config as any).diasLimiteRetroactivo,
      recalculoAutomaticoKardex: (config as any).recalculoAutomaticoKardex,
    };
  }

  /**
   * Obtener período por ID de la empresa
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Obtener período por ID de la empresa',
    description:
      'Obtiene un período contable específico por su ID, verificando que pertenezca a la empresa del usuario',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del período contable',
    type: 'number',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Período contable encontrado',
    type: ResponsePeriodoContableDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Período contable no encontrado',
  })
  async obtenerPorId(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ResponsePeriodoContableDto> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene empresa asociada');
    }
    return this.periodoContableService.obtenerPorIdYPersona(id, user.personaId);
  }

  /**
   * Actualizar un período contable de la empresa
   */
  @Put(':id')
  @ApiOperation({
    summary: 'Actualizar período contable de la empresa',
    description:
      'Actualiza un período contable existente de la empresa del usuario',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del período contable',
    type: 'number',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Período contable actualizado exitosamente',
    type: ResponsePeriodoContableDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Período contable no encontrado',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'No se puede modificar un período cerrado',
  })
  async actualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdatePeriodoContableDto,
  ): Promise<ResponsePeriodoContableDto> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene empresa asociada');
    }
    return this.periodoContableService.actualizarPorPersona(
      id,
      user.personaId,
      updateDto,
    );
  }

  /**
   * Cerrar un período contable de la empresa
   */
  @Put(':id/cerrar')
  @ApiOperation({
    summary: 'Cerrar período contable de la empresa',
    description:
      'Cierra un período contable de la empresa del usuario, impidiendo futuras modificaciones',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del período contable',
    type: 'number',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Período contable cerrado exitosamente',
    type: ResponsePeriodoContableDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Período contable no encontrado',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'El período ya está cerrado',
  })
  async cerrar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() cerrarDto: CerrarPeriodoDto,
  ): Promise<ResponsePeriodoContableDto> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene empresa asociada');
    }
    // Quien cierra es siempre el usuario autenticado
    cerrarDto.usuarioCierre = user.email;
    return this.periodoContableService.cerrarPorPersona(
      id,
      user.personaId,
      cerrarDto,
    );
  }

  /**
   * Reabrir un período contable de la empresa
   */
  @Put(':id/reabrir')
  @ApiOperation({
    summary: 'Reabrir período contable de la empresa',
    description: 'Reabre un período contable cerrado de la empresa del usuario',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del período contable',
    type: 'number',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Período contable reabierto exitosamente',
    type: ResponsePeriodoContableDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Período contable no encontrado',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'El período no está cerrado',
  })
  async reabrir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ResponsePeriodoContableDto> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene empresa asociada');
    }
    return this.periodoContableService.reabrirPorPersona(id, user.personaId);
  }

  /**
   * Eliminar un período contable de la empresa
   */
  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar período contable de la empresa',
    description:
      'Elimina un período contable de la empresa del usuario (solo si no está cerrado y no tiene comprobantes)',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del período contable',
    type: 'number',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Período contable eliminado exitosamente',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Período contable no encontrado',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'No se puede eliminar un período cerrado o con comprobantes',
  })
  async eliminar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene empresa asociada');
    }
    return this.periodoContableService.eliminarPorPersona(id, user.personaId);
  }

  /**
   * Validar fecha en período activo de la empresa
   */
  @Get('validar-fecha')
  @ApiOperation({
    summary: 'Validar fecha en período activo de la empresa',
    description:
      'Valida si una fecha está dentro del período activo de la empresa del usuario',
  })
  @ApiQuery({
    name: 'fecha',
    description: 'Fecha a validar (formato YYYY-MM-DD)',
    type: 'string',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resultado de la validación',
    schema: {
      type: 'object',
      properties: {
        valida: { type: 'boolean' },
        mensaje: { type: 'string' },
        periodo: { $ref: '#/components/schemas/ResponsePeriodoContableDto' },
      },
    },
  })
  async validarFechaEnPeriodoActivo(
    @CurrentUser() user: AuthenticatedUser,
    @Query('fecha') fecha: string,
  ) {
    if (!user.personaId) {
      throw new Error('Usuario no tiene empresa asociada');
    }
    const fechaValidar = new Date(fecha);
    return this.periodoContableService.validarFechaEnPeriodoActivo(
      user.personaId,
      fechaValidar,
    );
  }

  /**
   * Validar movimiento retroactivo de la empresa
   */
  @Get('validar-retroactivo')
  @ApiOperation({
    summary: 'Validar movimiento retroactivo de la empresa',
    description:
      'Valida si se permite un movimiento retroactivo según la configuración de la empresa del usuario',
  })
  @ApiQuery({
    name: 'fecha',
    description: 'Fecha del movimiento (formato YYYY-MM-DD)',
    type: 'string',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resultado de la validación',
    schema: {
      type: 'object',
      properties: {
        permitido: { type: 'boolean' },
        mensaje: { type: 'string' },
      },
    },
  })
  async validarMovimientoRetroactivo(
    @CurrentUser() user: AuthenticatedUser,
    @Query('fecha') fecha: string,
  ) {
    if (!user.personaId) {
      throw new Error('Usuario no tiene empresa asociada');
    }
    const fechaMovimiento = new Date(fecha);
    return this.periodoContableService.validarMovimientoRetroactivo(
      user.personaId,
      fechaMovimiento,
    );
  }

  /**
   * Actualizar método de valoración de inventario
   */
  @Put('configuracion/metodo-valoracion')
  @ApiOperation({
    summary: 'Actualizar método de valoración de inventario',
    description:
      'Actualiza el método de valoración de inventario en la configuración del período. Solo se permite si no hay movimientos en el período activo.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Método de valoración actualizado exitosamente',
    schema: {
      type: 'object',
      properties: {
        mensaje: { type: 'string' },
        metodoValoracion: {
          type: 'string',
          enum: Object.values(MetodoValoracion),
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'No se puede cambiar el método porque ya existen movimientos en el período activo',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No hay un período activo configurado',
  })
  async actualizarMetodoValoracion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() updateDto: UpdateMetodoValoracionDto,
  ) {
    if (!user.personaId) {
      throw new Error('Usuario no tiene empresa asociada');
    }

    const configuracionActualizada =
      await this.periodoContableService.actualizarMetodoValoracion(
        user.personaId,
        updateDto.metodoValoracion,
      );

    return {
      mensaje: 'Método de valoración actualizado exitosamente',
      metodoValoracion: configuracionActualizada.metodoCalculoCosto,
    };
  }
}
