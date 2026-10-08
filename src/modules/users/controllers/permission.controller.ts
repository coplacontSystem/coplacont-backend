import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { RolEnum } from '../enums/RoleEnum';
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ResponsePermissionDto } from '../dto/permission/response-permission.dto';
import { PermissionService } from '../services/permission.service';
import { CreatePermissionDto } from '../dto/permission/create-permission.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolEnum.ADMIN)
@Controller('api/permission')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  findAll(): Promise<ResponsePermissionDto[]> {
    return this.permissionService.findAll();
  }

  @Post()
  create(
    @Body() createPermissionDto: CreatePermissionDto,
  ): Promise<ResponsePermissionDto> {
    return this.permissionService.create(createPermissionDto);
  }
}
