import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { RolEnum } from '../enums/RoleEnum';
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRolService } from '../services/user-role.service';
import { CreateUserRoleDto } from '../dto/user-role/create-user-role.dto';
import { ResponseUserRolDto } from '../dto/user-role/response-user-role.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolEnum.ADMIN)
@Controller('api/user-role')
export class UserRoleController {
  constructor(private readonly userRolService: UserRolService) {}

  @Get()
  findAll(): Promise<ResponseUserRolDto[]> {
    return this.userRolService.findAll();
  }

  @Post()
  create(@Body() createUserRolDto: CreateUserRoleDto): Promise<void> {
    return this.userRolService.create(createUserRolDto);
  }
}
