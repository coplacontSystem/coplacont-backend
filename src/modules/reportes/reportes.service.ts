import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource } from 'typeorm';
import {
  ArchivoExportado,
  DatosEmpresa,
  DocumentoTabular,
  FormatoExportacion,
  nombreSeguro,
} from './documento-tabular';
import { exportarCsv } from './exportadores/csv';
import { exportarPdf } from './exportadores/pdf';
import { exportarXlsx } from './exportadores/xlsx';
import { GeneradorReporte } from './reporte';

export const FORMATOS: FormatoExportacion[] = ['xlsx', 'csv', 'pdf'];

const TIPOS: Record<FormatoExportacion, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
};

/** Exportación centralizada: registro de reportes y conversión a cada formato. */
@Injectable()
export class ReportesService {
  private readonly generadores = new Map<string, GeneradorReporte>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  registrar<F extends object>(generador: GeneradorReporte<F>): void {
    if (this.generadores.has(generador.clave)) {
      throw new Error(`Reporte duplicado: ${generador.clave}`);
    }
    this.generadores.set(generador.clave, generador as GeneradorReporte);
  }

  /** Claves de los reportes disponibles. */
  disponibles(): string[] {
    return [...this.generadores.keys()].sort();
  }

  /** Genera el reporte `clave` con los filtros de la query y lo exporta. */
  async exportar(
    clave: string,
    formato: string,
    personaId: number,
    query: Record<string, unknown>,
  ): Promise<ArchivoExportado> {
    if (!FORMATOS.includes(formato as FormatoExportacion)) {
      throw new BadRequestException(
        `Formato no soportado: use ${FORMATOS.join(', ')}`,
      );
    }
    const generador = this.generadores.get(clave);
    if (!generador) {
      throw new NotFoundException(`Reporte no encontrado: ${clave}`);
    }

    const filtros = generador.filtros
      ? plainToInstance(generador.filtros, query)
      : {};
    const errores = await validate(filtros, { forbidUnknownValues: false });
    if (errores.length > 0) {
      throw new BadRequestException(
        errores.flatMap((e) => Object.values(e.constraints ?? {})),
      );
    }

    const documento = await generador.generar(personaId, filtros);
    if (documento.empresa === undefined) {
      documento.empresa = await this.datosEmpresa(personaId);
    }
    return this.exportarDocumento(documento, formato as FormatoExportacion);
  }

  /** Convierte un documento ya armado al formato pedido. */
  async exportarDocumento(
    documento: DocumentoTabular,
    formato: FormatoExportacion,
  ): Promise<ArchivoExportado> {
    const contenido =
      formato === 'xlsx'
        ? await exportarXlsx(documento)
        : formato === 'pdf'
          ? await exportarPdf(documento)
          : exportarCsv(documento);
    return {
      contenido,
      tipoContenido: TIPOS[formato],
      nombreArchivo: `${nombreSeguro(documento.nombreArchivo)}.${formato}`,
    };
  }

  /** Razón social y RUC de la empresa (para el encabezado de los reportes). */
  async datosEmpresa(personaId: number): Promise<DatosEmpresa | undefined> {
    const [persona]: {
      razon_social: string | null;
      nombre: string;
      ruc: string;
    }[] = await this.dataSource.query(
      `SELECT "razonSocial" AS razon_social, "nombreEmpresa" AS nombre, ruc
           FROM persona WHERE id = $1`,
      [personaId],
    );
    return persona
      ? {
          razonSocial: persona.razon_social || persona.nombre,
          ruc: persona.ruc,
        }
      : undefined;
  }
}
