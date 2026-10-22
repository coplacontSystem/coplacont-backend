import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PlanContable } from './plan-contable.entity';

export type Naturaleza = 'deudora' | 'acreedora' | 'mixta';

/**
 * Cuenta de un plan contable. Las oficiales no tienen empresa (id_persona
 * null); las subcuentas propias de una empresa cuelgan de una cuenta del plan.
 */
@Entity('cuenta_contable')
// Un código no se repite entre las oficiales ni dentro de una empresa
@Index('UQ_cuenta_oficial', ['idPlan', 'codigo'], {
  unique: true,
  where: '"id_persona" IS NULL',
})
@Index('UQ_cuenta_propia', ['idPlan', 'idPersona', 'codigo'], {
  unique: true,
  where: '"id_persona" IS NOT NULL',
})
@Index('IDX_cuenta_padre', ['padre'])
export class CuentaContable {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => PlanContable, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_plan' })
  plan: PlanContable;

  @Column({ name: 'id_plan' })
  idPlan: number;

  /** null = cuenta oficial del plan; con valor = subcuenta propia de esa empresa */
  @Column({ name: 'id_persona', type: 'int', nullable: true })
  idPersona: number | null;

  @Column({ type: 'varchar', length: 10 })
  codigo: string;

  @Column({ type: 'varchar', length: 200 })
  nombre: string;

  /** 1 = cuenta (2 dígitos), 2 = subcuenta, 3 = divisionaria, 4+ = subdivisionaria */
  @Column({ type: 'smallint' })
  nivel: number;

  /** Primer dígito: 0 a 9 */
  @Column({ type: 'char', length: 1 })
  elemento: string;

  @Column({ type: 'varchar', length: 9 })
  naturaleza: Naturaleza;

  @ManyToOne(() => CuentaContable, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_padre' })
  padre: CuentaContable | null;

  @Column({ name: 'id_padre', type: 'int', nullable: true })
  idPadre: number | null;

  @Column({ default: true })
  activa: boolean;

  @CreateDateColumn({ name: 'fecha_creacion', type: 'timestamptz' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion', type: 'timestamptz' })
  fechaActualizacion: Date;
}
