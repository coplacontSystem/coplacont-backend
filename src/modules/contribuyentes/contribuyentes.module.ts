import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from '../users/user.module';
import { ContribuyenteConsulta } from './contribuyente-consulta.entity';
import { ContribuyentesController } from './contribuyentes.controller';
import { ContribuyentesService } from './contribuyentes.service';
import { DecolectaCliente } from './decolecta.cliente';

/** Validación de RUC/DNI y consulta de sus datos (SUNAT y RENIEC vía Decolecta). */
@Module({
  imports: [
    TypeOrmModule.forFeature([ContribuyenteConsulta]),
    ConfigModule,
    UserModule,
  ],
  controllers: [ContribuyentesController],
  providers: [ContribuyentesService, DecolectaCliente],
  exports: [ContribuyentesService],
})
export class ContribuyentesModule {}
