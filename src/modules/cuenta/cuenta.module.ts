import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from '../users/user.module';
import { User } from '../users/entities/user.entity';
import { Persona } from '../users/entities/persona.entity';
import { CuentaController, EmpresaController } from './cuenta.controller';
import { CuentaService } from './cuenta.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Persona]), UserModule],
  controllers: [CuentaController, EmpresaController],
  providers: [CuentaService],
})
export class CuentaModule {}
