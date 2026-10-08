import { Pagina, PaginacionDto } from 'src/common/paginacion';
import { empresaDe } from 'src/common/empresa';
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiTags,
  ApiQuery,
  ApiExtraModels,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ComprobanteService } from '../service/comprobante.service';
import { CreateComprobanteDto } from '../dto/comprobante/create-comprobante.dto';
import { ResponseComprobanteDto } from '../dto/comprobante/response-comprobante.dto';
import { CreateComprobanteDetalleDto } from '../dto/comprobante-detalle/create-comprobante-detalle.dto';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';

@ApiTags('Comprobantes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiExtraModels(CreateComprobanteDetalleDto)
@Controller('api/comprobante')
export class ComprobanteController {
  constructor(private readonly comprobanteService: ComprobanteService) {}

  /**
   * Lista todos los comprobantes registrados de la empresa del usuario autenticado,
   * excluyendo los de tipo de operación COMPRA (idTablaDetalle: 13) y VENTA (idTablaDetalle: 12).
   * Incluye totales, entidad/persona, tipo de operación, tipo de comprobante y detalles.
   */
  @Get()
  @ApiOperation({
    summary: 'Listar comprobantes (excluye compra y venta)',
    description:
      'Devuelve todos los comprobantes registrados para la empresa asociada al usuario, EXCEPTO los de tipo de operación VENTA (idTablaDetalle: 12) y COMPRA (idTablaDetalle: 13). Incluye totales, entidad/persona, tipo de operación, tipo de comprobante y detalles.',
  })
  @ApiOkResponse({
    description: 'Lista de comprobantes obtenida exitosamente',
    type: ResponseComprobanteDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({ description: 'Token inválido o no proporcionado' })
  @ApiForbiddenResponse({
    description: 'El usuario no tiene acceso a este recurso',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() paginacion: PaginacionDto,
  ): Promise<ResponseComprobanteDto[] | Pagina<ResponseComprobanteDto>> {
    return this.comprobanteService.findAll(empresaDe(user), paginacion);
  }

  @Get('siguiente-correlativo')
  @ApiOperation({
    summary: 'Obtener el siguiente correlativo para un tipo de operación',
  })
  @ApiQuery({
    name: 'idTipoOperacion',
    description: 'ID del tipo de operación en TablaDetalle',
    type: Number,
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Siguiente correlativo obtenido exitosamente',
    schema: {
      type: 'object',
      properties: { correlativo: { type: 'string', example: 'corr-000001' } },
    },
  })
  @ApiResponse({ status: 400, description: 'Tipo de operación inválido' })
  getNextCorrelativo(
    @Query('idTipoOperacion') idTipoOperacion: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ correlativo: string }> {
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }

    const parsedIdTipoOperacion = parseInt(idTipoOperacion, 10);
    if (isNaN(parsedIdTipoOperacion)) {
      throw new Error('idTipoOperacion debe ser un número válido');
    }

    return this.comprobanteService.getNextCorrelativo(
      parsedIdTipoOperacion,
      user.personaId,
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Crear un nuevo comprobante',
    description:
      'Registra un comprobante. Si se envían detalles, los totales se calculan automáticamente. Si no hay detalles (comprobantes que no son venta ni compra), puede enviarse el campo `total` y se registrará como `totalGeneral` con el resto de campos en 0.',
  })
  @ApiBody({
    type: CreateComprobanteDto,
    examples: {
      operacionSinDetalles: {
        summary: 'Comprobante sin detalles (no venta/compra)',
        value: {
          idPersona: 2,
          idTipoOperacion: 23,
          idTipoComprobante: 2,
          fechaEmision: '2025-11-15',
          moneda: 'PEN',
          tipoCambio: 1,
          serie: 'F9320',
          numero: '032932',
          total: 100,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Comprobante creado exitosamente',
    type: ResponseComprobanteDto,
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  create(
    @Body() createComprobanteDto: CreateComprobanteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseComprobanteDto> {
    /**
     * Crea un comprobante para la empresa del usuario autenticado.
     * - Con detalles: calcula y guarda totales desde los detalles.
     * - Sin detalles: usa el campo `total` para registrar `totalGeneral`.
     */
    if (!user.personaId) {
      throw new Error('Usuario no tiene una empresa asociada');
    }
    return this.comprobanteService.register(
      createComprobanteDto,
      user.personaId,
    );
  }
}
