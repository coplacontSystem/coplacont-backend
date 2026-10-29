/**
 * Tablas de SUNAT que usa el producto. Son cortas y fijas: viven en el código.
 */

/** Tabla 5: tipo de existencia (Registro de Inventario Permanente Valorizado) */
export const TIPOS_EXISTENCIA: readonly { codigo: string; nombre: string }[] = [
  { codigo: '01', nombre: 'Mercaderías' },
  { codigo: '02', nombre: 'Productos terminados' },
  { codigo: '03', nombre: 'Materias primas' },
  { codigo: '04', nombre: 'Envases' },
  { codigo: '05', nombre: 'Materiales auxiliares' },
  { codigo: '06', nombre: 'Suministros' },
  { codigo: '07', nombre: 'Repuestos' },
  { codigo: '08', nombre: 'Embalajes' },
  { codigo: '09', nombre: 'Subproductos' },
  { codigo: '10', nombre: 'Desechos y desperdicios' },
  { codigo: '99', nombre: 'Otros' },
];

/**
 * Tabla 6: unidad de medida. SUNAT usa los códigos UN/ECE rec. 20 (los
 * mismos del catálogo 03 de los comprobantes electrónicos); aquí van los de
 * uso común. `corto` es el texto que se muestra en el producto.
 */
export const UNIDADES: readonly {
  codigo: string;
  nombre: string;
  corto: string;
}[] = [
  { codigo: 'NIU', nombre: 'Unidad (bienes)', corto: 'unidad' },
  { codigo: 'ZZ', nombre: 'Unidad (servicios)', corto: 'servicio' },
  { codigo: 'KGM', nombre: 'Kilogramo', corto: 'kg' },
  { codigo: 'GRM', nombre: 'Gramo', corto: 'g' },
  { codigo: 'TNE', nombre: 'Tonelada', corto: 't' },
  { codigo: 'LBR', nombre: 'Libra', corto: 'lb' },
  { codigo: 'ONZ', nombre: 'Onza', corto: 'oz' },
  { codigo: 'LTR', nombre: 'Litro', corto: 'litro' },
  { codigo: 'MLT', nombre: 'Mililitro', corto: 'ml' },
  { codigo: 'GLL', nombre: 'Galón (EE. UU.)', corto: 'galón' },
  { codigo: 'MTR', nombre: 'Metro', corto: 'metro' },
  { codigo: 'CMT', nombre: 'Centímetro', corto: 'cm' },
  { codigo: 'MMT', nombre: 'Milímetro', corto: 'mm' },
  { codigo: 'KTM', nombre: 'Kilómetro', corto: 'km' },
  { codigo: 'MTK', nombre: 'Metro cuadrado', corto: 'm²' },
  { codigo: 'MTQ', nombre: 'Metro cúbico', corto: 'm³' },
  { codigo: 'FOT', nombre: 'Pie', corto: 'pie' },
  { codigo: 'INH', nombre: 'Pulgada', corto: 'pulgada' },
  { codigo: 'BX', nombre: 'Caja', corto: 'caja' },
  { codigo: 'PK', nombre: 'Paquete', corto: 'paquete' },
  { codigo: 'BG', nombre: 'Bolsa', corto: 'bolsa' },
  { codigo: 'BO', nombre: 'Botella', corto: 'botella' },
  { codigo: 'CA', nombre: 'Lata', corto: 'lata' },
  { codigo: 'BJ', nombre: 'Balde', corto: 'balde' },
  { codigo: 'BLL', nombre: 'Barril', corto: 'barril' },
  { codigo: 'CY', nombre: 'Cilindro', corto: 'cilindro' },
  { codigo: 'RO', nombre: 'Rollo', corto: 'rollo' },
  { codigo: 'DZN', nombre: 'Docena', corto: 'docena' },
  { codigo: 'CEN', nombre: 'Ciento de unidades', corto: 'ciento' },
  { codigo: 'MIL', nombre: 'Millar', corto: 'millar' },
  { codigo: 'SET', nombre: 'Juego', corto: 'juego' },
  { codigo: 'PR', nombre: 'Par', corto: 'par' },
  { codigo: 'KT', nombre: 'Kit', corto: 'kit' },
  { codigo: 'HUR', nombre: 'Hora', corto: 'hora' },
  { codigo: 'DAY', nombre: 'Día', corto: 'día' },
  { codigo: 'MON', nombre: 'Mes', corto: 'mes' },
];

export const CODIGOS_EXISTENCIA = TIPOS_EXISTENCIA.map((t) => t.codigo);
export const CODIGOS_UNIDAD = UNIDADES.map((u) => u.codigo);
