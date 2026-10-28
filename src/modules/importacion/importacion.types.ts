import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { CpeDocumento, CpeLinea } from './cpe/cpe.types';

/** Máximo de XML por carga (cada uno pesa unos pocos KB) */
export const MAXIMO_ARCHIVOS = 200;

export class ArchivoXmlDto {
  @ApiProperty({ example: 'F001-120.xml' })
  @IsString()
  @MaxLength(255)
  nombre: string;

  @ApiProperty({ description: 'Contenido del XML o TXT en base64' })
  @IsString()
  @MinLength(1)
  contenido: string;
}

export class PrevisualizarDto {
  @ApiProperty({ type: [ArchivoXmlDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAXIMO_ARCHIVOS)
  @ValidateNested({ each: true })
  @Type(() => ArchivoXmlDto)
  archivos: ArchivoXmlDto[];
}

export class NuevoProductoDto {
  @ApiProperty({ example: 'Aceite Primor 1 L' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  nombre: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @IsPositive()
  idCategoria: number;

  @ApiProperty({ example: 'unidad' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  unidadMedida: string;

  @ApiPropertyOptional({ example: 'ACE-001' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codigo?: string;
}

/** Qué hacer con una línea del XML */
export class ResolucionLineaDto {
  @ApiProperty({ example: 1, description: 'Número de línea del XML' })
  @IsInt()
  @Min(1)
  orden: number;

  @ApiProperty({ enum: ['producto', 'servicio'] })
  @IsIn(['producto', 'servicio'])
  tipo: 'producto' | 'servicio';

  @ApiPropertyOptional({ description: 'Producto existente' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  idProducto?: number;

  @ApiPropertyOptional({ type: NuevoProductoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NuevoProductoDto)
  nuevoProducto?: NuevoProductoDto;

  @ApiPropertyOptional({
    example: 12,
    description: 'Unidades propias por cada unidad del XML',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  factor?: number;

  @ApiPropertyOptional({ example: '6361' })
  @IsOptional()
  @Matches(/^\d{2,10}$/, { message: 'Código de cuenta inválido' })
  codigoCuenta?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  idArea?: number;

  @ApiPropertyOptional({
    default: true,
    description: 'Recordar esta decisión para el mismo emisor y artículo',
  })
  @IsOptional()
  @IsBoolean()
  recordar?: boolean;
}

export class ArchivoARegistrarDto extends ArchivoXmlDto {
  @ApiPropertyOptional({ example: 3.75, description: 'Solo en dólares' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  tipoCambio?: number;

  @ApiProperty({ type: [ResolucionLineaDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResolucionLineaDto)
  lineas: ResolucionLineaDto[];
}

/** Línea escrita a mano para un comprobante que no trae detalle (TXT) */
export class LineaManualDto {
  @ApiProperty({ enum: ['producto', 'servicio'] })
  @IsIn(['producto', 'servicio'])
  tipo: 'producto' | 'servicio';

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  idProducto?: number;

  @ApiPropertyOptional({ type: NuevoProductoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NuevoProductoDto)
  nuevoProducto?: NuevoProductoDto;

  @ApiPropertyOptional({ example: '6361' })
  @IsOptional()
  @Matches(/^\d{2,10}$/, { message: 'Código de cuenta inválido' })
  codigoCuenta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  idArea?: number;

  @ApiPropertyOptional({ example: 'Venta de mercadería' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsPositive()
  cantidad: number;

  @ApiProperty({ example: 254.24, description: 'Importe sin IGV' })
  @IsNumber()
  @Min(0)
  valor: number;

  @ApiProperty({
    enum: ['10', '20', '30'],
    description: 'Gravado, exonerado o inafecto',
  })
  @IsIn(['10', '20', '30'])
  afectacionIgv: '10' | '20' | '30';
}

/** Un comprobante de la cola: un XML o una fila de un TXT de SIRE */
export class RegistrarItemDto {
  @ApiProperty({ type: ArchivoXmlDto })
  @ValidateNested()
  @Type(() => ArchivoXmlDto)
  archivo: ArchivoXmlDto;

  @ApiPropertyOptional({ description: 'Fila del TXT (0 o vacío en un XML)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  indice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  idAlmacen?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @IsPositive()
  tipoCambio?: number;

  @ApiPropertyOptional({
    type: [ResolucionLineaDto],
    description: 'Líneas del XML',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResolucionLineaDto)
  lineas?: ResolucionLineaDto[];

  @ApiPropertyOptional({
    type: [LineaManualDto],
    description: 'Detalle del TXT',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaManualDto)
  lineasManuales?: LineaManualDto[];

  @ApiPropertyOptional({
    description: 'Registrar solo con los totales (sin inventario)',
  })
  @IsOptional()
  @IsBoolean()
  sinDetalle?: boolean;
}

export class RegistrarDto {
  @ApiPropertyOptional({
    description: 'Almacén de la carga (obligatorio si hay líneas de producto)',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  idAlmacen?: number;

  @ApiProperty({ type: [ArchivoARegistrarDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAXIMO_ARCHIVOS)
  @ValidateNested({ each: true })
  @Type(() => ArchivoARegistrarDto)
  archivos: ArchivoARegistrarDto[];
}

export type Operacion = 'compra' | 'venta';

export type OrigenSugerencia = 'equivalencia' | 'codigo' | 'gtin' | 'nombre';

export type Sugerencia =
  | {
      tipo: 'producto';
      idProducto: number;
      nombre: string;
      codigo: string | null;
      unidadMedida: string;
      factor: number;
      origen: OrigenSugerencia;
      /** equivalencia, código o GTIN: se puede registrar sin revisar */
      segura: boolean;
    }
  | {
      tipo: 'servicio';
      codigoCuenta: string;
      idArea: number | null;
      origen: 'equivalencia' | 'plantilla';
      segura: true;
    };

export interface LineaPrevia extends CpeLinea {
  clave: string;
  sugerencia: Sugerencia | null;
}

export type OrigenArchivo = 'xml' | 'txt' | 'excel';

export interface ArchivoPrevio {
  nombre: string;
  /** Fila del TXT; 0 en un XML. Con el nombre identifica el comprobante */
  indice: number;
  origen: OrigenArchivo;
  /** El archivo trae el detalle (XML); si no, se escribe o se registra sin él */
  conDetalle: boolean;
  /** Sin errores: se puede registrar una vez resueltas sus líneas */
  valido: boolean;
  errores: string[];
  avisos: string[];
  operacion: Operacion | null;
  documento: Omit<CpeDocumento, 'lineas'> | null;
  contraparte: {
    tipoDocumento: string | null;
    numeroDocumento: string;
    razonSocial: string;
    /** null: se creará al registrar */
    idEntidad: number | null;
  } | null;
  /** Nota: comprobante que modifica (registrado o en esta misma carga) */
  afectado: {
    serieNumero: string;
    idComprobante: number | null;
    enEstaCarga: boolean;
  } | null;
  tipoCambio: number | null;
  lineas: LineaPrevia[];
}

export interface ResultadoRegistro {
  nombre: string;
  ok: boolean;
  error?: string;
  idComprobante?: number;
  correlativo?: string;
  serieNumero?: string;
}
