import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { empresaDe } from 'src/common/empresa';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { CurrentUser } from '../../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../users/decorators/current-user.decorator';
import { AreaService } from './area.service';
import { ActualizarAreaDto, GuardarAreaDto } from './area.types';

@ApiTags('Áreas (centros de costo)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/areas')
export class AreaController {
  constructor(private readonly areas: AreaService) {}

  @Get()
  @ApiOperation({
    summary:
      'Áreas de la empresa (crea Administración, Ventas y Producción la primera vez)',
  })
  listar(@CurrentUser() user: AuthenticatedUser) {
    return this.areas.listar(empresaDe(user));
  }

  @Post()
  @ApiOperation({ summary: 'Crear un área con su cuenta de destino (clase 9)' })
  crear(@CurrentUser() user: AuthenticatedUser, @Body() dto: GuardarAreaDto) {
    return this.areas.crear(empresaDe(user), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renombrar, cambiar destino o desactivar un área' })
  actualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarAreaDto,
  ) {
    return this.areas.actualizar(empresaDe(user), id, dto);
  }
}
