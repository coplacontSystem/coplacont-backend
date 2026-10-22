import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AsientoContable } from './asiento.entity';
import { CuentaContable } from '../entities/cuenta-contable.entity';

const decimal = {
  to: (v: number) => v,
  from: (v: string | null) => (v == null ? 0 : Number(v)),
};

/** Línea de un asiento: una cuenta con un importe al Debe o al Haber */
@Entity('asiento_linea')
@Index('IDX_asiento_linea_cuenta', ['idCuenta'])
@Check(
  'CHK_asiento_linea_lado',
  '(debe > 0 AND haber = 0) OR (haber > 0 AND debe = 0)',
)
export class AsientoLinea {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => AsientoContable, (a) => a.lineas, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'id_asiento' })
  asiento: AsientoContable;

  @Column({ name: 'id_asiento' })
  idAsiento: number;

  @Column({ type: 'smallint' })
  orden: number;

  @ManyToOne(() => CuentaContable, { nullable: false })
  @JoinColumn({ name: 'id_cuenta' })
  cuenta: CuentaContable;

  @Column({ name: 'id_cuenta' })
  idCuenta: number;

  @Column({ type: 'varchar', length: 250, nullable: true })
  glosa: string | null;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimal,
  })
  debe: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimal,
  })
  haber: number;
}
