import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { naturalezaDe, nivelDe } from '../plan-contable.reglas';
import type { PlanArchivo } from './plan-archivo';

/**
 * Carga o actualiza un plan de cuentas en la base: crea las cuentas que
 * faltan, corrige nombres y (al actualizar) desactiva las que el plan ya no
 * trae. Lo usan el arranque (planes incluidos) y la importación del panel.
 */
@Injectable()
export class PlanCargador {
  private readonly logger = new Logger(PlanCargador.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * @param desactivarFaltantes al actualizar un plan: las cuentas oficiales
   *   que el archivo ya no trae quedan inactivas (no se borran).
   * @returns cuántas cuentas se crearon, renombraron y desactivaron
   */
  async cargar(
    p: PlanArchivo,
    opciones: {
      origen?: 'incluido' | 'importado';
      desactivarFaltantes?: boolean;
    } = {},
  ) {
    const resultado = { creadas: 0, renombradas: 0, desactivadas: 0 };
    const q = this.dataSource;
    await q.query(
      `INSERT INTO plan_contable
         (codigo, nombre, norma, codigo_sunat, vigente_desde, por_defecto,
          elementos, cuentas_sugeridas, nota, origen, areas_sugeridas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (codigo) DO UPDATE
          SET nombre = EXCLUDED.nombre, norma = EXCLUDED.norma,
              codigo_sunat = EXCLUDED.codigo_sunat, elementos = EXCLUDED.elementos,
              cuentas_sugeridas = EXCLUDED.cuentas_sugeridas, nota = EXCLUDED.nota,
              areas_sugeridas = EXCLUDED.areas_sugeridas`,
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
        opciones.origen ?? 'incluido',
        JSON.stringify(p.areasSugeridas ?? []),
      ],
    );
    const [plan]: { id: number }[] = await q.query(
      `SELECT id FROM plan_contable WHERE codigo = $1`,
      [p.codigo],
    );
    const idPlan = Number(plan.id);
    const existentes: {
      id: number;
      codigo: string;
      nombre: string;
      activa: boolean;
    }[] = await q.query(
      `SELECT id, codigo, nombre, activa FROM cuenta_contable WHERE id_plan = $1 AND id_persona IS NULL`,
      [idPlan],
    );
    // Nombres corregidos y cuentas que vuelven a estar en el plan
    const nombres = new Map(p.cuentas);
    for (const c of existentes) {
      const nuevo = nombres.get(c.codigo);
      if (nuevo && (nuevo !== c.nombre || !c.activa)) {
        await q.query(
          `UPDATE cuenta_contable SET nombre = $2, activa = true WHERE id = $1`,
          [c.id, nuevo],
        );
        if (nuevo !== c.nombre) resultado.renombradas++;
      }
    }
    // Las que el plan ya no trae quedan inactivas (pueden tener movimientos)
    if (opciones.desactivarFaltantes) {
      const quitar = existentes
        .filter((c) => c.activa && !nombres.has(c.codigo))
        .map((c) => c.id);
      if (quitar.length) {
        await q.query(
          `UPDATE cuenta_contable SET activa = false WHERE id = ANY($1)`,
          [quitar],
        );
        resultado.desactivadas = quitar.length;
      }
    }

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
      resultado.creadas += creadas.length;
    }
    if (resultado.creadas || resultado.renombradas || resultado.desactivadas) {
      this.logger.log(
        `Plan ${p.codigo}: ${resultado.creadas} creadas, ${resultado.renombradas} renombradas, ${resultado.desactivadas} desactivadas`,
      );
    }
    return { idPlan, ...resultado };
  }
}
