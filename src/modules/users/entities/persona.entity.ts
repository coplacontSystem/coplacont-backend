import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class Persona {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  nombreEmpresa: string;

  @Column({ unique: true })
  ruc: string;

  @Column({ nullable: true })
  razonSocial: string;

  @Column({ nullable: true })
  telefono: string;

  @Column({ nullable: true })
  direccion: string;

  /** Plan contable de la empresa; null = el plan por defecto (PCGE 2019) */
  @Column({ name: 'id_plan_contable', type: 'int', nullable: true })
  idPlanContable: number | null;

  /** Logo de la empresa como data URL; no se carga salvo que se pida */
  @Column({ type: 'text', nullable: true, select: false })
  logo?: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @Column({ default: true })
  habilitado: boolean;

  @OneToMany(() => User, (user) => user.persona)
  usuarios: User[];
}
