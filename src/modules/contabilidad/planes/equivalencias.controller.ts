import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { RolesGuard } from '../../users/guards/roles.guard';
import { Roles } from '../../users/decorators/roles.decorator';
import { RolEnum } from '../../users/enums/RoleEnum';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';
import { ReportesService } from '../../reportes/reportes.service';
import { EquivalenciasService } from './equivalencias.service';
import { ParPlanesDto, RevisarEquivalenciaDto } from './equivalencias.types';

@ApiTags('Plan contable: equivalencias entre planes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/plan-contable/equivalencias')
export class EquivalenciasController {
  constructor(
    private readonly equivalencias: EquivalenciasService,
    private readonly reportes: ReportesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Equivalencias entre dos planes (p. ej. PCGE2019 → PCGE2026)',
  })
  @ApiQuery({ name: 'porRevisar', required: false })
  listar(@Query() q: ParPlanesDto, @Query('porRevisar') porRevisar?: string) {
    return this.equivalencias.listar(
      q.origen,
      q.destino,
      porRevisar === 'true',
    );
  }

  @Get('excel')
  @ApiOperation({ summary: 'Excel de la tabla de equivalencias para revisión' })
  async excel(
    @Query() q: ParPlanesDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.equivalencias.documento(q.origen, q.destino);
    const archivo = await this.reportes.exportarDocumento(doc, 'xlsx');
    res.set({
      'Content-Type': archivo.tipoContenido,
      'Content-Disposition': `attachment; filename="${archivo.nombreArchivo}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    return new StreamableFile(archivo.contenido);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(RolEnum.ADMIN)
  @ApiOperation({
    summary: 'Fijar la cuenta destino de una equivalencia (administrador)',
  })
  async revisar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RevisarEquivalenciaDto,
  ) {
    await this.equivalencias.revisar(
      id,
      { codigoDestino: dto.codigoDestino ?? null, nota: dto.nota },
      user.nombre,
    );
    return { ok: true };
  }
}
