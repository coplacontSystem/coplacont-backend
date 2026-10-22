import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from '../users/user.module';
import { PlanContable } from './entities/plan-contable.entity';
import { CuentaContable } from './entities/cuenta-contable.entity';
import { PlanContableController } from './plan-contable.controller';
import { PlanContableService } from './plan-contable.service';
import { PlanContableSeed } from './plan-contable.seed';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlanContable, CuentaContable]),
    UserModule,
  ],
  controllers: [PlanContableController],
  providers: [PlanContableService, PlanContableSeed],
  exports: [PlanContableService],
})
export class ContabilidadModule {}
