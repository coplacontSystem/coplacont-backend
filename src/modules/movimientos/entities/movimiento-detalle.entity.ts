import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Movimiento } from './movimiento.entity';
import { Inventario } from '../../inventario/entities/inventario.entity';
import { DetalleSalida } from './detalle-salida.entity';

/**
 * Entidad para detalles de movimientos de inventario
 */
// Índices para las consultas de stock, kardex y reportes
@Index('IDX_mov_det_movimiento', ['idMovimiento'])
@Index('IDX_mov_det_inventario', ['idInventario'])
@Index('IDX_mov_det_lote', ['idLote'])
@Entity('movimiento_detalles')
export class MovimientoDetalle {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    name: 'id_movimiento',
    comment: 'ID del movimiento padre',
  })
  idMovimiento: number;

  @Column({
    name: 'id_inventario',
    comment: 'ID del inventario',
  })
  idInventario: number;

  @Column({
    name: 'id_lote',
    nullable: true,
    comment: 'ID del lote (opcional)',
  })
  idLote?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    comment: 'Cantidad del movimiento',
  })
  cantidad: number;

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
  @ManyToOne(() => Movimiento, (movimiento) => movimiento.detalles)
  @JoinColumn({ name: 'id_movimiento' })
  movimiento: Movimiento;

  @ManyToOne(() => Inventario)
  @JoinColumn({ name: 'id_inventario' })
  inventario: Inventario;

  // Relación con DetalleSalida (solo para movimientos de salida)
  @OneToMany(
    () => DetalleSalida,
    (detalleSalida) => detalleSalida.movimientoDetalle,
    {
      cascade: true,
    },
  )
  detallesSalida?: DetalleSalida[];
}
