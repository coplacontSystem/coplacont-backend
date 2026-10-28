import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { naturalezaDe, nivelDe } from './plan-contable.reglas';
import {
  PlanArchivo,
  planesIncluidos,
  validarPlan,
} from './planes/plan-archivo';
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
      try {
        await this.cargarPlan(plan);
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

  async cargarPlan(p: PlanArchivo) {
    const q = this.dataSource;
    await q.query(
      `INSERT INTO plan_contable
         (codigo, nombre, norma, codigo_sunat, vigente_desde, por_defecto,
          elementos, cuentas_sugeridas, nota)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (codigo) DO UPDATE
          SET nombre = EXCLUDED.nombre, norma = EXCLUDED.norma,
              codigo_sunat = EXCLUDED.codigo_sunat, elementos = EXCLUDED.elementos,
              cuentas_sugeridas = EXCLUDED.cuentas_sugeridas, nota = EXCLUDED.nota`,
      [
        p.codigo,
        p.nombre,
        p.norma,
        p.codigoSunat,
        p.vigenteDesde,
        p.porDefecto,
        JSON.stringify(p.elementos ?? {}),
        JSON.stringify(p.cuentasSugeridas ?? {}),
        p.nota ?? null,
      ],
    );
    const [plan]: { id: number }[] = await q.query(
      `SELECT id FROM plan_contable WHERE codigo = $1`,
      [p.codigo],
    );
    const idPlan = Number(plan.id);
    const existentes: { id: number; codigo: string; nombre: string }[] =
      await q.query(
        `SELECT id, codigo, nombre FROM cuenta_contable WHERE id_plan = $1 AND id_persona IS NULL`,
        [idPlan],
      );
    // Nombres corregidos en el archivo del plan
    const nombres = new Map(p.cuentas);
    for (const c of existentes) {
      const nuevo = nombres.get(c.codigo);
      if (nuevo && nuevo !== c.nombre) {
        await q.query(`UPDATE cuenta_contable SET nombre = $2 WHERE id = $1`, [
          c.id,
          nuevo,
        ]);
      }
    }
    if (existentes.length >= p.cuentas.length) return;

    // De nivel en nivel para que cada cuenta encuentre a su padre ya creado
    const ids = new Map(existentes.map((c) => [c.codigo, Number(c.id)]));
    const faltantes = p.cuentas
      .filter(([codigo]) => !ids.has(codigo))
      .sort((a, b) => a[0].length - b[0].length);
    for (const largo of [...new Set(faltantes.map(([c]) => c.length))]) {
      const lote = faltantes.filter(([c]) => c.length === largo);
      const filas = lote.map(([codigo, nombre]): unknown[] => {
        let padre: number | null = null;
        for (let n = codigo.length - 1; n >= 2 && padre == null; n--) {
          padre = ids.get(codigo.slice(0, n)) ?? null;
        }
        return [
          idPlan,
          codigo,
          nombre,
          nivelDe(codigo),
          codigo[0],
          naturalezaDe(codigo),
          padre,
        ];
      });
      const valores = filas
        .map(
          (_, i) =>
            `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7})`,
        )
        .join(', ');
      const creadas: { id: number; codigo: string }[] = await q.query(
        `INSERT INTO cuenta_contable (id_plan, codigo, nombre, nivel, elemento, naturaleza, id_padre)
         VALUES ${valores}
         ON CONFLICT DO NOTHING RETURNING id, codigo`,
        filas.flat(),
      );
      creadas.forEach((c) => ids.set(c.codigo, Number(c.id)));
    }
    this.logger.log(`Plan ${p.codigo}: ${faltantes.length} cuentas cargadas`);
  }
}
