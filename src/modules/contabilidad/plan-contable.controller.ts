import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { MigracionPlanService } from './planes/migracion-plan.service';
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
  constructor(
    private readonly plan: PlanContableService,
    private readonly migracion: MigracionPlanService,
  ) {}

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

  @Post('cambio/previsualizar')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Qué pasaría al cambiar de plan desde un período: cuentas, subcuentas, áreas y errores',
  })
  previsualizarCambio(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CambiarPlanDto,
  ) {
    return this.migracion.previsualizar(empresaDe(user), dto);
  }

  @Put()
  @ApiOperation({
    summary:
      'Cambiar el plan de la empresa desde un período (los anteriores conservan el suyo)',
  })
  cambiarPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CambiarPlanDto,
  ) {
    return this.migracion.migrar(empresaDe(user), dto);
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
