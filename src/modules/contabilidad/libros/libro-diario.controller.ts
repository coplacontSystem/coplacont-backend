import {
  Controller,
  Get,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { empresaDe } from 'src/common/empresa';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';
import { LibroDiarioService } from './libro-diario.service';
import { PeriodoLibroDto } from './libro-diario.types';

@ApiTags('Libros contables')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/libros/diario')
export class LibroDiarioController {
  constructor(private readonly libros: LibroDiarioService) {}

  @Get()
  @ApiOperation({
    summary: 'Libro Diario del mes (asientos registrados con sus líneas)',
  })
  libro(@CurrentUser() user: AuthenticatedUser, @Query() q: PeriodoLibroDto) {
    return this.libros.libro(empresaDe(user), q.año, q.mes);
  }

  @Get('ple')
  @ApiOperation({
    summary: 'TXT del PLE, formato 5.2 (Libro Diario simplificado)',
  })
  async ple(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: PeriodoLibroDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { nombre, contenido } = await this.libros.ple(
      empresaDe(user),
      q.año,
      q.mes,
    );
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    return new StreamableFile(Buffer.from(contenido, 'utf8'));
  }
}
