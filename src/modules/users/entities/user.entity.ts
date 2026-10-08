import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Persona } from './persona.entity';
import { UserRole } from './user-role.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;

  @Column()
  nombre: string;

  @Column()
  contrasena: string;

  @Column({ default: true })
  habilitado: boolean;

  @Column({ nullable: true })
  resetPasswordToken?: string;

  @Column({ type: 'timestamp', nullable: true })
  resetPasswordExpires?: Date;

  @ManyToOne(() => Persona, (persona) => persona.usuarios, { nullable: true })
  @JoinColumn()
  persona: Persona;

  @Column({ default: false })
  esPrincipal: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  telefono: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  cargo: string | null;

  /** Foto de perfil como data URL; no se carga salvo que se pida */
  @Column({ type: 'text', nullable: true, select: false })
  avatar?: string | null;

  @Column({ name: 'ultimo_login', type: 'timestamptz', nullable: true })
  ultimoLogin: Date | null;

  /** Navegador del último inicio de sesión (User-Agent) */
  @Column({
    name: 'ultimo_agente',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  ultimoAgente: string | null;

  @Column({
    name: 'contrasena_actualizada',
    type: 'timestamptz',
    nullable: true,
  })
  contrasenaActualizada: Date | null;

  @OneToMany(() => UserRole, (userRole) => userRole.user)
  userRoles: UserRole[];
}
