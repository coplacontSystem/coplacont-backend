import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { RolEnum } from '../enums/RoleEnum';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RoleService } from '../services/role.service';
import { ResponseRolDto } from '../dto/rol/response-rol.dto';
import { CreateRolDto } from '../dto/rol/create-rol.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolEnum.ADMIN)
@Controller('api/rol')
export class RolController {
  constructor(private readonly roleService: RoleService) {}

  @Get(':id')
  findById(@Param('id') id: number): Promise<ResponseRolDto> {
    return this.roleService.findById(id);
  }

  @Get()
  findAll(): Promise<ResponseRolDto[]> {
    return this.roleService.findAll();
  }

  @Post()
  create(@Body() createRolDto: CreateRolDto): Promise<ResponseRolDto> {
    return this.roleService.create(createRolDto);
  }
}
