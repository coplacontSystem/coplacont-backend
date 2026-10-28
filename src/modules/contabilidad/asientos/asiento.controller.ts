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
  HttpCode,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { empresaDe } from 'src/common/empresa';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';
import { AsientoService } from './asiento.service';
import { AsientoAutomaticoService } from './automatico/asiento-automatico.service';
import {
  CuentasAutomaticasDto,
  GenerarAsientosDto,
} from './automatico/asiento-automatico.types';
import {
  AnularAsientoDto,
  GuardarAsientoDto,
  ListarAsientosQuery,
} from './asiento.types';

@ApiTags('Asientos contables')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/asientos')
export class AsientoController {
  constructor(
    private readonly asientos: AsientoService,
    private readonly automaticos: AsientoAutomaticoService,
  ) {}

  @Get('automaticos/cuentas')
  @ApiOperation({
    summary: 'Cuentas que usan los asientos de compras y ventas',
  })
  cuentasAutomaticas(@CurrentUser() user: AuthenticatedUser) {
    return this.automaticos.vistaCuentas(empresaDe(user));
  }

  @Put('automaticos/cuentas')
  @ApiOperation({ summary: 'Cambiar las cuentas de los asientos automáticos' })
  guardarCuentasAutomaticas(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CuentasAutomaticasDto,
  ) {
    return this.automaticos.guardarCuentas(empresaDe(user), dto);
  }

  @Post('automaticos/generar')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Genera o actualiza los asientos de las compras y ventas entre dos fechas',
  })
  generarAutomaticos(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerarAsientosDto,
  ) {
    return this.automaticos.generarRango(
      empresaDe(user),
      dto.desde,
      dto.hasta,
      user.nombre,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Asientos de la empresa (paginado, con filtros)' })
  listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: ListarAsientosQuery,
  ) {
    return this.asientos.listar(empresaDe(user), q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Un asiento con sus líneas' })
  detalle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.asientos.detalle(empresaDe(user), id);
  }

  @Post()
  @ApiOperation({ summary: 'Registrar un asiento manual' })
  crear(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GuardarAsientoDto,
  ) {
    return this.asientos.crear(empresaDe(user), dto, user.nombre);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Modificar un asiento manual (periodo abierto)' })
  editar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GuardarAsientoDto,
  ) {
    return this.asientos.editar(empresaDe(user), id, dto, user.nombre);
  }

  @Patch(':id/anular')
  @ApiOperation({ summary: 'Anular un asiento manual (conserva su número)' })
  anular(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AnularAsientoDto,
  ) {
    return this.asientos.anular(empresaDe(user), id, dto.motivo, user.nombre);
  }
}
