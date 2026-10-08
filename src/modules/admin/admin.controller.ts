import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
import { RolesGuard } from '../users/guards/roles.guard';
import { Roles } from '../users/decorators/roles.decorator';
import { RolEnum } from '../users/enums/RoleEnum';
import { AdminService } from './admin.service';
import { AdminDashboard, EmpresaDetalle } from './admin.types';

@ApiTags('Administración')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolEnum.ADMIN)
@Controller('api/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Panel del administrador: empresas, usuarios y actividad (sin montos)',
  })
  dashboard(): Promise<AdminDashboard> {
    return this.admin.dashboard();
  }

  @Get('empresas/:id')
  @ApiOperation({ summary: 'Detalle de una empresa para el administrador' })
  empresa(@Param('id', ParseIntPipe) id: number): Promise<EmpresaDetalle> {
    return this.admin.empresa(id);
  }
}
