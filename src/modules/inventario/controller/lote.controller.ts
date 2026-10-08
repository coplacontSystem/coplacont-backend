import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { LoteService } from '../service/lote.service';
import { ResponseLoteDto } from '../dto/lote/response-lote.dto';
import { plainToInstance } from 'class-transformer';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';
import { PertenenciaService } from '../../../common/pertenencia.service';
import { empresaDe } from '../../../common/empresa';

@UseGuards(JwtAuthGuard)
@Controller('api/lotes')
export class LoteController {
  constructor(
    private readonly loteService: LoteService,
    private readonly pertenencia: PertenenciaService,
  ) {}

  /**
   * Obtener lotes por inventario
   */
  @Get('inventario/:idInventario')
  async getLotesByInventario(
    @Param('idInventario', ParseIntPipe) idInventario: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseLoteDto[]> {
    await this.pertenencia.inventarios([idInventario], empresaDe(user));
    const lotes = await this.loteService.findLotesByInventario(idInventario);
    return plainToInstance(ResponseLoteDto, lotes, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Obtener lotes disponibles por inventario
   */
  @Get('inventario/:idInventario/disponibles')
  async getLotesDisponibles(
    @Param('idInventario', ParseIntPipe) idInventario: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseLoteDto[]> {
    await this.pertenencia.inventarios([idInventario], empresaDe(user));
    const lotes = await this.loteService.findLotesDisponibles(idInventario);
    return plainToInstance(ResponseLoteDto, lotes, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Obtener lotes recientes (últimos 10)
   */
  @Get('recientes')
  async getLotesRecientes(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseLoteDto[]> {
    const lotes = await this.loteService.findLotesRecientes(empresaDe(user));
    return plainToInstance(ResponseLoteDto, lotes, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Obtener lote por ID
   */
  @Get(':id')
  async getLoteById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponseLoteDto | null> {
    await this.pertenencia.lotes([id], empresaDe(user));
    const lote = await this.loteService.findLoteById(id);
    return lote
      ? plainToInstance(ResponseLoteDto, lote, {
          excludeExtraneousValues: true,
        })
      : null;
  }
}
