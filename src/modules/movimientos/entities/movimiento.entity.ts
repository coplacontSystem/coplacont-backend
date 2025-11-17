import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { TipoMovimiento } from '../enum/tipo-movimiento.enum';
import { EstadoMovimiento } from '../enum/estado-movimiento.enum';
import { Comprobante } from '../../comprobantes/entities/comprobante';
import { MovimientoDetalle } from './movimiento-detalle.entity';

/**
 * Entidad para movimientos de inventario
 */
@Entity('movimientos')
export class Movimiento {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'enum',
    enum: TipoMovimiento,
    comment: 'Tipo de movimiento: ENTRADA, SALIDA, AJUSTE',
  })
  tipo: TipoMovimiento;

  @Column({
    type: 'timestamp',
    comment: 'Fecha del movimiento',
  })
  fecha: Date;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Número de documento relacionado',
  })
  numeroDocumento: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Código de la tabla 12',
  })
  codigoTabla12?: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Código de la tabla 10',
  })
  codigoTabla10?: string;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'Observaciones del movimiento',
  })
  observaciones: string;

  @Column({
    type: 'enum',
    enum: EstadoMovimiento,
    default: EstadoMovimiento.PROCESADO,
    comment: 'Estado del movimiento',
  })
  estado: EstadoMovimiento;

  @Column({
    name: 'id_comprobante',
    nullable: true,
    comment: 'ID del comprobante relacionado',
  })
  idComprobante: number;

  @CreateDateColumn({
    name: 'fecha_creacion',
    comment: 'Fecha de creación del registro',
  })
  fechaCreacion: Date;

  @UpdateDateColumn({
    name: 'fecha_actualizacion',
    comment: 'Fecha de última actualización',
  })
  fechaActualizacion: Date;

  // Relaciones
  @ManyToOne(() => Comprobante, { nullable: true })
  @JoinColumn({ name: 'id_comprobante' })
  comprobante: Comprobante;

  @OneToMany(() => MovimientoDetalle, (detalle) => detalle.movimiento, {
    cascade: true,
    eager: true,
  })
  detalles: MovimientoDetalle[];
}
