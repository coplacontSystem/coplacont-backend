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

  /** Nombre de cada elemento (primer dígito) en este plan */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  elementos: Record<string, string>;

  /** Cuenta sugerida para cada rol de los asientos automáticos */
  @Column({ name: 'cuentas_sugeridas', type: 'jsonb', default: () => "'{}'" })
  cuentasSugeridas: Record<string, string>;

  @Column({ type: 'varchar', length: 300, nullable: true })
  nota: string | null;

  /** Áreas por defecto y su cuenta de destino */
  @Column({ name: 'areas_sugeridas', type: 'jsonb', default: () => "'[]'" })
  areasSugeridas: { nombre: string; cuenta?: string; nombreCuenta?: string }[];

  /** incluido (viene con el sistema) o importado desde el panel */
  @Column({ type: 'varchar', length: 10, default: 'incluido' })
  origen: string;

  /** Sube con cada actualización importada */
  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({
    name: 'fecha_actualizacion',
    type: 'timestamptz',
    default: () => 'now()',
  })
  fechaActualizacion: Date;
}
