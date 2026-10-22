import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { empresaDe } from 'src/common/empresa';
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
import { CurrentUser } from '../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../users/decorators/current-user.decorator';
import { PlanContableService } from './plan-contable.service';
import {
  ActualizarSubcuentaDto,
  CambiarPlanDto,
  CrearSubcuentaDto,
  ListarCuentasQuery,
} from './plan-contable.types';

@ApiTags('Plan contable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/plan-contable')
export class PlanContableController {
  constructor(private readonly plan: PlanContableService) {}

  @Get('planes')
  @ApiOperation({ summary: 'Planes contables oficiales disponibles' })
  planes() {
    return this.plan.planes();
  }

  @Get()
  @ApiOperation({ summary: 'Plan de la empresa y cuentas por elemento' })
  resumen(@CurrentUser() user: AuthenticatedUser) {
    return this.plan.resumen(empresaDe(user));
  }

  @Put()
  @ApiOperation({ summary: 'Cambiar el plan contable de la empresa' })
  cambiarPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CambiarPlanDto,
  ) {
    return this.plan.cambiarPlan(empresaDe(user), dto.idPlan);
  }

  @Get('cuentas')
  @ApiOperation({
    summary: 'Cuentas del plan (oficiales + propias), por elemento o búsqueda',
  })
  cuentas(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: ListarCuentasQuery,
  ) {
    return this.plan.cuentas(empresaDe(user), q);
  }

  @Get('cuentas/:codigo')
  @ApiOperation({ summary: 'Una cuenta con su ruta y sus subcuentas' })
  cuenta(
    @CurrentUser() user: AuthenticatedUser,
    @Param('codigo') codigo: string,
  ) {
    return this.plan.cuenta(empresaDe(user), codigo);
  }

  @Post('cuentas')
  @ApiOperation({ summary: 'Crear una subcuenta propia de la empresa' })
  crear(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CrearSubcuentaDto,
  ) {
    return this.plan.crearSubcuenta(empresaDe(user), dto);
  }

  @Patch('cuentas/:id')
  @ApiOperation({ summary: 'Renombrar o desactivar una subcuenta propia' })
  actualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarSubcuentaDto,
  ) {
    return this.plan.actualizarSubcuenta(empresaDe(user), id, dto);
  }
}
