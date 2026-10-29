import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DocumentoTabular } from 'src/modules/reportes/documento-tabular';
import { ReportesService } from 'src/modules/reportes/reportes.service';
import { HOJA_COMPROBANTES, HOJA_DETALLE } from './plantilla.parser';

/** Fecha de ejemplo (12:00 UTC para que no cambie de día en ninguna zona) */
const fecha = (dia: string) => new Date(`${dia}T12:00:00Z`);

/**
 * Plantilla Excel de Coplacont para cargar compras y ventas en cola:
 * GET /api/reportes/plantilla-comprobantes?formato=xlsx
 */
@Injectable()
export class PlantillaReporte implements OnModuleInit {
  constructor(private readonly reportes: ReportesService) {}

  onModuleInit(): void {
    this.reportes.registrar({
      clave: 'plantilla-comprobantes',
      generar: () => Promise.resolve(PlantillaReporte.documento()),
    });
  }

  static documento(): DocumentoTabular {
    return {
      titulo: 'Plantilla de comprobantes',
      nombreArchivo: 'plantilla_comprobantes_coplacont',
      soloTabla: true,
      empresa: null,
      secciones: [
        {
          nombre: HOJA_COMPROBANTES,
          columnas: [
            { clave: 'n', titulo: 'N°', tipo: 'texto', ancho: 6 },
            {
              clave: 'operacion',
              titulo: 'Operación',
              tipo: 'texto',
              ancho: 11,
            },
            {
              clave: 'tipo',
              titulo: 'Tipo comprobante',
              tipo: 'texto',
              ancho: 11,
            },
            { clave: 'serie', titulo: 'Serie', tipo: 'texto', ancho: 8 },
            { clave: 'numero', titulo: 'Número', tipo: 'texto', ancho: 11 },
            {
              clave: 'emision',
              titulo: 'Fecha emisión',
              tipo: 'fecha',
              ancho: 13,
            },
            {
              clave: 'vencimiento',
              titulo: 'Fecha vencimiento',
              tipo: 'fecha',
              ancho: 13,
            },
            {
              clave: 'tipoDoc',
              titulo: 'Tipo doc. contraparte',
              tipo: 'texto',
              ancho: 11,
            },
            {
              clave: 'doc',
              titulo: 'N° doc. contraparte',
              tipo: 'texto',
              ancho: 14,
            },
            {
              clave: 'nombre',
              titulo: 'Nombre o razón social',
              tipo: 'texto',
              ancho: 30,
            },
            { clave: 'moneda', titulo: 'Moneda', tipo: 'texto', ancho: 8 },
            {
              clave: 'tc',
              titulo: 'Tipo de cambio',
              tipo: 'numero',
              decimales: 3,
              ancho: 10,
            },
            {
              clave: 'gravada',
              titulo: 'Base gravada',
              tipo: 'moneda',
              ancho: 12,
            },
            {
              clave: 'exonerado',
              titulo: 'Exonerado',
              tipo: 'moneda',
              ancho: 11,
            },
            {
              clave: 'inafecto',
              titulo: 'Inafecto',
              tipo: 'moneda',
              ancho: 11,
            },
            { clave: 'igv', titulo: 'IGV', tipo: 'moneda', ancho: 11 },
            { clave: 'total', titulo: 'Total', tipo: 'moneda', ancho: 12 },
            {
              clave: 'modifica',
              titulo: 'Doc. que modifica',
              tipo: 'texto',
              ancho: 14,
            },
          ],
          filas: [
            {
              n: '1',
              operacion: 'COMPRA',
              tipo: '01',
              serie: 'F001',
              numero: '1234',
              emision: fecha('2026-05-10'),
              vencimiento: fecha('2026-06-09'),
              tipoDoc: '6',
              doc: '20100055237',
              nombre: 'DISTRIBUIDORA EJEMPLO S.A.C.',
              moneda: 'PEN',
              tc: 1,
            },
            {
              n: '2',
              operacion: 'VENTA',
              tipo: '03',
              serie: 'B001',
              numero: '45',
              emision: fecha('2026-05-11'),
              tipoDoc: '0',
              nombre: 'VARIOS',
              moneda: 'PEN',
              tc: 1,
              gravada: 100,
              igv: 18,
              total: 118,
            },
            {
              n: '3',
              operacion: 'COMPRA',
              tipo: '07',
              serie: 'FC01',
              numero: '7',
              emision: fecha('2026-05-15'),
              tipoDoc: '6',
              doc: '20100055237',
              nombre: 'DISTRIBUIDORA EJEMPLO S.A.C.',
              moneda: 'PEN',
              tc: 1,
              modifica: 'F001-1234',
            },
          ],
        },
        {
          nombre: HOJA_DETALLE,
          columnas: [
            {
              clave: 'ref',
              titulo: 'N° comprobante',
              tipo: 'texto',
              ancho: 12,
            },
            { clave: 'tipo', titulo: 'Tipo línea', tipo: 'texto', ancho: 11 },
            {
              clave: 'codigo',
              titulo: 'Código producto',
              tipo: 'texto',
              ancho: 14,
            },
            {
              clave: 'cuenta',
              titulo: 'Cuenta contable',
              tipo: 'texto',
              ancho: 12,
            },
            {
              clave: 'descripcion',
              titulo: 'Descripción',
              tipo: 'texto',
              ancho: 32,
            },
            {
              clave: 'cantidad',
              titulo: 'Cantidad',
              tipo: 'cantidad',
              ancho: 10,
            },
            {
              clave: 'importe',
              titulo: 'Importe sin IGV',
              tipo: 'moneda',
              ancho: 13,
            },
            { clave: 'igv', titulo: 'IGV', tipo: 'texto', ancho: 12 },
          ],
          filas: [
            {
              ref: '1',
              tipo: 'PRODUCTO',
              codigo: 'ACE-001',
              descripcion: 'Aceite Primor 1 L',
              cantidad: 24,
              importe: 600,
              igv: 'GRAVADO',
            },
            {
              ref: '1',
              tipo: 'GASTO',
              cuenta: '6371',
              descripcion: 'Flete',
              cantidad: 1,
              importe: 50,
              igv: 'GRAVADO',
            },
            {
              ref: '3',
              tipo: 'PRODUCTO',
              codigo: 'ACE-001',
              descripcion: 'Devolución de aceite',
              cantidad: 12,
              importe: 300,
              igv: 'GRAVADO',
            },
          ],
        },
        {
          nombre: 'Instrucciones',
          columnas: [
            {
              clave: 'texto',
              titulo: 'Instrucciones',
              tipo: 'texto',
              ancho: 120,
            },
          ],
          filas: [
            'Hoja Comprobantes: una fila por comprobante. Compras y ventas pueden ir juntas (Operación: COMPRA o VENTA).',
            'N°: número de fila que tú eliges (1, 2, 3…); une el comprobante con sus líneas de la hoja Detalle.',
            'Tipo comprobante (Tabla 10 SUNAT): 01 factura, 03 boleta, 07 nota de crédito, 08 nota de débito.',
            'Tipo doc. contraparte: 6 RUC, 1 DNI, 0 sin documento (boletas a VARIOS).',
            'Fechas en DD/MM/AAAA. Moneda PEN o USD; en USD indica el tipo de cambio.',
            'Notas de crédito y débito: en "Doc. que modifica" va la serie-número del comprobante (p. ej. F001-1234). Ese comprobante debe estar registrado o venir en la misma carga.',
            'Hoja Detalle (opcional): las líneas de cada comprobante. Tipo línea PRODUCTO (con el código del producto en Coplacont) o GASTO (con su cuenta contable, p. ej. 6371).',
            'Importe sin IGV es el de toda la línea. IGV de la línea: GRAVADO, EXONERADO o INAFECTO; el IGV se calcula al 18 %.',
            'Con detalle, las bases y el total de la hoja Comprobantes pueden quedar vacíos: se calculan de las líneas. Sin detalle, indica las bases e IGV.',
            'Al cargar, cada comprobante se revisa uno por uno: ahí confirmas los productos o completas el detalle que falte.',
            'Borra las filas de ejemplo antes de cargar. No cambies los nombres de las hojas ni de las columnas.',
          ].map((texto) => ({ texto })),
        },
      ],
    };
  }
}
