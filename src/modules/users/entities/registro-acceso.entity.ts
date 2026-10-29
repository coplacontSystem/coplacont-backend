import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Auditoría de inicios de sesión (exitosos y fallidos). */
@Entity('registro_acceso')
@Index('IDX_acceso_email_fecha', ['email', 'fecha'])
export class RegistroAcceso {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  email: string;

  @Column({ name: 'id_usuario', type: 'int', nullable: true })
  idUsuario: number | null;

  @Column()
  exito: boolean;

  /** credenciales, deshabilitado, bloqueado… */
  @Column({ type: 'varchar', length: 40, nullable: true })
  motivo: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  agente: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  fecha: Date;
}
