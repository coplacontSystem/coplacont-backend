import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PCGE_2019 } from './data/pcge-2019';
import { naturalezaDe, nivelDe } from './plan-contable.reglas';

/** Carga los planes oficiales al iniciar; si ya están completos no hace nada */
@Injectable()
export class PlanContableSeed implements OnModuleInit {
  private readonly logger = new Logger(PlanContableSeed.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit() {
    try {
      await this.cargarPlan({
        codigo: 'PCGE2019',
        nombre: 'Plan Contable General Empresarial 2019',
        norma: 'Resolución N° 002-2019-EF/30',
        codigoSunat: '01',
        vigenteDesde: '2020-01-01',
        porDefecto: true,
        cuentas: PCGE_2019,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo cargar el plan contable: ${(error as Error).message}`,
      );
    }
  }

  private async cargarPlan(p: {
    codigo: string;
    nombre: string;
    norma: string;
    codigoSunat: string;
    vigenteDesde: string;
    porDefecto: boolean;
    cuentas: readonly (readonly [string, string])[];
  }) {
    const q = this.dataSource;
    await q.query(
      `INSERT INTO plan_contable (codigo, nombre, norma, codigo_sunat, vigente_desde, por_defecto)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (codigo) DO NOTHING`,
      [
        p.codigo,
        p.nombre,
        p.norma,
        p.codigoSunat,
        p.vigenteDesde,
        p.porDefecto,
      ],
    );
    const [plan]: { id: number }[] = await q.query(
      `SELECT id FROM plan_contable WHERE codigo = $1`,
      [p.codigo],
    );
    const idPlan = Number(plan.id);
    const existentes: { id: number; codigo: string }[] = await q.query(
      `SELECT id, codigo FROM cuenta_contable WHERE id_plan = $1 AND id_persona IS NULL`,
      [idPlan],
    );
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
