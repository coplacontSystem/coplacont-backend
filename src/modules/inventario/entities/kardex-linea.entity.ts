import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Línea del kardex ya valorizada (kardex materializado).
 * Una por detalle de movimiento procesado, más una por cada lote de inventario
 * inicial sin movimiento. La escribe `KardexMaterializadoService`, recalculando
 * desde la fecha afectada cuando algo cambia; nadie más debe modificarla.
 */
@Entity('kardex_linea')
@Index('UQ_kardex_linea_orden', ['idInventario', 'orden'], { unique: true })
@Index('IDX_kardex_linea_dia', ['idInventario', 'dia'])
@Index('IDX_kardex_linea_mov_det', ['idMovimientoDetalle'])
export class KardexLinea {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ name: 'id_inventario', type: 'bigint' })
  idInventario: number;

  /** Posición en el kardex del inventario (orden contable). */
  @Column({ type: 'int' })
  orden: number;

  /** Día contable del movimiento. */
  @Column({ type: 'date' })
  dia: string;

  @Column({ name: 'id_movimiento_detalle', type: 'int', nullable: true })
  idMovimientoDetalle: number | null;

  /** Entradas: lote que crean. */
  @Column({ name: 'id_lote', type: 'bigint', nullable: true })
  idLote: number | null;

  @Column({ type: 'varchar', length: 7 })
  tipo: 'ENTRADA' | 'SALIDA';

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  cantidad: number;

  @Column({ name: 'costo_unitario', type: 'decimal', precision: 18, scale: 6 })
  costoUnitario: number;

  @Column({ name: 'costo_total', type: 'decimal', precision: 18, scale: 6 })
  costoTotal: number;

  /** Cantidad de la salida que no tenía stock (datos antiguos inconsistentes). */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  faltante: number;

  @Column({ name: 'saldo_cantidad', type: 'decimal', precision: 18, scale: 4 })
  saldoCantidad: number;

  @Column({ name: 'saldo_valor', type: 'decimal', precision: 18, scale: 6 })
  saldoValor: number;

  @Column({
    name: 'saldo_costo_unitario',
    type: 'decimal',
    precision: 18,
    scale: 6,
  })
  saldoCostoUnitario: number;
}
