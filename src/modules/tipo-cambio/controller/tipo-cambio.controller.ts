import { Controller, Get, Query, Logger, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { TipoCambioService } from '../service/tipo-cambio.service';
import {
  TipoCambioQueryDto,
  TipoCambioResponseDto,
} from '../dto/tipo-cambio.dto';
import { ApiResponseDto } from '../../entidades/dto/api-response.dto';

@ApiTags('Tipo de Cambio')
@UseGuards(JwtAuthGuard)
@Controller('/api/tipo-cambio')
export class TipoCambioController {
  private readonly logger = new Logger(TipoCambioController.name);

  constructor(private readonly tipoCambioService: TipoCambioService) {}

  @Get('sunat')
  @ApiOperation({
    summary: 'Obtener tipo de cambio de SUNAT',
    description:
      'Obtiene el tipo de cambio para una fecha específica. Si no se proporciona fecha, usa la fecha actual. Primero consulta la base de datos, si no existe consulta el API de SUNAT.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Fecha en formato YYYY-MM-DD',
    example: '2023-05-01',
  })
  @ApiResponse({
    status: 200,
    description: 'Tipo de cambio obtenido exitosamente',
    type: TipoCambioResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Fecha inválida o futura',
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontraron datos para la fecha especificada',
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor',
  })
  async obtenerTipoCambio(
    @Query() query: TipoCambioQueryDto,
  ): Promise<ApiResponseDto<TipoCambioResponseDto>> {
    this.logger.log(
      `Consultando tipo de cambio para fecha: ${query.date || 'hoy'}`,
    );
    return await this.tipoCambioService.obtenerTipoCambio(query.date);
  }

  @Get('todos')
  @ApiOperation({
    summary: 'Obtener todos los tipos de cambio',
    description:
      'Obtiene todos los tipos de cambio almacenados en la base de datos (ordenados por fecha descendente)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de tipos de cambio obtenida exitosamente',
    type: [TipoCambioResponseDto],
  })
  async obtenerTodos(): Promise<ApiResponseDto<TipoCambioResponseDto[]>> {
    this.logger.log('Consultando todos los tipos de cambio almacenados');
    return await this.tipoCambioService.obtenerTodos();
  }

  @Get('actualizar-diario')
  @ApiOperation({
    summary: 'Actualizar tipo de cambio diario',
    description:
      'Fuerza la actualización del tipo de cambio del día actual desde el API de SUNAT',
  })
  @ApiResponse({
    status: 200,
    description: 'Tipo de cambio actualizado exitosamente',
  })
  async actualizarTipoCambioDiario(): Promise<
    ApiResponseDto<TipoCambioResponseDto>
  > {
    this.logger.log('Forzando actualización del tipo de cambio diario');
    return await this.tipoCambioService.actualizarTipoCambioDiario();
  }
}
