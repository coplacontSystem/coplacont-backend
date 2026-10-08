import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { RolEnum } from '../enums/RoleEnum';
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RolePermissionService } from '../services/role-permission.service';
import { CreateRolPermissionDto } from '../dto/role-permission/CreateRolPermission.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolEnum.ADMIN)
@Controller('api/role-permission')
export class RolePermissionController {
  constructor(private readonly rolePermissionService: RolePermissionService) {}

  @Post()
  create(
    @Body() createRolPermissionDto: CreateRolPermissionDto,
  ): Promise<void> {
    return this.rolePermissionService.create(createRolPermissionDto);
  }
}
