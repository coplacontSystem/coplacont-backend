import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { empresaDe } from 'src/common/empresa';
import { JwtAuthGuard } from '../users/guards/jwt-auth.guard';
import { CurrentUser } from '../users/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../users/decorators/current-user.decorator';
import { ImportacionService } from './importacion.service';
import { PrevisualizarDto, RegistrarDto } from './importacion.types';

@ApiTags('Importación de comprobantes (XML)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/importacion')
export class ImportacionController {
  constructor(private readonly importacion: ImportacionService) {}

  @Post('cpe/previsualizar')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Lee los XML y dice qué se registrará: compra o venta, errores, avisos y productos sugeridos',
  })
  previsualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PrevisualizarDto,
  ) {
    return this.importacion.previsualizar(empresaDe(user), dto);
  }

  @Post('cpe/registrar')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Registra cada XML con las líneas ya resueltas; devuelve el resultado por archivo',
  })
  registrar(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegistrarDto) {
    return this.importacion.registrar(empresaDe(user), dto);
  }

  @Get('equivalencias')
  @ApiOperation({ summary: 'Productos y servicios recordados por emisor' })
  equivalencias(@CurrentUser() user: AuthenticatedUser) {
    return this.importacion.listarEquivalencias(empresaDe(user));
  }

  @Delete('equivalencias/:id')
  @ApiOperation({ summary: 'Olvidar una equivalencia' })
  olvidar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.importacion.eliminarEquivalencia(empresaDe(user), id);
  }
}
