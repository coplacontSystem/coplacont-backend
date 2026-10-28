import { Injectable, OnModuleInit } from '@nestjs/common';
import type {
  Columna,
  DocumentoTabular,
  Fila,
} from 'src/modules/reportes/documento-tabular';
import { ReportesService } from 'src/modules/reportes/reportes.service';
import { LibroDiarioService } from './libro-diario.service';
import { PeriodoLibroDto } from './libro-diario.types';

/** Grupo del formato 5.2 según el elemento de la cuenta */
function grupo(codigo: string) {
  const e = codigo[0];
  if (e === '1' || e === '2' || e === '3') return 'Activo';
  if (e === '4') return 'Pasivo';
  if (e === '5') return 'Patrimonio';
  if (e === '6') return 'Gastos';
  if (e === '7') return 'Ingresos';
  return 'Cuentas analíticas';
}

/**
 * Libro Diario de formato simplificado (formato 5.2 de SUNAT): una fila por
 * asiento y una columna por cuenta de 2 dígitos; el Debe va en positivo y el
 * Haber en negativo. En Excel lleva además la hoja de detalle por cuenta.
 * GET /api/reportes/libro-diario?año=2026&mes=5&formato=pdf|xlsx
 */
@Injectable()
export class LibroDiarioReporte implements OnModuleInit {
  constructor(
    private readonly reportes: ReportesService,
    private readonly libros: LibroDiarioService,
  ) {}

  onModuleInit(): void {
    this.reportes.registrar<PeriodoLibroDto>({
      clave: 'libro-diario',
      filtros: PeriodoLibroDto,
      generar: (personaId, f) => this.documento(personaId, f.año, f.mes),
    });
  }

  private async documento(
    personaId: number,
    año: number,
    mes: number,
  ): Promise<DocumentoTabular> {
    const libro = await this.libros.libro(personaId, año, mes);

    const columnasCuenta: Columna[] = libro.cuentas.map((c) => ({
      clave: `c${c.codigo}`,
      titulo: `${c.codigo} ${c.nombre}`.trim(),
      tipo: 'moneda',
      grupo: grupo(c.codigo),
      ancho: 13,
    }));
    const filas: Fila[] = libro.asientos.map((a) => {
      const fila: Fila = {
        numero: a.numero,
        fecha: new Date(`${a.fecha}T12:00:00Z`),
        glosa: a.glosa,
      };
      for (const l of a.lineas) {
        const k = `c${l.codigoCuenta.slice(0, 2)}`;
        fila[k] =
          Math.round(((Number(fila[k]) || 0) + l.debe - l.haber) * 100) / 100;
      }
      return fila;
    });
    const totales: Fila = { glosa: 'Totales' };
    for (const c of columnasCuenta) {
      totales[c.clave] =
        Math.round(
          filas.reduce((s, f) => s + (Number(f[c.clave]) || 0), 0) * 100,
        ) / 100;
    }

    const detalle: Fila[] = libro.asientos.flatMap((a) =>
      a.lineas.map((l) => ({
        numero: a.numero,
        fecha: new Date(`${a.fecha}T12:00:00Z`),
        glosa: l.glosa || a.glosa,
        referencia: a.referencia ?? '',
        cuenta: l.codigoCuenta,
        nombre: l.nombreCuenta,
        debe: l.debe || null,
        haber: l.haber || null,
      })),
    );

    const periodo = LibroDiarioService.etiqueta(año, mes);
    return {
      titulo: 'LIBRO DIARIO DE FORMATO SIMPLIFICADO (FORMATO 5.2)',
      nombreArchivo: `libro_diario_${año}_${String(mes).padStart(2, '0')}`,
      orientacion: 'horizontal',
      datos: [
        { etiqueta: 'Periodo', valor: periodo },
        { etiqueta: 'Asientos', valor: String(libro.asientos.length) },
      ],
      secciones: [
        {
          nombre: 'Formato 5.2',
          columnas: [
            { clave: 'numero', titulo: 'N° asiento', tipo: 'numero', ancho: 8 },
            { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha', ancho: 11 },
            { clave: 'glosa', titulo: 'Glosa', tipo: 'texto', ancho: 34 },
            ...columnasCuenta,
          ],
          filas,
          totales,
        },
        {
          nombre: 'Detalle',
          titulo: 'Detalle por cuenta',
          columnas: [
            { clave: 'numero', titulo: 'N° asiento', tipo: 'numero', ancho: 8 },
            { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha', ancho: 11 },
            { clave: 'glosa', titulo: 'Glosa', tipo: 'texto', ancho: 34 },
            {
              clave: 'referencia',
              titulo: 'Referencia',
              tipo: 'texto',
              ancho: 14,
            },
            { clave: 'cuenta', titulo: 'Cuenta', tipo: 'texto', ancho: 10 },
            {
              clave: 'nombre',
              titulo: 'Denominación',
              tipo: 'texto',
              ancho: 30,
            },
            { clave: 'debe', titulo: 'Debe', tipo: 'moneda', ancho: 13 },
            { clave: 'haber', titulo: 'Haber', tipo: 'moneda', ancho: 13 },
          ],
          filas: detalle,
          totales: {
            nombre: 'Totales',
            debe: libro.totalDebe,
            haber: libro.totalHaber,
          },
        },
      ],
    };
  }
}
