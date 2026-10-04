import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { RolEnum } from '../enums/RoleEnum';
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { EmailService } from '../services/email.service';
import { EmailOptions, EmailResponse } from '../../../config/email.config';
import {
  SendEmailDto,
  WelcomeEmailDto,
  PasswordResetEmailDto,
} from '../dto/email';

@ApiTags('Email')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolEnum.ADMIN)
@Controller('api/email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  /**
   * Envía un email personalizado
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar email personalizado' })
  @ApiResponse({ status: 200, description: 'Email enviado exitosamente' })
  @ApiResponse({ status: 400, description: 'Error en los datos enviados' })
  @ApiBody({ type: SendEmailDto })
  async sendEmail(@Body() sendEmailDto: SendEmailDto): Promise<EmailResponse> {
    const emailOptions: EmailOptions = {
      to: sendEmailDto.to,
      subject: sendEmailDto.subject,
      text: sendEmailDto.text,
      html: sendEmailDto.html,
    };

    return this.emailService.sendEmail(emailOptions);
  }

  /**
   * Envía un email de bienvenida
   */
  @Post('welcome')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar email de bienvenida' })
  @ApiResponse({
    status: 200,
    description: 'Email de bienvenida enviado exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Error en los datos enviados' })
  @ApiBody({ type: WelcomeEmailDto })
  async sendWelcomeEmail(
    @Body() welcomeEmailDto: WelcomeEmailDto,
  ): Promise<EmailResponse> {
    return this.emailService.sendWelcomeEmail(
      welcomeEmailDto.email,
      welcomeEmailDto.nombre,
    );
  }

  /**
   * Envía un email de recuperación de contraseña
   */
  @Post('password-reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar email de recuperación de contraseña' })
  @ApiResponse({
    status: 200,
    description: 'Email de recuperación enviado exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Error en los datos enviados' })
  @ApiBody({ type: PasswordResetEmailDto })
  async sendPasswordResetEmail(
    @Body() passwordResetDto: PasswordResetEmailDto,
  ): Promise<EmailResponse> {
    return this.emailService.sendPasswordResetEmail(
      passwordResetDto.email,
      passwordResetDto.resetToken,
    );
  }

  /**
   * Verifica la conexión del servicio de email
   */
  @Post('verify-connection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verificar conexión del servicio de email' })
  @ApiResponse({ status: 200, description: 'Estado de la conexión' })
  async verifyConnection(): Promise<{ connected: boolean }> {
    const connected = await this.emailService.verifyConnection();
    return { connected };
  }
}
