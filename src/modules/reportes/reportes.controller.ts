import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { empresaDe } from 'src/common/empresa';
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
import { CurrentUser } from '../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../users/decorators/current-user.decorator';
import { FORMATOS, ReportesService } from './reportes.service';

@ApiTags('Reportes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/reportes')
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  @Get()
  @ApiOperation({ summary: 'Reportes exportables disponibles' })
  disponibles(): { reportes: string[]; formatos: string[] } {
    return { reportes: this.reportes.disponibles(), formatos: FORMATOS };
  }

  @Get(':clave')
  @ApiOperation({
    summary: 'Exportar un reporte',
    description:
      'Descarga el reporte en el formato pedido. Los demás parámetros de la query son los filtros de cada reporte.',
  })
  @ApiParam({ name: 'clave', description: 'Reporte (ver GET /api/reportes)' })
  @ApiQuery({ name: 'formato', enum: FORMATOS })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/pdf',
  )
  async exportar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clave') clave: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { formato, ...filtros } = query;
    const archivo = await this.reportes.exportar(
      clave,
      typeof formato === 'string' ? formato : '',
      empresaDe(user),
      filtros,
    );
    res.set({
      'Content-Type': archivo.tipoContenido,
      'Content-Disposition': `attachment; filename="${archivo.nombreArchivo}"`,
    });
    return new StreamableFile(archivo.contenido);
  }
}
