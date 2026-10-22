import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Área o centro de costo de la empresa (Administración, Ventas, Producción…).
 * Su cuenta de destino (clase 9) recibe los gastos de la clase 6 de esa área.
 */
@Entity('area_contable')
@Index('UQ_area_nombre', ['idPersona', 'nombre'], { unique: true })
export class AreaContable {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'id_persona' })
  idPersona: number;

  @Column({ type: 'varchar', length: 60 })
  nombre: string;

  /** Cuenta de destino de la clase 9, p. ej. '94' (Gastos administrativos) */
  @Column({
    name: 'cuenta_destino',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  cuentaDestino: string | null;

  @Column({ default: true })
  activa: boolean;
}
