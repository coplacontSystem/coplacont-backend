import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { planesIncluidos, validarPlan } from './planes/plan-archivo';
import { PlanCargador } from './planes/plan-cargador';
import { EquivalenciasService } from './planes/equivalencias.service';

/**
 * Carga los planes oficiales de data/planes al iniciar (idempotente): crea
 * las cuentas que falten y actualiza los datos del plan. Después propone las
 * equivalencias entre planes que aún no las tengan.
 */
@Injectable()
export class PlanContableSeed implements OnModuleInit {
  private readonly logger = new Logger(PlanContableSeed.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly equivalencias: EquivalenciasService,
    private readonly cargador: PlanCargador,
  ) {}

  async onModuleInit() {
    for (const plan of planesIncluidos()) {
      const errores = validarPlan(plan);
      if (errores.length) {
        this.logger.error(
          `Plan ${plan.codigo} inválido: ${errores.slice(0, 5).join('; ')}`,
        );
        continue;
      }
      // Un plan actualizado desde el panel ya no sigue al archivo incluido
      const [actual] = await this.dataSource.query(
        `SELECT version FROM plan_contable WHERE codigo = $1`,
        [plan.codigo],
      );
      if (actual && Number(actual.version) > 1) continue;
      try {
        await this.cargador.cargar(plan);
      } catch (error) {
        this.logger.error(
          `No se pudo cargar el plan ${plan.codigo}: ${(error as Error).message}`,
        );
      }
    }
    try {
      await this.equivalencias.proponerFaltantes();
    } catch (error) {
      this.logger.error(
        `No se pudieron proponer equivalencias: ${(error as Error).message}`,
      );
    }
  }
}
