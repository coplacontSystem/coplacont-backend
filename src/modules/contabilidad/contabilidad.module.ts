import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from '../users/user.module';
import { PlanContable } from './entities/plan-contable.entity';
import { CuentaContable } from './entities/cuenta-contable.entity';
import { PlanContableController } from './plan-contable.controller';
import { PlanContableService } from './plan-contable.service';
import { PlanContableSeed } from './plan-contable.seed';
import { AsientoContable } from './asientos/asiento.entity';
import { AsientoLinea } from './asientos/asiento-linea.entity';
import { AsientoController } from './asientos/asiento.controller';
import { AsientoService } from './asientos/asiento.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlanContable,
      CuentaContable,
      AsientoContable,
      AsientoLinea,
    ]),
    UserModule,
  ],
  controllers: [PlanContableController, AsientoController],
  providers: [PlanContableService, PlanContableSeed, AsientoService],
  exports: [PlanContableService, AsientoService],
})
export class ContabilidadModule {}
