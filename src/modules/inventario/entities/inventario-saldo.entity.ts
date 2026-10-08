import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Saldo actual de un inventario según el kardex materializado.
 * `pendienteDesde` marca que hay que recalcular el kardex desde ese día
 * ('0001-01-01' = desde el inicio); null = al día.
 */
@Entity('inventario_saldo')
export class InventarioSaldo {
  @PrimaryColumn({ name: 'id_inventario', type: 'bigint' })
  idInventario: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  cantidad: number;

  @Column({ type: 'decimal', precision: 18, scale: 6, default: 0 })
  valor: number;

  @Column({
    name: 'costo_unitario',
    type: 'decimal',
    precision: 18,
    scale: 6,
    default: 0,
  })
  costoUnitario: number;

  @Column({ name: 'ultimo_dia', type: 'date', nullable: true })
  ultimoDia: string | null;

  @Column({ name: 'ultimo_orden', type: 'int', default: 0 })
  ultimoOrden: number;

  @Column({ name: 'pendiente_desde', type: 'date', nullable: true })
  pendienteDesde: string | null;

  @Column({
    name: 'fecha_actualizacion',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaActualizacion: Date;
}
