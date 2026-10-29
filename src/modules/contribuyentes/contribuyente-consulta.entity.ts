import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { DatosContribuyente } from './contribuyente.types';

/** Caché de consultas de RUC y DNI (compartida entre empresas: son datos públicos). */
@Entity('contribuyente_consulta')
export class ContribuyenteConsulta {
  @PrimaryColumn({ length: 11 })
  numero: string;

  @Column({ length: 3 })
  tipo: 'RUC' | 'DNI';

  @Column()
  encontrado: boolean;

  @Column({ type: 'jsonb', default: {} })
  datos: DatosContribuyente;

  @Column({ name: 'fecha_consulta', type: 'timestamptz' })
  fechaConsulta: Date;
}
