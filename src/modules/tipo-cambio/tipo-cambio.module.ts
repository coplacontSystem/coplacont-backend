import { UserModule } from '../users/user.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { TipoCambio } from './entities/tipo-cambio.entity';
import { TipoCambioService } from './service/tipo-cambio.service';
import { TipoCambioController } from './controller/tipo-cambio.controller';
import { TipoCambioCronService } from './service/tipo-cambio-cron.service';

/**
 * Módulo para gestionar tipos de cambio de SUNAT
 */
@Module({
  imports: [TypeOrmModule.forFeature([TipoCambio]), ConfigModule, UserModule],
  controllers: [TipoCambioController],
  providers: [TipoCambioService, TipoCambioCronService],
  exports: [TipoCambioService], // Exportar el servicio para uso en otros módulos
})
export class TipoCambioModule {}
