import { Expose, Transform } from 'class-transformer';

export class ResponseComprobanteDetalleDto {
  @Expose()
  idDetalle: number;

  // Id del inventario asociado al detalle
  @Expose()
  @Transform(
    ({ obj }) => {
      const o = obj as { inventario?: { id?: number } };
      return o.inventario?.id;
    },
    { toClassOnly: true },
  )
  idInventario?: number;

  @Expose()
  cantidad: number;

  @Expose()
  unidadMedida: string;

  @Expose()
  precioUnitario: number;

  @Expose()
  subtotal: number;

  @Expose()
  igv?: number;

  @Expose()
  isc?: number;

  @Expose()
  total: number;

  @Expose()
  descripcion: string;

  /** producto o servicio */
  @Expose()
  @Transform(
    ({ obj }) => (obj as { tipoLinea?: string }).tipoLinea ?? 'producto',
    {
      toClassOnly: true,
    },
  )
  tipoLinea: 'producto' | 'servicio';

  /** Cuenta de gasto o ingreso de una línea de servicio */
  @Expose()
  @Transform(
    ({ obj }) => {
      const c = (
        obj as { cuentaContable?: { codigo: string; nombre: string } | null }
      ).cuentaContable;
      return c ? { codigo: c.codigo, nombre: c.nombre } : null;
    },
    { toClassOnly: true },
  )
  cuenta?: { codigo: string; nombre: string } | null;

  /** Área o centro de costo */
  @Expose()
  @Transform(
    ({ obj }) => {
      const a = (obj as { area?: { id: number; nombre: string } | null }).area;
      return a ? { id: a.id, nombre: a.nombre } : null;
    },
    { toClassOnly: true },
  )
  area?: { id: number; nombre: string } | null;
}
