import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Un plan de cuentas oficial (PCGE 2019, más adelante PCGE 2026) */
@Entity('plan_contable')
export class PlanContable {
  @PrimaryGeneratedColumn()
  id: number;

  /** Identificador estable, p. ej. 'PCGE2019' */
  @Column({ type: 'varchar', length: 20, unique: true })
  codigo: string;

  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  /** Norma que lo aprueba */
  @Column({ type: 'varchar', length: 120 })
  norma: string;

  /** Código del plan en la Tabla 17 de SUNAT (libros electrónicos 5.3/5.4) */
  @Column({ name: 'codigo_sunat', type: 'varchar', length: 2 })
  codigoSunat: string;

  @Column({ name: 'vigente_desde', type: 'date' })
  vigenteDesde: string;

  @Column({ name: 'vigente_hasta', type: 'date', nullable: true })
  vigenteHasta: string | null;

  /** Plan que se asigna a las empresas que no eligieron otro */
  @Column({ name: 'por_defecto', default: false })
  porDefecto: boolean;
}
