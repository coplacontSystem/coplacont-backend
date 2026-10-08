import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { empresaDe } from 'src/common/empresa';
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
import { CurrentUser } from '../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../users/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';
import {
  Dashboard,
  DashboardQueryDto,
  InventarioAlQueryDto,
} from './dashboard.types';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Datos de la portada de la empresa para un mes (YYYY-MM)',
  })
  obtener(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ): Promise<Dashboard> {
    return this.dashboard.obtener(empresaDe(user), query.periodo);
  }

  @Get('inventario')
  @ApiOperation({ summary: 'Valor del inventario al cierre de una fecha' })
  inventarioAl(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: InventarioAlQueryDto,
  ) {
    return this.dashboard.inventarioAl(empresaDe(user), query.fecha);
  }
}
