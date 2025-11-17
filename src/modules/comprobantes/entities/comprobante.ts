import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ComprobanteDetalle } from './comprobante-detalle';
import { ComprobanteTotales } from './comprobante-totales';
import { Entidad } from '../../entidades/entities/entidad.entity';
import { Persona } from '../../users/entities/persona.entity';
import { PeriodoContable } from '../../periodos/entities/periodo-contable.entity';
import { TablaDetalle } from './tabla-detalle.entity';
import { Moneda } from '../enum/tipo-moneda.enum';

@Entity({ name: 'comprobante' })
export class Comprobante {
  @PrimaryGeneratedColumn()
  idComprobante: number;

  @Column({ unique: false, nullable: false })
  correlativo: string;

  // Relación con cliente/proveedor
  @ManyToOne(() => Entidad, { nullable: true })
  @JoinColumn({ name: 'id_entidad' })
  entidad: Entidad;

  // Relación con empresa propietaria del comprobante
  @ManyToOne(() => Persona, { nullable: false })
  @JoinColumn({ name: 'id_persona' })
  persona: Persona;

  // Relación con tipo de operación (Tabla 12)
  @ManyToOne(() => TablaDetalle, { nullable: false })
  @JoinColumn({ name: 'id_tipo_operacion' })
  tipoOperacion: TablaDetalle;

  // Relación con tipo de comprobante (Tabla 10)
  @ManyToOne(() => TablaDetalle, { nullable: false })
  @JoinColumn({ name: 'id_tipo_comprobante' })
  tipoComprobante: TablaDetalle;

  //Manual
  @Column({ type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  fechaEmision: Date;

  //Manual
  @Column({
    type: 'enum',
    enum: Moneda,
    nullable: false,
  })
  moneda: Moneda;

  //Manual
  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  tipoCambio: number;

  //manual
  @Column({ length: 5, nullable: false })
  serie: string;

  //manual
  @Column({ length: 20, nullable: false })
  numero: string;

  //manual
  @Column({ type: 'date', nullable: true })
  fechaVencimiento?: Date;

  //Relación con período contable
  @ManyToOne(() => PeriodoContable, { nullable: true })
  @JoinColumn({ name: 'id_periodo_contable' })
  periodoContable?: PeriodoContable;

  @Column({ name: 'car_sunat', length: 50, nullable: true })
  carSunat: string;

  @Column('decimal', { precision: 15, scale: 2, nullable: true })
  valorFobEmbarcado: number;

  @Column('decimal', { precision: 15, scale: 2, nullable: true })
  valorOpGratuitas: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  fechaRegistro: Date;

  //manual
  @OneToMany(() => ComprobanteDetalle, (detalle) => detalle.comprobante)
  detalles: ComprobanteDetalle[];

  //manual
  @OneToOne(() => ComprobanteTotales, (totales) => totales.comprobante)
  totales: ComprobanteTotales;

  // Relación con comprobante afecto (para notas de crédito/débito)
  @ManyToOne(() => Comprobante, { nullable: true })
  @JoinColumn({ name: 'id_comprobante_afecto' })
  comprobanteAfecto?: Comprobante;
}
