import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Cuentas que usan los asientos automáticos de compras y ventas. Cada
 * empresa puede cambiarlas (deben ser cuentas de movimiento de su plan).
 */
export const CUENTAS_AUTOMATICAS = {
  compraMercaderias: {
    codigo: '6011',
    nombre: 'Compra de mercaderías',
  },
  igv: { codigo: '40111', nombre: 'IGV (crédito y débito fiscal)' },
  proveedores: { codigo: '4212', nombre: 'Proveedores: facturas por pagar' },
  clientes: { codigo: '1212', nombre: 'Clientes: facturas por cobrar' },
  ventaMercaderias: { codigo: '70121', nombre: 'Venta de mercaderías' },
  devolucionVentas: {
    codigo: '70921',
    nombre: 'Devoluciones sobre ventas',
  },
  costoVentas: { codigo: '69121', nombre: 'Costo de ventas de mercaderías' },
  almacen: { codigo: '20111', nombre: 'Mercaderías en almacén' },
  variacion: { codigo: '6111', nombre: 'Variación de mercaderías' },
  cargasImputables: {
    codigo: '791',
    nombre: 'Cargas imputables a cuentas de costos y gastos',
  },
} as const;

export type ClaveCuenta = keyof typeof CUENTAS_AUTOMATICAS;
export type CuentasAutomaticas = Record<ClaveCuenta, string>;

export const cuentasPorDefecto = (): CuentasAutomaticas =>
  Object.fromEntries(
    Object.entries(CUENTAS_AUTOMATICAS).map(([k, v]) => [k, v.codigo]),
  ) as CuentasAutomaticas;

/** Cuentas elegidas por la empresa (solo las que cambió) */
@Entity('configuracion_contable')
export class ConfiguracionContable {
  @PrimaryColumn({ name: 'id_persona', type: 'int' })
  idPersona: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  cuentas: Partial<CuentasAutomaticas>;
}
