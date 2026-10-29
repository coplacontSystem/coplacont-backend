import {
  Body,
  Controller,
  Headers,
  Ip,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UserService } from '../services/user.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { AuthService } from '../services/auth.service';
import { AuthLoginDto } from '../dto/auth/auth-login.dto';
import { AuthResponseDto } from '../dto/auth/auth-response.dto';
import { PasswordResetRequestDto } from '../dto/auth/password-reset-request.dto';
import { ValidateResetTokenDto } from '../dto/auth/validate-reset-token.dto';
import { ResetPasswordDto } from '../dto/auth/reset-password.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Autenticación')
@UseGuards(ThrottlerGuard)
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UserService,
  ) {}

  @Post('/login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Iniciar sesión' })
  @ApiResponse({ status: 200, description: 'Login exitoso' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  @ApiResponse({
    status: 429,
    description: 'Demasiados intentos (por IP o por correo)',
  })
  async create(
    @Body() authLoginDto: AuthLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') agente?: string,
  ): Promise<AuthResponseDto> {
    return this.authService.login(authLoginDto, { ip, agente });
  }

  @Post('/cerrar-sesiones')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cierra la sesión en todos los dispositivos',
    description:
      'Invalida todos los tokens emitidos al usuario, incluido el actual.',
  })
  async cerrarSesiones(@CurrentUser() user: AuthenticatedUser) {
    await this.usersService.cerrarSesiones(user.id);
    return { message: 'Se cerraron todas las sesiones' };
  }

  @Post('/request-password-reset')
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicitar recuperación de contraseña' })
  @ApiResponse({ status: 200, description: 'Email de recuperación enviado' })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  @ApiBody({ type: PasswordResetRequestDto })
  async requestPasswordReset(
    @Body() passwordResetRequestDto: PasswordResetRequestDto,
  ) {
    return this.authService.requestPasswordReset(passwordResetRequestDto.email);
  }

  @Post('/validate-reset-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validar token de recuperación' })
  @ApiResponse({ status: 200, description: 'Token validado' })
  @ApiResponse({ status: 400, description: 'Token inválido o expirado' })
  @ApiBody({ type: ValidateResetTokenDto })
  async validateResetToken(
    @Body() validateResetTokenDto: ValidateResetTokenDto,
  ) {
    return this.authService.validateResetToken(validateResetTokenDto.token);
  }

  @Post('/reset-password')
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resetear contraseña' })
  @ApiResponse({
    status: 200,
    description: 'Contraseña actualizada exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Token inválido o datos incorrectos',
  })
  @ApiBody({ type: ResetPasswordDto })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(
      resetPasswordDto.token,
      resetPasswordDto.password,
    );
  }
}
