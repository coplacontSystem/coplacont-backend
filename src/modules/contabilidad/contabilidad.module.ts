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
import { AreaContable } from './areas/area.entity';
import { AreaController } from './areas/area.controller';
import { AreaService } from './areas/area.service';
import { AsientoAutomaticoService } from './asientos/automatico/asiento-automatico.service';
import { ConfiguracionContable } from './asientos/automatico/cuentas-automaticas';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlanContable,
      CuentaContable,
      AsientoContable,
      AsientoLinea,
      AreaContable,
      ConfiguracionContable,
    ]),
    UserModule,
  ],
  controllers: [PlanContableController, AsientoController, AreaController],
  providers: [
    PlanContableService,
    PlanContableSeed,
    AsientoService,
    AreaService,
    AsientoAutomaticoService,
  ],
  exports: [
    PlanContableService,
    AsientoService,
    AreaService,
    AsientoAutomaticoService,
  ],
})
export class ContabilidadModule {}
