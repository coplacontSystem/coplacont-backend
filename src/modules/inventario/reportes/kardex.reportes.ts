import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { PertenenciaService } from 'src/common/pertenencia.service';
import { MetodoValoracion } from 'src/modules/comprobantes/enum/metodo-valoracion.enum';
import {
  Columna,
  DocumentoTabular,
  Fila,
} from 'src/modules/reportes/documento-tabular';
import { ReportesService } from 'src/modules/reportes/reportes.service';
import {
  ConsumoLote,
  diaDe,
  LineaValorizada,
} from '../valoracion/motor-valoracion';
import {
  MovimientoInventario,
  ValoracionService,
} from '../valoracion/valoracion.service';

export class FiltrosKardexReporte {
  @Type(() => Number)
  @IsInt({ message: 'idInventario debe ser un número entero' })
  @Min(1)
  idInventario!: number;

  @IsDateString({}, { message: 'fechaInicio debe ser una fecha (YYYY-MM-DD)' })
  fechaInicio!: string;

  @IsDateString({}, { message: 'fechaFin debe ser una fecha (YYYY-MM-DD)' })
  fechaFin!: string;
}

const MESES = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SETIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
];

/** Tabla 12 SUNAT: 16 = saldo inicial. */
const OPERACION_SALDO_INICIAL = '16';

const DOCUMENTO =
  'Documento de traslado, comprobante de pago, documento interno o similar';

