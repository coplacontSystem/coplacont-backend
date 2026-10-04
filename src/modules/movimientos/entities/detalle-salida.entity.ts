import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { MovimientoDetalle } from './movimiento-detalle.entity';

/**
 * Entidad para detalles específicos de salidas de inventario
 */
// Índices para las consultas de stock, kardex y reportes
@Index('IDX_det_salida_mov_det', ['idMovimientoDetalle'])
@Index('IDX_det_salida_lote', ['idLote'])
@Entity('detalle_salidas')
export class DetalleSalida {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    name: 'id_movimiento_detalle',
    comment: 'ID del detalle de movimiento asociado',
  })
  idMovimientoDetalle: number;

  @Column({
    name: 'id_lote',
    comment: 'ID del lote utilizado en la salida',
  })
  idLote: number;

  @Column({
    name: 'costo_unitario_de_lote',
    type: 'decimal',
    precision: 10,
    scale: 4,
    comment: 'Costo unitario del lote específico',
  })
  costoUnitarioDeLote: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    comment: 'Cantidad utilizada del lote',
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

  // Relación con MovimientoDetalle
  @ManyToOne(
    () => MovimientoDetalle,
    (movimientoDetalle) => movimientoDetalle.detallesSalida,
  )
  @JoinColumn({ name: 'id_movimiento_detalle' })
  movimientoDetalle: MovimientoDetalle;
}
