import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * igual: mismo código y significado · renombrada: mismo código, nombre
 * retocado · cambio: el código existe pero ahora significa otra cosa ·
 * eliminada: el código ya no existe en el plan destino.
 */
export type TipoEquivalencia = 'igual' | 'renombrada' | 'cambio' | 'eliminada';

/** A qué cuenta del plan destino va cada cuenta oficial del plan origen */
@Entity('cuenta_equivalencia')
@Index(
  'UQ_equivalencia_cuenta',
  ['idPlanOrigen', 'idPlanDestino', 'codigoOrigen'],
  {
    unique: true,
  },
)
export class CuentaEquivalencia {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'id_plan_origen', type: 'int' })
  idPlanOrigen: number;

  @Column({ name: 'id_plan_destino', type: 'int' })
  idPlanDestino: number;

  @Column({ name: 'codigo_origen', type: 'varchar', length: 10 })
  codigoOrigen: string;

  /** null: sin equivalente (hay que decidirlo) */
  @Column({
    name: 'codigo_destino',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  codigoDestino: string | null;

  @Column({ type: 'varchar', length: 12 })
  tipo: TipoEquivalencia;

  /** Parecido de la propuesta automática (0 a 1) */
  @Column({ type: 'decimal', precision: 4, scale: 3, default: 0 })
  similitud: number;

  /** Iguales y renombradas no requieren revisión; el resto, sí */
  @Column({ default: false })
  revisada: boolean;

  @Column({ type: 'varchar', length: 300, nullable: true })
  nota: string | null;

  @Column({
    name: 'revisada_por',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  revisadaPor: string | null;

  @Column({ name: 'fecha_revision', type: 'timestamptz', nullable: true })
  fechaRevision: Date | null;
}
