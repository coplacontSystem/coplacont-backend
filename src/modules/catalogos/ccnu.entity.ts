import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Catálogo de bienes y servicios de Naciones Unidas (UNSPSC v14) que SUNAT
 * pide como "código de producto SUNAT" (CCNU). Es igual para todas las
 * empresas: segmento › familia › clase › producto, todos con 8 dígitos.
 */
@Entity('catalogo_ccnu')
@Index('IX_ccnu_padre', ['codigoPadre'])
export class CatalogoCcnu {
  @PrimaryColumn({ type: 'varchar', length: 8 })
  codigo: string;

  @Column({ type: 'varchar', length: 200 })
  nombre: string;

  /** 1 segmento, 2 familia, 3 clase, 4 producto */
  @Column({ type: 'smallint' })
  nivel: number;

  @Column({ name: 'codigo_padre', type: 'varchar', length: 8, nullable: true })
  codigoPadre: string | null;
}
