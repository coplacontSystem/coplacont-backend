import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
import { CatalogosService } from './catalogos.service';
import { TIPOS_EXISTENCIA, UNIDADES } from './tablas-sunat';

@ApiTags('Catálogos SUNAT')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/catalogos')
export class CatalogosController {
  constructor(private readonly catalogos: CatalogosService) {}

  @Get('ccnu')
  @ApiOperation({
    summary: 'Buscar en el catálogo CCNU (UNSPSC v14) por código o nombre',
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({
    name: 'padre',
    required: false,
    description: 'Lista los hijos de un código',
  })
  buscar(@Query('q') q?: string, @Query('padre') padre?: string) {
    return this.catalogos.buscarCcnu(q, padre);
  }

  @Get('ccnu/:codigo')
  @ApiOperation({ summary: 'Un código CCNU con su segmento, familia y clase' })
  ccnu(@Param('codigo') codigo: string) {
    return this.catalogos.ccnu(codigo);
  }

  @Get('tipos-existencia')
  @ApiOperation({ summary: 'Tabla 5 de SUNAT: tipos de existencia' })
  tiposExistencia() {
    return TIPOS_EXISTENCIA;
  }

  @Get('unidades')
  @ApiOperation({ summary: 'Tabla 6 de SUNAT: unidades de medida (UN/ECE)' })
  unidades() {
    return UNIDADES;
  }
}
