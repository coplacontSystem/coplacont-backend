import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { empresaDe } from 'src/common/empresa';
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
import { CurrentUser } from '../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../users/decorators/current-user.decorator';
import { CuentaService } from './cuenta.service';
import {
  ActualizarEmpresaDto,
  ActualizarPerfilDto,
  CambiarContrasenaDto,
  CambiarCorreoDto,
  ImagenDto,
} from './cuenta.types';

@ApiTags('Mi cuenta')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/cuenta')
export class CuentaController {
  constructor(private readonly cuenta: CuentaService) {}

  @Get()
  @ApiOperation({ summary: 'Perfil del usuario autenticado' })
  perfil(@CurrentUser() user: AuthenticatedUser) {
    return this.cuenta.perfil(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Actualizar nombre, teléfono o cargo' })
  actualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ActualizarPerfilDto,
  ) {
    return this.cuenta.actualizarPerfil(user.id, dto);
  }

  @Patch('correo')
  @ApiOperation({ summary: 'Cambiar el correo (pide la contraseña actual)' })
  cambiarCorreo(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CambiarCorreoDto,
  ) {
    return this.cuenta.cambiarCorreo(user.id, dto);
  }

  @Patch('contrasena')
  @ApiOperation({ summary: 'Cambiar la contraseña' })
  cambiarContrasena(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CambiarContrasenaDto,
  ) {
    return this.cuenta.cambiarContrasena(user.id, dto);
  }

  @Put('avatar')
  @ApiOperation({ summary: 'Guardar la foto de perfil (data URL JPG/PNG)' })
  guardarAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImagenDto,
  ) {
    return this.cuenta.guardarAvatar(user.id, dto.imagen);
  }

  @Delete('avatar')
  @ApiOperation({ summary: 'Quitar la foto de perfil' })
  quitarAvatar(@CurrentUser() user: AuthenticatedUser) {
    return this.cuenta.guardarAvatar(user.id, null);
  }
}

@ApiTags('Mi cuenta')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/empresa')
export class EmpresaController {
  constructor(private readonly cuenta: CuentaService) {}

  @Get()
  @ApiOperation({ summary: 'Datos fiscales y logo de la empresa del usuario' })
  obtener(@CurrentUser() user: AuthenticatedUser) {
    return this.cuenta.empresa(empresaDe(user));
  }

  @Patch()
  @ApiOperation({
    summary: 'Actualizar los datos de la empresa (el RUC no cambia)',
  })
  actualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ActualizarEmpresaDto,
  ) {
    return this.cuenta.actualizarEmpresa(empresaDe(user), dto);
  }

  @Put('logo')
  @ApiOperation({ summary: 'Guardar el logo de la empresa (data URL JPG/PNG)' })
  guardarLogo(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImagenDto) {
    return this.cuenta.guardarLogo(empresaDe(user), dto.imagen);
  }

  @Delete('logo')
  @ApiOperation({ summary: 'Quitar el logo de la empresa' })
  quitarLogo(@CurrentUser() user: AuthenticatedUser) {
    return this.cuenta.guardarLogo(empresaDe(user), null);
  }
}
