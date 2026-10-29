import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
import { ContribuyentesService } from './contribuyentes.service';

@ApiTags('Contribuyentes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/contribuyentes')
export class ContribuyentesController {
  constructor(private readonly service: ContribuyentesService) {}

  @Get(':numero')
  @ApiOperation({
    summary: 'Valida un RUC o DNI y trae sus datos de SUNAT/RENIEC',
  })
  consultar(@Param('numero') numero: string) {
    return this.service.consultar(numero.trim());
  }
}
