import {
  Body,
  Controller,
  Headers,
  Post,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { AuthLoginDto } from '../dto/auth/auth-login.dto';
import { AuthResponseDto } from '../dto/auth/auth-response.dto';
import { PasswordResetRequestDto } from '../dto/auth/password-reset-request.dto';
import { ValidateResetTokenDto } from '../dto/auth/validate-reset-token.dto';
import { ResetPasswordDto } from '../dto/auth/reset-password.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

@ApiTags('Autenticación')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/login')
  @ApiOperation({ summary: 'Iniciar sesión' })
  @ApiResponse({ status: 200, description: 'Login exitoso' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  async create(
    @Body() authLoginDto: AuthLoginDto,
    @Headers('user-agent') agente?: string,
  ): Promise<AuthResponseDto> {
    return this.authService.login(authLoginDto, agente);
  }

  @Post('/request-password-reset')
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
