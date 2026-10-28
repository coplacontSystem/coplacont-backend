import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AsientoLinea } from './asiento-linea.entity';

export type OrigenAsiento = 'manual' | 'compra' | 'venta';
export type EstadoAsiento = 'registrado' | 'anulado';

const decimal = {
  to: (v: number) => v,
  from: (v: string | null) => (v == null ? 0 : Number(v)),
};

/**
 * Asiento del Libro Diario. El número es correlativo por empresa y periodo
 * contable; un asiento anulado conserva su número.
 */
@Entity('asiento_contable')
@Index('UQ_asiento_numero', ['idPersona', 'idPeriodo', 'numero'], {
  unique: true,
})
@Index('IDX_asiento_fecha', ['idPersona', 'fecha'])
// Un solo asiento automático por comprobante
@Index('UQ_asiento_comprobante', ['idComprobante'], {
  unique: true,
  where: '"id_comprobante" IS NOT NULL',
})
export class AsientoContable {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'id_persona' })
  idPersona: number;

  @Column({ name: 'id_periodo' })
  idPeriodo: number;

  @Column({ type: 'int' })
  numero: number;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ type: 'varchar', length: 250 })
  glosa: string;

  /** Documento que sustenta el asiento (p. ej. "Planilla 10/2026") */
  @Column({ type: 'varchar', length: 60, nullable: true })
  referencia: string | null;

  @Column({ type: 'varchar', length: 10, default: 'manual' })
  origen: OrigenAsiento;

  /** Compra o venta que lo generó (asientos automáticos) */
  @Column({ name: 'id_comprobante', type: 'int', nullable: true })
  idComprobante: number | null;

  @Column({ type: 'varchar', length: 10, default: 'registrado' })
  estado: EstadoAsiento;

  @Column({
    name: 'total_debe',
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: decimal,
  })
  totalDebe: number;

  @Column({
    name: 'total_haber',
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: decimal,
  })
  totalHaber: number;

  @Column({ name: 'creado_por', type: 'varchar', length: 120 })
  creadoPor: string;

  @Column({
    name: 'modificado_por',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  modificadoPor: string | null;

  @Column({ name: 'fecha_anulacion', type: 'timestamptz', nullable: true })
  fechaAnulacion: Date | null;

  @Column({ name: 'anulado_por', type: 'varchar', length: 120, nullable: true })
  anuladoPor: string | null;

  @Column({
    name: 'motivo_anulacion',
    type: 'varchar',
    length: 250,
    nullable: true,
  })
  motivoAnulacion: string | null;

  @CreateDateColumn({ name: 'fecha_creacion', type: 'timestamptz' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion', type: 'timestamptz' })
  fechaActualizacion: Date;

  @OneToMany(() => AsientoLinea, (l) => l.asiento)
  lineas: AsientoLinea[];
}
