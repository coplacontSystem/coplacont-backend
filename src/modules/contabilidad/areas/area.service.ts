import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PlanContableService } from '../plan-contable.service';
import type {
  ActualizarAreaDto,
  AreaVista,
  GuardarAreaDto,
} from './area.types';

type Fila = Record<string, any>;

@Injectable()
export class AreaService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly plan: PlanContableService,
  ) {}

  async listar(personaId: number): Promise<AreaVista[]> {
    const [hay] = await this.dataSource.query(
      `SELECT 1 FROM area_contable WHERE id_persona = $1 LIMIT 1`,
      [personaId],
    );
    if (!hay) await this.crearPorDefecto(personaId);

    const plan = await this.plan.planDe(personaId);
    const filas: Fila[] = await this.dataSource.query(
      `SELECT a.id, a.nombre, a.cuenta_destino, a.activa, c.nombre AS nombre_cuenta
         FROM area_contable a
         LEFT JOIN cuenta_contable c
                ON c.codigo = a.cuenta_destino AND c.id_plan = $2
               AND (c.id_persona IS NULL OR c.id_persona = a.id_persona)
        WHERE a.id_persona = $1
        ORDER BY a.activa DESC, a.nombre`,
      [personaId, plan.id],
    );
    return filas.map((f) => ({
      id: Number(f.id),
      nombre: f.nombre,
      cuentaDestino: f.cuenta_destino ?? null,
      nombreCuentaDestino: f.nombre_cuenta ?? null,
      activa: Boolean(f.activa),
    }));
  }

  async crear(personaId: number, dto: GuardarAreaDto) {
    if (dto.cuentaDestino)
      await this.validarDestino(personaId, dto.cuentaDestino);
    try {
      await this.dataSource.query(
        `INSERT INTO area_contable (id_persona, nombre, cuenta_destino) VALUES ($1, $2, $3)`,
        [personaId, dto.nombre, dto.cuentaDestino ?? null],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException(`Ya existe el área ${dto.nombre}`);
      }
      throw e;
    }
    return this.listar(personaId);
  }

  async actualizar(personaId: number, id: number, dto: ActualizarAreaDto) {
    await this.obtener(personaId, id);
    if (dto.cuentaDestino)
      await this.validarDestino(personaId, dto.cuentaDestino);
    try {
      await this.dataSource.query(
        `UPDATE area_contable
            SET nombre = COALESCE($3, nombre),
                cuenta_destino = CASE WHEN $4::boolean THEN $5 ELSE cuenta_destino END,
                activa = COALESCE($6, activa)
          WHERE id = $1 AND id_persona = $2`,
        [
          id,
          personaId,
          dto.nombre ?? null,
          dto.cuentaDestino !== undefined,
          dto.cuentaDestino ?? null,
          dto.activa ?? null,
        ],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException(`Ya existe el área ${dto.nombre}`);
      }
      throw e;
    }
    return this.listar(personaId);
  }

  /** Área activa de la empresa; falla si no existe o es de otra empresa */
  async obtener(personaId: number, id: number) {
    const [a] = await this.dataSource.query(
      `SELECT id, nombre, cuenta_destino, activa FROM area_contable
        WHERE id = $1 AND id_persona = $2`,
      [id, personaId],
    );
    if (!a) throw new NotFoundException(`Área ${id} no encontrada`);
    return a as Fila;
  }

  /** Valida un conjunto de áreas de una vez (registro de comprobantes) */
  async validarActivas(personaId: number, ids: number[]) {
    const unicos = [...new Set(ids)];
    if (!unicos.length) return;
    const filas: Fila[] = await this.dataSource.query(
      `SELECT id FROM area_contable WHERE id_persona = $1 AND activa AND id = ANY($2)`,
      [personaId, unicos],
    );
    const ok = new Set(filas.map((f) => Number(f.id)));
    const faltan = unicos.filter((i) => !ok.has(i));
    if (faltan.length) {
      throw new BadRequestException(
        `Área no válida o inactiva: ${faltan.join(', ')}`,
      );
    }
  }

  private async validarDestino(personaId: number, codigo: string) {
    const { cuenta } = await this.plan.cuenta(personaId, codigo).catch(() => {
      throw new BadRequestException(
        `La cuenta ${codigo} no existe en tu plan. Créala en Contabilidad › Plan de cuentas`,
      );
    });
    if (!cuenta.imputable) {
      throw new BadRequestException(
        `La cuenta ${codigo} agrupa subcuentas: elige una de sus subcuentas como destino`,
      );
    }
  }

  /** Las áreas que sugiere el plan de la empresa (con su destino, si trae) */
  private async crearPorDefecto(personaId: number) {
    const plan = await this.plan.planDe(personaId);
    for (const d of plan.areasSugeridas ?? []) {
      if (d.cuenta) {
        try {
          await this.plan.crearSubcuenta(personaId, {
            codigo: d.cuenta,
            nombre: d.nombreCuenta ?? d.nombre,
          });
        } catch {
          // Ya existe (oficial o creada antes): se usa tal cual
        }
      }
      await this.dataSource.query(
        `INSERT INTO area_contable (id_persona, nombre, cuenta_destino)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [personaId, d.nombre, d.cuenta ?? null],
      );
    }
  }
}
