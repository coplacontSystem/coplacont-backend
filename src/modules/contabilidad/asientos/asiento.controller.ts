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
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';
import { AsientoService } from './asiento.service';
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
  constructor(private readonly asientos: AsientoService) {}

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
