import {
  Controller,
  Get,
  Query,
  ValidationPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { KardexService } from '../service/kardex.service';
import { KardexRequestDto, KardexResponseDto } from '../dto';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';
import { PertenenciaService } from '../../../common/pertenencia.service';
import { empresaDe } from '../../../common/empresa';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';

@ApiTags('Kardex')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/kardex')
export class KardexController {
  constructor(
    private readonly kardexService: KardexService,
    private readonly pertenencia: PertenenciaService,
  ) {}

  /**
   * Genera el reporte Kardex para un inventario específico
   */
  @Get()
  @ApiOperation({
    summary: 'Generar reporte Kardex',
    description:
      'Muestra el detalle de movimientos y saldos del producto seleccionado, incluyendo inventario inicial (cantidad y costo total). El personaId se obtiene automáticamente del usuario autenticado.',
  })
  @ApiQuery({
    name: 'idInventario',
    description: 'ID del inventario para generar el kardex',
    example: 1,
    type: Number,
  })
  @ApiQuery({
    name: 'fechaInicio',
    description: 'Fecha de inicio del reporte (opcional)',
    example: '2024-01-01',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'fechaFin',
    description: 'Fecha de fin del reporte (opcional)',
    example: '2024-12-31',
    required: false,
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Reporte Kardex generado exitosamente',
    type: KardexResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Parámetros inválidos',
  })
  @ApiResponse({
    status: 404,
    description:
      'No se encontraron movimientos para el inventario especificado',
  })
  async generateKardex(
    @Query(new ValidationPipe({ transform: true })) query: KardexRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<KardexResponseDto> {
    // La empresa siempre sale del token, nunca del query
    query.personaId = empresaDe(user);
    await this.pertenencia.inventarios(
      [Number(query.idInventario)],
      query.personaId,
    );

    return await this.kardexService.generateKardexReport(query);
  }
}
