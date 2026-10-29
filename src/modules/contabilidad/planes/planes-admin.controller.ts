import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../users/guards/jwt-auth.guard';
import { RolesGuard } from '../../users/guards/roles.guard';
import { Roles } from '../../users/decorators/roles.decorator';
import { RolEnum } from '../../users/enums/RoleEnum';
import { PlanesAdminService } from './planes-admin.service';
import { ImportarPlanDto } from './planes-admin.types';

@ApiTags('Administración: planes de cuentas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolEnum.ADMIN)
@Controller('api/admin/planes-contables')
export class PlanesAdminController {
  constructor(private readonly planes: PlanesAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'Planes de cuentas con su versión, cuentas y empresas que lo usan',
  })
  listar() {
    return this.planes.listar();
  }

  @Post('previsualizar')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Valida el archivo y muestra las diferencias, sin guardar',
  })
  previsualizar(@Body() dto: ImportarPlanDto) {
    return this.planes.previsualizar(dto);
  }

  @Post('publicar')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Guarda el plan nuevo o la actualización y propone equivalencias',
  })
  publicar(@Body() dto: ImportarPlanDto) {
    return this.planes.publicar(dto);
  }
}
