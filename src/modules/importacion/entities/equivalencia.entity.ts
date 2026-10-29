import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Lo que la empresa decidió para una línea de XML, para no volver a
 * preguntarlo: "el ACE-12 del proveedor 20100055237 es mi Aceite Primor 1 L,
 * y cada caja trae 12". También recuerda líneas de servicio (cuenta y área).
 *
 * La clave es el código que el emisor pone a su artículo o, si no trae
 * código, su descripción normalizada.
 */
@Entity('equivalencia_producto')
@Index('UQ_equivalencia', ['idPersona', 'documentoEmisor', 'clave'], {
  unique: true,
})
export class EquivalenciaProducto {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'id_persona' })
  idPersona: number;

  /** RUC de quien emite el XML (el proveedor, o la propia empresa en ventas) */
  @Column({ name: 'documento_emisor', type: 'varchar', length: 15 })
  documentoEmisor: string;

  /** 'C:<código del emisor>' o 'D:<descripción normalizada>' */
  @Column({ type: 'varchar', length: 260 })
  clave: string;

  @Column({ type: 'varchar', length: 255 })
  descripcion: string;

  @Column({ type: 'varchar', length: 10, default: 'producto' })
  tipo: 'producto' | 'servicio';

  @Column({ name: 'id_producto', type: 'int', nullable: true })
  idProducto: number | null;

  /** Unidades propias por cada unidad del XML (caja de 12 → 12) */
  @Column('decimal', { precision: 12, scale: 4, default: 1 })
  factor: number;

  @Column({
    name: 'codigo_cuenta',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  codigoCuenta: string | null;

  @Column({ name: 'id_area', type: 'int', nullable: true })
  idArea: number | null;

  @Column({
    name: 'actualizado',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  actualizado: Date;
}
