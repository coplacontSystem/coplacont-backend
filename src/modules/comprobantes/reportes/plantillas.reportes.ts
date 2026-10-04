import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Columna,
  DocumentoTabular,
  Fila,
} from 'src/modules/reportes/documento-tabular';
import { ReportesService } from 'src/modules/reportes/reportes.service';

type TipoPlantilla = 'compras' | 'ventas';

/** Fecha de ejemplo (12:00 UTC para que no cambie de día en ninguna zona). */
const fecha = (dia: string) => new Date(`${dia}T12:00:00Z`);

/**
 * Plantillas de carga masiva de compras y ventas (formato acordado en
 * docs/PLAN-BACKEND.md §7): una fila por línea de detalle; las filas con el
 * mismo tipo, serie, número y documento de la contraparte forman un comprobante,
 * y el producto se identifica por su código.
 */
@Injectable()
export class PlantillasReportes implements OnModuleInit {
  constructor(private readonly reportes: ReportesService) {}

  onModuleInit(): void {
    for (const tipo of ['compras', 'ventas'] as const) {
      this.reportes.registrar({
        clave: `plantilla-${tipo}`,
        generar: () => Promise.resolve(PlantillasReportes.plantilla(tipo)),
      });
    }
  }

  static plantilla(tipo: TipoPlantilla): DocumentoTabular {
    const contraparte =
      tipo === 'compras'
        ? {
            clave: 'rucProveedor',
            titulo: 'RUC proveedor',
            ejemplo: '20100047218',
          }
        : {
            clave: 'documentoCliente',
            titulo: 'RUC o DNI cliente',
            ejemplo: '20512345678',
          };

    const columnas: Columna[] = [
      {
        clave: 'tipoComprobante',
        titulo: 'Tipo comprobante (Tabla 10)',
        tipo: 'texto',
        ancho: 16,
      },
      { clave: 'serie', titulo: 'Serie', tipo: 'texto', ancho: 8 },
      { clave: 'numero', titulo: 'Número', tipo: 'texto', ancho: 12 },
      {
        clave: 'fechaEmision',
        titulo: 'Fecha emisión',
        tipo: 'fecha',
        ancho: 13,
      },
      {
        clave: 'fechaVencimiento',
        titulo: 'Fecha vencimiento',
        tipo: 'fecha',
        ancho: 13,
      },
      {
        clave: contraparte.clave,
        titulo: contraparte.titulo,
        tipo: 'texto',
        ancho: 16,
      },
      { clave: 'moneda', titulo: 'Moneda', tipo: 'texto', ancho: 8 },
      {
        clave: 'tipoCambio',
        titulo: 'Tipo de cambio',
        tipo: 'numero',
        decimales: 3,
        ancho: 10,
      },
      {
        clave: 'codigoProducto',
        titulo: 'Código producto',
        tipo: 'texto',
        ancho: 14,
      },
      {
        clave: 'descripcion',
        titulo: 'Descripción (opcional)',
        tipo: 'texto',
        ancho: 28,
      },
      { clave: 'cantidad', titulo: 'Cantidad', tipo: 'cantidad', ancho: 10 },
      {
        clave: 'precioUnitario',
        titulo: 'Precio unitario sin IGV',
        tipo: 'moneda',
        ancho: 12,
      },
      { clave: 'igv', titulo: 'IGV de la línea', tipo: 'moneda', ancho: 12 },
    ];

    // Un comprobante con dos productos: comparten tipo, serie, número y contraparte
    const comun: Fila = {
      tipoComprobante: '01',
      serie: tipo === 'compras' ? 'F001' : 'F002',
      numero: '00001234',
      fechaEmision: fecha('2026-03-15'),
      fechaVencimiento: fecha('2026-04-14'),
      [contraparte.clave]: contraparte.ejemplo,
      moneda: 'PEN',
      tipoCambio: 1,
    };
    const filas: Fila[] = [
      {
        ...comun,
        codigoProducto: 'ARR-001',
        descripcion: 'Arroz extra 5 kg',
        cantidad: 10,
        precioUnitario: 18.5,
        igv: 33.3,
      },
      {
        ...comun,
        codigoProducto: 'ACE-002',
        descripcion: 'Aceite vegetal 1 L',
        cantidad: 4,
        precioUnitario: 9.2,
        igv: 6.62,
      },
    ];

    const instrucciones = [
      'Una fila por línea de detalle. Las filas con el mismo tipo, serie, número y documento de la contraparte forman un solo comprobante.',
      'No modifique la fila 1 (cabecera). Los datos empiezan en la fila 2: borre las filas de ejemplo antes de cargar.',
      'Tipo de comprobante: código de la Tabla 10 SUNAT (01 factura, 03 boleta). Las notas de crédito y débito no se cargan por plantilla.',
      'El producto se identifica por su código en Coplacont. Si un código no existe, la carga le pedirá elegir o crear el producto.',
      'Fechas en formato DD/MM/AAAA. Montos con punto decimal. El precio unitario va sin IGV; el IGV es el de toda la línea.',
      'Moneda PEN o USD. En USD el tipo de cambio es obligatorio.',
      'Máximo 500 filas por archivo.',
    ];

    return {
      titulo: `Plantilla de carga de ${tipo}`,
      nombreArchivo: `plantilla_${tipo}_coplacont`,
      soloTabla: true,
      empresa: null,
      secciones: [
        { nombre: tipo === 'compras' ? 'Compras' : 'Ventas', columnas, filas },
        {
          nombre: 'Instrucciones',
          columnas: [
            {
              clave: 'texto',
              titulo: 'Instrucciones',
              tipo: 'texto',
              ancho: 110,
            },
          ],
          filas: instrucciones.map((texto) => ({ texto })),
        },
      ],
    };
  }
}
