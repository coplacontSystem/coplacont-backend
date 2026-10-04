import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Inventario } from '../../inventario/entities/inventario.entity';

/**
 * Entidad InventarioLote
 * Representa un lote específico de productos en inventario
 * Necesario para el cálculo de costos en el Kardex (FIFO/PROMEDIO)
 */
// Índices para las consultas de stock, kardex y reportes
@Index('IDX_lote_inventario_fecha', ['inventario', 'fechaIngreso'])
@Entity('inventario_lote')
export class InventarioLote {
  /**
   * Identificador único del lote
   */
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  /**
   * Fecha real de ingreso del lote al inventario
   */
  @Column({
    type: 'date',
    comment: 'Fecha real de entrada del lote',
  })
  fechaIngreso: Date;

  /**
   * Fecha de vencimiento del lote (opcional para productos perecibles)
   */
  @Column({
    type: 'date',
    nullable: true,
    comment: 'Fecha de vencimiento para productos perecibles',
  })
  fechaVencimiento?: Date;

  /**
   * Cantidad inicial con la que entró el lote
   */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 4,
    comment: 'Cantidad con la que entró el lote',
  })
  cantidadInicial: number;

  /**
   * Costo unitario del producto en este lote específico
   */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 4,
    comment: 'Costo por unidad en este lote',
  })
  costoUnitario: number;

  /**
   * Número de lote o referencia (opcional)
   */
  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'Número de lote o referencia',
  })
  numeroLote?: string;

  /**
   * Observaciones adicionales del lote
   */
  @Column({
    type: 'text',
    nullable: true,
    comment: 'Observaciones adicionales del lote',
  })
  observaciones?: string;

  /**
   * Estado del lote (activo/inactivo)
   */
  @Column({
    type: 'boolean',
    default: true,
    comment: 'Estado del lote',
  })
  estado: boolean;

  /**
   * Fecha de creación del registro
   */
  @CreateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaCreacion: Date;

  /**
   * Fecha de última actualización
   */
  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  fechaActualizacion: Date;

  // Relaciones

  /**
   * Relación con Inventario
   * Un lote pertenece a un registro de inventario específico
   */
  @ManyToOne(() => Inventario, (inventario) => inventario.lotes)
  @JoinColumn({ name: 'id_inventario' })
  inventario: Inventario;
}
