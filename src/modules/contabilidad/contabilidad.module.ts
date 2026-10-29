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
import { ReportesModule } from '../reportes/reportes.module';
import { LibroDiarioService } from './libros/libro-diario.service';
import { LibroDiarioReporte } from './libros/libro-diario.reporte';
import { LibroDiarioController } from './libros/libro-diario.controller';
import { CuentaEquivalencia } from './planes/equivalencia.entity';
import { EquivalenciasService } from './planes/equivalencias.service';
import { EquivalenciasController } from './planes/equivalencias.controller';
import { PlanCargador } from './planes/plan-cargador';
import { PlanesAdminService } from './planes/planes-admin.service';
import { MigracionPlanService } from './planes/migracion-plan.service';
import { PlanesAdminController } from './planes/planes-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlanContable,
      CuentaContable,
      AsientoContable,
      AsientoLinea,
      AreaContable,
      ConfiguracionContable,
      CuentaEquivalencia,
    ]),
    UserModule,
    ReportesModule,
  ],
  controllers: [
    PlanContableController,
    AsientoController,
    AreaController,
    LibroDiarioController,
    EquivalenciasController,
    PlanesAdminController,
  ],
  providers: [
    PlanContableService,
    PlanContableSeed,
    AsientoService,
    AreaService,
    AsientoAutomaticoService,
    LibroDiarioService,
    LibroDiarioReporte,
    EquivalenciasService,
    PlanCargador,
    PlanesAdminService,
    MigracionPlanService,
  ],
  exports: [
    PlanContableService,
    AsientoService,
    AreaService,
    AsientoAutomaticoService,
  ],
})
export class ContabilidadModule {}
