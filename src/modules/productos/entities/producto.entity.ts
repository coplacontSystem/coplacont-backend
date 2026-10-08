import {
  Column,
  Entity,
  Unique,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Categoria } from '../../categoria/entities';
import { TipoProducto } from '../enum/tipo-producto.enum';
import { Persona } from '../../users/entities/persona.entity';

/**
 * Entidad que representa un producto en el sistema
 * Contiene información básica del producto y su relación con categoría
 */
// El código es único dentro de cada empresa (dos empresas pueden usar el mismo)
@Unique('UQ_producto_codigo_persona', ['codigo', 'persona'])
@Entity({ name: 'producto' })
export class Producto {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * Relación con Persona (empresa propietaria del producto)
   * Un producto pertenece a una empresa específica
   */
  @ManyToOne(() => Persona, { nullable: false })
  @JoinColumn({ name: 'id_persona' })
  persona: Persona;

  /**
   * Nombre del producto
   */
  @Column({ length: 255, nullable: false })
  nombre: string;

  /**
   * Relación muchos a uno con categoría
   */
  @ManyToOne(() => Categoria, (categoria) => categoria.productos)
  @JoinColumn({ name: 'id_categoria' })
  categoria: Categoria;

  /**
   * Tipo del registro (producto o servicio)
   */
  @Column({ type: 'enum', enum: TipoProducto, default: TipoProducto.PRODUCTO })
  tipo: TipoProducto;

  /**
   * Descripción del producto
   */
  @Column({ length: 255, nullable: true })
  descripcion?: string;

  /**
   * Unidad de medida del producto (kg, unidad, litro, etc.)
   */
  @Column({ length: 50, nullable: false })
  unidadMedida: string;

  /**
   * Estado del producto (activo/inactivo)
   */
  @Column({ default: true })
  estado: boolean;

  /**
   * Código único del producto (opcional)
   */
  @Column({ length: 50, nullable: true })
  codigo: string;

  /**
   * Precio unitario del producto
   */
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  precio: number;

  /**
   * Stock mínimo requerido
   */
  @Column({ nullable: true, default: 0 })
  stockMinimo: number;

  /**
   * Fecha de creación del registro
   */
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  fechaCreacion: Date;

  /**
   * Fecha de última actualización
   */
  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  fechaActualizacion: Date;
}
