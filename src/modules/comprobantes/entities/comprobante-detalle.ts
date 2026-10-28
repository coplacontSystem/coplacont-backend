import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';
import { Comprobante } from './comprobante';
import { Inventario } from '../../inventario/entities/inventario.entity';
import { CuentaContable } from '../../contabilidad/entities/cuenta-contable.entity';
import { AreaContable } from '../../contabilidad/areas/area.entity';

/** producto: mueve inventario · servicio: gasto o ingreso sin inventario */
export type TipoLinea = 'producto' | 'servicio';

// Índices para las consultas de stock, kardex y reportes
@Index('IDX_comp_det_comprobante', ['comprobante'])
@Index('IDX_comp_det_inventario', ['inventario'])
@Entity({ name: 'comprobante_detalle' })
export class ComprobanteDetalle {
  @PrimaryGeneratedColumn()
  idDetalle: number;

  @ManyToOne(() => Comprobante, (comprobante) => comprobante.detalles)
  @JoinColumn({ name: 'id_comprobante' })
  comprobante: Comprobante;

  // Relación con el inventario
  @ManyToOne(() => Inventario, { nullable: true })
  @JoinColumn({ name: 'id_inventario' })
  inventario: Inventario | null;

  @Column({
    name: 'tipo_linea',
    type: 'varchar',
    length: 10,
    default: 'producto',
  })
  tipoLinea: TipoLinea;

  /** Cuenta de gasto o ingreso de una línea de servicio (p. ej. 6361 Energía) */
  @ManyToOne(() => CuentaContable, { nullable: true })
  @JoinColumn({ name: 'id_cuenta_contable' })
  cuentaContable: CuentaContable | null;

  /** Área o centro de costo, para el destino (clase 9) */
  @ManyToOne(() => AreaContable, { nullable: true })
  @JoinColumn({ name: 'id_area' })
  area: AreaContable | null;

  @Column('decimal', { precision: 15, scale: 4 })
  cantidad: number;

  @Column({ length: 10 })
  unidadMedida: string;

  @Column('decimal', { precision: 15, scale: 4 })
  precioUnitario: number;

  @Column('decimal', { precision: 15, scale: 2 })
  subtotal: number;

  @Column('decimal', { precision: 15, scale: 2, nullable: true })
  igv: number;

  @Column('decimal', { precision: 15, scale: 2, nullable: true })
  isc: number;

  @Column('decimal', { precision: 15, scale: 2 })
  total: number;

  @Column({ length: 255 })
  descripcion: string;

  /**
   * Afectación del IGV (catálogo 07 de SUNAT): 1x gravado, 2x exonerado,
   * 3x inafecto, 40 exportación. Sin dato se considera gravado.
   */
  @Column({
    name: 'afectacion_igv',
    type: 'varchar',
    length: 2,
    nullable: true,
  })
  afectacionIgv: string | null;
}