/** Columnas comunes de los formatos 12.1 y 13.1. */
const COLUMNAS_DOCUMENTO: Columna[] = [
  { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha', grupo: DOCUMENTO },
  { clave: 'tipo', titulo: 'Tipo (Tabla 10)', tipo: 'texto', grupo: DOCUMENTO },
  { clave: 'serie', titulo: 'Serie', tipo: 'texto', grupo: DOCUMENTO },
  {
    clave: 'numero',
    titulo: 'Número',
    tipo: 'texto',
    grupo: DOCUMENTO,
    ancho: 1.3,
  },
  {
    clave: 'operacion',
    titulo: 'Tipo de operación (Tabla 12)',
    tipo: 'texto',
    ancho: 1.2,
  },
];

const valorizadas = (grupo: string, prefijo: string): Columna[] => [
  { clave: `${prefijo}Cantidad`, titulo: 'Cantidad', tipo: 'cantidad', grupo },
  {
    clave: `${prefijo}Unitario`,
    titulo: 'Costo unitario',
    tipo: 'moneda',
    grupo,
    decimales: 4,
  },
  { clave: `${prefijo}Total`, titulo: 'Costo total', tipo: 'moneda', grupo },
];

/**
 * Kardex exportable en los formatos SUNAT 13.1 (inventario permanente
 * valorizado) y 12.1 (unidades físicas), con el motor de valoración del backend.
 */
@Injectable()
export class KardexReportes implements OnModuleInit {
  constructor(
    private readonly reportes: ReportesService,
    private readonly valoracion: ValoracionService,
    private readonly pertenencia: PertenenciaService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.reportes.registrar<FiltrosKardexReporte>({
      clave: 'kardex',
      filtros: FiltrosKardexReporte,
      generar: (personaId, filtros) => this.kardex(personaId, filtros),
    });
  }

  private async kardex(
    personaId: number,
    filtros: FiltrosKardexReporte,
  ): Promise<DocumentoTabular> {
    const id = Number(filtros.idInventario);
    await this.pertenencia.inventarios([id], personaId);
    const desde = filtros.fechaInicio.slice(0, 10);
    const hasta = filtros.fechaFin.slice(0, 10);

    const [info]: {
      codigo: string;
      producto: string;
      almacen: string;
    }[] = await this.dataSource.query(
      `SELECT p.codigo, p.nombre AS producto, a.nombre AS almacen
         FROM inventario i
         JOIN producto p ON p.id = i.id_producto
         JOIN almacen a ON a.id = i.id_almacen
        WHERE i.id = $1`,
      [id],
    );
    const empresa = await this.reportes.datosEmpresa(personaId);
    const valorizado = (
      await this.valoracion.valorizarInventarios([id], undefined, {
        conLotes: true,
      })
    ).get(id);
    const metodoDe =
      (await this.valoracion.metodosPara([id])).get(id) ??
      (() => MetodoValoracion.PROMEDIO);
    const metodo = metodoDe(new Date(`${desde}T12:00:00Z`));
    const peps = metodo === MetodoValoracion.FIFO;

    const lineas = valorizado?.resultado.lineas ?? [];
    const movimientos = valorizado?.movimientos ?? [];
    const anteriores = lineas.filter((l) => diaDe(l.fecha) < desde);
    const inicial = anteriores[anteriores.length - 1];
    const enRango = lineas
      .map((linea, i) => ({ linea, movimiento: movimientos[i] }))
      .filter(({ linea }) => {
        const dia = diaDe(linea.fecha);
        return dia >= desde && dia <= hasta;
      });
    const final = enRango.length ? enRango[enRango.length - 1].linea : inicial;

    const valorizada: Fila[] = [];
    const fisica: Fila[] = [];
    if (inicial && inicial.saldoCantidad > 0) {
      const lotes = peps ? (inicial.lotes ?? []) : [];
      const filasSaldo = lotes.length
        ? lotes.map((l) => KardexReportes.saldo('saldo', l))
        : [KardexReportes.saldoTotal('saldo', inicial)];
      filasSaldo.forEach((saldo, i) =>
        valorizada.push({
          ...(i === 0 ? { operacion: OPERACION_SALDO_INICIAL } : {}),
          ...saldo,
        }),
      );
      fisica.push({
        operacion: OPERACION_SALDO_INICIAL,
        saldoCantidad: inicial.saldoCantidad,
      });
    }

    for (const { linea, movimiento } of enRango) {
      const documento = KardexReportes.documento(movimiento, linea);
      const esSalida = linea.tipo === 'SALIDA';
      const valoresMovimiento = (prefijo: string): Fila => ({
        [`${prefijo}Cantidad`]: linea.cantidad,
        [`${prefijo}Unitario`]: linea.costoUnitario,
        [`${prefijo}Total`]: linea.costoTotal,
      });

      // PEPS: una fila por lote consumido y por lote que queda en el saldo
      const consumos = peps && esSalida ? linea.consumos : [];
      const lotes = peps ? (linea.lotes ?? []) : [];
      const filas = Math.max(1, consumos.length, lotes.length);
      for (let i = 0; i < filas; i++) {
        const fila: Fila = i === 0 ? { ...documento } : {};
        if (i === 0 && !esSalida)
          Object.assign(fila, valoresMovimiento('entrada'));
        if (esSalida) {
          if (consumos.length) {
            if (consumos[i])
              Object.assign(fila, KardexReportes.saldo('salida', consumos[i]));
          } else if (i === 0) {
            Object.assign(fila, valoresMovimiento('salida'));
          }
        }
        if (lotes.length) {
          if (lotes[i])
            Object.assign(fila, KardexReportes.saldo('saldo', lotes[i]));
        } else if (i === 0) {
          Object.assign(fila, KardexReportes.saldoTotal('saldo', linea));
        }
        valorizada.push(fila);
      }

      fisica.push({
        ...documento,
        [esSalida ? 'salidaCantidad' : 'entradaCantidad']: linea.cantidad,
        saldoCantidad: linea.saldoCantidad,
      });
    }

    const suma = (
      tipo: 'ENTRADA' | 'SALIDA',
      campo: 'cantidad' | 'costoTotal',
    ) =>
      enRango
        .filter(({ linea }) => linea.tipo === tipo)
        .reduce((s, { linea }) => s + linea[campo], 0);
    const totales: Fila = {
      operacion: 'TOTALES',
      entradaCantidad: suma('ENTRADA', 'cantidad'),
      entradaTotal: suma('ENTRADA', 'costoTotal'),
      salidaCantidad: suma('SALIDA', 'cantidad'),
      salidaTotal: suma('SALIDA', 'costoTotal'),
      saldoCantidad: final?.saldoCantidad ?? 0,
      saldoTotal: final?.saldoValor ?? 0,
    };

    const periodo = KardexReportes.periodo(desde, hasta);
    const cabecera = (conMetodo: boolean): DocumentoTabular['datos'] => [
      { etiqueta: 'Período', valor: periodo },
      { etiqueta: 'RUC', valor: empresa?.ruc ?? '' },
      {
        etiqueta: 'Apellidos y nombres, denominación o razón social',
        valor: empresa?.razonSocial ?? '',
      },
      { etiqueta: 'Establecimiento (1)', valor: info?.almacen ?? '' },
      { etiqueta: 'Código de la existencia', valor: info?.codigo ?? '' },
      { etiqueta: 'Tipo (Tabla 5)', valor: '01' },
      { etiqueta: 'Descripción', valor: info?.producto ?? '' },
      { etiqueta: 'Código de la unidad de medida (Tabla 6)', valor: '01' },
      ...(conMetodo
        ? [
            {
              etiqueta: 'Método de valuación',
              valor: peps ? 'PEPS' : 'PROMEDIO',
            },
          ]
        : []),
    ];

    return {
      titulo: `KARDEX - ${info?.producto ?? ''} - ${info?.almacen ?? ''}`,
      nombreArchivo: `kardex_${info?.producto ?? 'producto'}_${info?.almacen ?? 'almacen'}_${periodo}`,
      empresa: null,
      datos: cabecera(true),
      orientacion: 'horizontal',
      secciones: [
        {
          nombre: 'Kardex Valorizado',
          titulo:
            'FORMATO 13.1: REGISTRO DE INVENTARIO PERMANENTE VALORIZADO - DETALLE DEL INVENTARIO VALORIZADO',
          columnas: [
            ...COLUMNAS_DOCUMENTO,
            ...valorizadas('Entradas', 'entrada'),
            ...valorizadas('Salidas', 'salida'),
            ...valorizadas('Saldo final', 'saldo'),
          ],
          filas: valorizada,
          totales,
        },
        {
          nombre: 'Kardex Unidades Físicas',
          titulo:
            'FORMATO 12.1: REGISTRO DEL INVENTARIO PERMANENTE EN UNIDADES FÍSICAS - DETALLE DEL INVENTARIO PERMANENTE EN UNIDADES FÍSICAS',
          columnas: [
            ...COLUMNAS_DOCUMENTO,
            { clave: 'entradaCantidad', titulo: 'Entradas', tipo: 'cantidad' },
            { clave: 'salidaCantidad', titulo: 'Salidas', tipo: 'cantidad' },
            { clave: 'saldoCantidad', titulo: 'Saldo final', tipo: 'cantidad' },
          ],
          filas: fisica,
          totales: {
            operacion: 'TOTALES',
            entradaCantidad: totales.entradaCantidad,
            salidaCantidad: totales.salidaCantidad,
            saldoCantidad: totales.saldoCantidad,
          },
        },
      ],
    };
  }

  /** Fecha, tipo de comprobante, serie, número y tipo de operación. */
  private static documento(
    movimiento: MovimientoInventario,
    linea: LineaValorizada,
  ): Fila {
    let serie = movimiento.serie ?? '';
    let numero = movimiento.numero ?? '';
    if (!serie && !numero && movimiento.numeroDocumento) {
      const [s, ...resto] = movimiento.numeroDocumento.split('-');
      [serie, numero] = resto.length ? [s, resto.join('-')] : ['', s];
    }
    const saldoInicial = movimiento.numeroDocumento === 'INV-INIT';
    return {
      fecha: linea.fecha,
      tipo: movimiento.codigoComprobante ?? '',
      serie,
      numero,
      operacion: saldoInicial
        ? OPERACION_SALDO_INICIAL
        : (movimiento.codigoOperacion ?? ''),
    };
  }

  private static saldo(prefijo: string, lote: ConsumoLote): Fila {
    return {
      [`${prefijo}Cantidad`]: lote.cantidad,
      [`${prefijo}Unitario`]: lote.costoUnitario,
      [`${prefijo}Total`]: lote.cantidad * lote.costoUnitario,
    };
  }

  private static saldoTotal(prefijo: string, linea: LineaValorizada): Fila {
    return {
      [`${prefijo}Cantidad`]: linea.saldoCantidad,
      [`${prefijo}Unitario`]: linea.saldoCostoUnitario,
      [`${prefijo}Total`]: linea.saldoValor,
    };
  }

  /** "MARZO 2026", "2026" o "01/03/2026 - 15/03/2026". */
  private static periodo(desde: string, hasta: string): string {
    const [ad, md, dd] = desde.split('-').map(Number);
    const [ah, mh, dh] = hasta.split('-').map(Number);
    const ultimoDia = new Date(Date.UTC(ah, mh, 0)).getUTCDate();
    if (ad === ah && dd === 1 && dh === ultimoDia) {
      if (md === 1 && mh === 12) return String(ad);
      if (md === mh) return `${MESES[md - 1]} ${ad}`;
    }
    const f = (d: string) => d.split('-').reverse().join('/');
    return `${f(desde)} - ${f(hasta)}`;
  }
}
