import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { runInTransaction } from 'typeorm-transactional';
import { MetodoValoracion } from '../../comprobantes/enum/metodo-valoracion.enum';
import { bloquearInventarios } from './bloqueo';
import {
  ConsumoLote,
  CostosDeSalidas,
  diaDe,
  EPSILON,
  LineaValorizada,
  MovimientoValorizable,
  ordenarMovimientos,
  ResultadoValoracion,
  SaldoValorizado,
  saldoVacio,
  valorizar,
} from './motor-valoracion';
import { MovimientoInventario, ValoracionService } from './valoracion.service';

/**
 * Lecturas desde el kardex materializado (por defecto). Con
 * KARDEX_MATERIALIZADO=false se usa el cálculo dinámico de la fase 4 para
 * comparar; la escritura siempre mantiene el kardex materializado al día.
 */
export const leerKardexMaterializado = (): boolean =>
  process.env.KARDEX_MATERIALIZADO !== 'false';

/** `pendiente_desde` que significa "recalcular desde el inicio". */
const DESDE_INICIO = '0001-01-01';
/** Ids provisionales para salidas que aún no existen (van después de todo lo registrado). */
const ID_PROVISIONAL = 1e15;
/** Filas por INSERT al escribir líneas del kardex. */
const LOTE_INSERT = 2000;

export interface SalidaPorCostear {
  idInventario: number;
  cantidad: number;
}

export interface SalidaCosteada {
  costoUnitario: number;
  consumos: ConsumoLote[];
}

/** Estado del kardex al inicio de un día: saldo valorizado y lotes con existencias. */
interface EstadoInicial {
  saldo: SaldoValorizado;
  ultimoOrden: number;
  ultimoDia: string | null;
}

export interface SaldoInventario {
  idInventario: number;
  cantidad: number;
  valor: number;
  costoUnitario: number;
  lotes: {
    idLote: number;
    cantidad: number;
    costoUnitario: number;
    cantidadInicial: number;
    fechaIngreso: Date;
    numeroLote?: string;
  }[];
}

export interface KardexLeido {
  saldoInicial: { cantidad: number; valor: number; costoUnitario: number };
  lineas: { linea: LineaValorizada; movimiento: MovimientoInventario }[];
  metodo: (fecha: Date) => MetodoValoracion;
}

export interface DiferenciaKardex {
  idInventario: number;
  detalle: string;
}

/**
 * Kardex materializado: cada movimiento guarda su costo y su saldo en
 * `kardex_linea`, y `inventario_saldo` guarda el saldo actual de cada inventario.
 *
 * - Escribir: lo que cambia el historial marca el inventario como pendiente
 *   desde un día (`marcarPendiente`) y el kardex se recalcula desde ese día
 *   (`asegurarAlDia`), partiendo del saldo guardado del día anterior.
 * - Leer: kardex, stock y reportes leen las líneas guardadas; antes se pone al
 *   día lo pendiente (también lo nunca materializado: no hace falta migrar).
 * - Siempre bajo el bloqueo por inventario, dentro de una transacción.
 */
@Injectable()
export class KardexMaterializadoService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly valoracion: ValoracionService,
  ) {}

  /** Dentro de `runInTransaction` es el manager de la transacción. */
  private get manager(): EntityManager {
    return this.dataSource.manager;
  }

  // ---------------------------------------------------------------------------
  // Escritura
  // ---------------------------------------------------------------------------

  /**
   * Marca inventarios para recalcular su kardex desde `dia` ('YYYY-MM-DD';
   * null = desde el inicio). Llamar después de cambiar el historial. El
   * recálculo ocurre en la siguiente lectura o escritura (o con `asegurarAlDia`).
   */
  async marcarPendiente(
    idsInventario: number[],
    dia: string | null = null,
  ): Promise<void> {
    const ids = [...new Set(idsInventario.map(Number))];
    if (ids.length === 0) return;
    await runInTransaction(async () => {
      // Serializa con un recálculo en curso para no perder la marca
      await bloquearInventarios(this.manager, ids);
      await this.manager.query(
        `INSERT INTO inventario_saldo (id_inventario, pendiente_desde)
         SELECT unnest($1::bigint[]), $3::date
         ON CONFLICT (id_inventario) DO UPDATE
           SET pendiente_desde = LEAST(
             COALESCE(inventario_saldo.pendiente_desde, $2::date), $2::date)`,
        // Un inventario sin kardex se calcula entero (no hay saldo previo guardado)
        [ids, dia ?? DESDE_INICIO, DESDE_INICIO],
      );
    });
  }

  /** Marca los inventarios de un movimiento (cambio de estado, alta manual). */
  async marcarPendientePorMovimiento(idMovimiento: number): Promise<void> {
    const filas: { id_inventario: string }[] = await this.manager.query(
      'SELECT DISTINCT id_inventario FROM movimiento_detalles WHERE id_movimiento = $1',
      [idMovimiento],
    );
    await this.marcarPendiente(filas.map((f) => Number(f.id_inventario)));
  }

  /** Marca y recalcula en la misma transacción (registro de comprobantes). */
  async recalcularDesde(
    idsInventario: number[],
    dia: string | null,
  ): Promise<void> {
    await this.marcarPendiente(idsInventario, dia);
    await this.asegurarAlDia(idsInventario);
  }

  /** Recalcula los inventarios pendientes o que nunca se materializaron. */
  async asegurarAlDia(idsInventario: number[]): Promise<void> {
    const ids = [...new Set(idsInventario.map(Number))];
    if (ids.length === 0) return;
    if ((await this.pendientes(ids)).size === 0) return;

    await runInTransaction(async () => {
      await bloquearInventarios(this.manager, ids);
      // Releer bajo bloqueo: otra petición pudo recalcularlos mientras esperábamos
      for (const [id, desde] of await this.pendientes(ids)) {
        await this.materializar(id, desde === DESDE_INICIO ? null : desde);
      }
    });
  }

  /** Inventarios por recalcular y desde qué día (null = nunca materializado). */
  private async pendientes(ids: number[]): Promise<Map<number, string | null>> {
    const filas: { id: string; desde: string | null }[] =
      await this.manager.query(
        `SELECT i.id, to_char(s.pendiente_desde, 'YYYY-MM-DD') AS desde
           FROM unnest($1::bigint[]) AS i(id)
           LEFT JOIN inventario_saldo s ON s.id_inventario = i.id
          WHERE s.id_inventario IS NULL OR s.pendiente_desde IS NOT NULL`,
        [ids],
      );
    return new Map(
      filas.map((f) => [Number(f.id), f.desde === null ? null : f.desde]),
    );
  }

  /**
   * Recalcula el kardex de un inventario desde `desde` (null = desde el inicio)
   * y guarda líneas, lotes consumidos, existencias por lote y saldo.
   */
  private async materializar(
    idInventario: number,
    desde: string | null,
  ): Promise<void> {
    let inicio = desde ? await this.estadoAl(idInventario, desde) : null;
    // Sin un estado previo confiable se recalcula todo
    if (!inicio) desde = null;

    const metodo =
      (await this.valoracion.metodosPara([idInventario])).get(idInventario) ??
      MetodoValoracion.PROMEDIO;
    const movimientos =
      (await this.valoracion.cargarMovimientos([idInventario], desde)).get(
        idInventario,
      ) ?? [];
    const conocidos = desde
      ? await this.costosDeSalidasPrevias(movimientos)
      : undefined;
    const resultado = valorizar(movimientos, metodo, inicio?.saldo, conocidos);
    inicio ??= { saldo: saldoVacio(), ultimoOrden: 0, ultimoDia: null };

    await this.manager.query(
      `DELETE FROM kardex_linea
        WHERE id_inventario = $1 AND ($2::date IS NULL OR dia >= $2::date)`,
      [idInventario, desde],
    );
    await this.insertarLineas(
      idInventario,
      movimientos,
      resultado,
      inicio.ultimoOrden,
    );
    await this.reasignarLotes(resultado.lineas);

    // Existencias por lote según el kardex
    const lotes = resultado.saldoFinal.lotes.filter((l) => l.idLote > 0);
    await this.manager.query(
      `UPDATE inventario_lote l
          SET cantidad_disponible = COALESCE((
            SELECT v.cantidad FROM unnest($2::bigint[], $3::numeric[]) AS v(id, cantidad)
             WHERE v.id = l.id), 0)
        WHERE l.id_inventario = $1`,
      [idInventario, lotes.map((l) => l.idLote), lotes.map((l) => l.cantidad)],
    );

    const ultima = resultado.lineas[resultado.lineas.length - 1];
    const saldo = resultado.saldoFinal;
    await this.manager.query(
      `INSERT INTO inventario_saldo AS s
         (id_inventario, cantidad, valor, costo_unitario, ultimo_dia, ultimo_orden,
          pendiente_desde, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, $5::date, $6, NULL, now())
       ON CONFLICT (id_inventario) DO UPDATE SET
         cantidad = EXCLUDED.cantidad, valor = EXCLUDED.valor,
         costo_unitario = EXCLUDED.costo_unitario, ultimo_dia = EXCLUDED.ultimo_dia,
         ultimo_orden = EXCLUDED.ultimo_orden, pendiente_desde = NULL,
         fecha_actualizacion = now()`,
      [
        idInventario,
        saldo.cantidad,
        saldo.valor,
        saldo.cantidad > EPSILON ? saldo.valor / saldo.cantidad : 0,
        ultima ? diaDe(ultima.fecha) : inicio.ultimoDia,
        inicio.ultimoOrden + resultado.lineas.length,
      ],
    );
  }

  private async insertarLineas(
    idInventario: number,
    movimientos: MovimientoValorizable[],
    resultado: ResultadoValoracion,
    ordenBase: number,
  ): Promise<void> {
    const lineas = resultado.lineas;
    for (let i = 0; i < lineas.length; i += LOTE_INSERT) {
      const tramo = lineas.slice(i, i + LOTE_INSERT);
      const col = <T>(f: (l: LineaValorizada, j: number) => T) =>
        tramo.map((l, k) => f(l, i + k));
      await this.manager.query(
        `INSERT INTO kardex_linea
           (id_inventario, orden, dia, id_movimiento_detalle, id_lote, tipo, cantidad,
            costo_unitario, costo_total, faltante, saldo_cantidad, saldo_valor,
            saldo_costo_unitario)
         SELECT $1, * FROM unnest($2::int[], $3::date[], $4::int[], $5::bigint[],
           $6::varchar[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[],
           $11::numeric[], $12::numeric[], $13::numeric[])`,
        [
          idInventario,
          col((_, j) => ordenBase + j + 1),
          col((l) => diaDe(l.fecha)),
          col((l) => (l.id > 0 ? l.id : null)),
          col((l, j) =>
            l.tipo === 'ENTRADA' ? (movimientos[j].idLote ?? null) : null,
          ),
          col((l) => l.tipo),
          col((l) => l.cantidad),
          col((l) => l.costoUnitario),
          col((l) => l.costoTotal),
          col((l) => l.faltante),
          col((l) => l.saldoCantidad),
          col((l) => l.saldoValor),
          col((l) => l.saldoCostoUnitario),
        ],
      );
    }
  }

  /** Reemplaza los lotes consumidos (`detalle_salidas`) de las salidas recalculadas. */
  private async reasignarLotes(lineas: LineaValorizada[]): Promise<void> {
    const candidatas = lineas.filter((l) => l.tipo === 'SALIDA' && l.id > 0);
    if (candidatas.length === 0) return;
    // Solo salidas reales (un ajuste negativo no tiene detalle de salida)
    const salidas: { id: string }[] = await this.manager.query(
      `SELECT md.id FROM movimiento_detalles md
         JOIN movimientos m ON m.id = md.id_movimiento
        WHERE md.id = ANY($1) AND m.tipo = 'SALIDA'`,
      [candidatas.map((l) => l.id)],
    );
    const ids = new Set(salidas.map((s) => Number(s.id)));
    const filas = candidatas
      .filter((l) => ids.has(l.id))
      .flatMap((l) =>
        l.consumos.map((c) => [
          l.id,
          c.idLote > 0 ? c.idLote : 0,
          c.costoUnitario,
          c.cantidad,
        ]),
      );
    await this.manager.query(
      'DELETE FROM detalle_salidas WHERE id_movimiento_detalle = ANY($1)',
      [[...ids]],
    );
    for (let i = 0; i < filas.length; i += LOTE_INSERT) {
      const tramo = filas.slice(i, i + LOTE_INSERT);
      await this.manager.query(
        `INSERT INTO detalle_salidas
           (id_movimiento_detalle, id_lote, costo_unitario_de_lote, cantidad)
         SELECT * FROM unnest($1::int[], $2::int[], $3::numeric[], $4::numeric[])`,
        [0, 1, 2, 3].map((k) => tramo.map((f) => f[k])),
      );
    }
  }

  /**
   * Estado guardado al inicio de `dia`: saldo de la última línea anterior y lotes
   * con existencias (entradas menos lo que consumieron las salidas anteriores).
   * null si no es confiable (entradas sin lote, lotes que no cuadran con el saldo).
   */
  private async estadoAl(
    idInventario: number,
    dia: string,
  ): Promise<EstadoInicial | null> {
    const [ultima]: {
      orden: number;
      dia: string;
      saldo_cantidad: string;
      saldo_valor: string;
    }[] = await this.manager.query(
      `SELECT orden, to_char(dia, 'YYYY-MM-DD') AS dia, saldo_cantidad, saldo_valor
         FROM kardex_linea
        WHERE id_inventario = $1 AND dia < $2::date
        ORDER BY orden DESC LIMIT 1`,
      [idInventario, dia],
    );
    if (!ultima) {
      return { saldo: saldoVacio(), ultimoOrden: 0, ultimoDia: null };
    }

    const lotes: {
      id_lote: string | null;
      orden: number;
      costo: string;
      disponible: string;
    }[] = await this.manager.query(
      `WITH ent AS (
         SELECT id_lote, MIN(orden) AS orden, SUM(cantidad) AS cantidad,
                (array_agg(costo_unitario ORDER BY orden))[1] AS costo
           FROM kardex_linea
          WHERE id_inventario = $1 AND dia < $2::date AND tipo = 'ENTRADA'
          GROUP BY id_lote
       ),
       sal AS (
         SELECT ds.id_lote, SUM(ds.cantidad) AS cantidad
           FROM kardex_linea k
           JOIN detalle_salidas ds ON ds.id_movimiento_detalle = k.id_movimiento_detalle
          WHERE k.id_inventario = $1 AND k.dia < $2::date AND k.tipo = 'SALIDA'
          GROUP BY ds.id_lote
       )
       SELECT ent.id_lote, ent.orden, ent.costo,
              ent.cantidad - COALESCE(sal.cantidad, 0) AS disponible
         FROM ent LEFT JOIN sal ON sal.id_lote = ent.id_lote`,
      [idInventario, dia],
    );
    if (lotes.some((l) => l.id_lote === null)) return null;

    const conStock = lotes
      .map((l) => ({
        idLote: Number(l.id_lote),
        cantidad: Number(l.disponible),
        costoUnitario: Number(l.costo),
        orden: Number(l.orden),
      }))
      .filter((l) => l.cantidad > EPSILON);
    const cantidad = Number(ultima.saldo_cantidad);
    const enLotes = conStock.reduce((s, l) => s + l.cantidad, 0);
    if (Math.abs(enLotes - cantidad) > 1e-4) return null;

    return {
      saldo: { cantidad, valor: Number(ultima.saldo_valor), lotes: conStock },
      ultimoOrden: Number(ultima.orden),
      ultimoDia: ultima.dia,
    };
  }

  /** Costo guardado de las salidas que devuelven las entradas del tramo. */
  private async costosDeSalidasPrevias(
    movimientos: MovimientoValorizable[],
  ): Promise<CostosDeSalidas> {
    const enTramo = new Set(movimientos.map((m) => m.id));
    const ids = [
      ...new Set(movimientos.flatMap((m) => m.costoDeSalidas ?? [])),
    ].filter((id) => !enTramo.has(id));
    if (ids.length === 0) return new Map();
    const filas: { id: string; cantidad: string; costo: string }[] =
      await this.manager.query(
        `SELECT id_movimiento_detalle AS id, cantidad - faltante AS cantidad,
                costo_total AS costo
           FROM kardex_linea WHERE id_movimiento_detalle = ANY($1)`,
        [ids],
      );
    return new Map(
      filas.map((f) => [
        Number(f.id),
        { cantidad: Number(f.cantidad), costo: Number(f.costo) },
      ]),
    );
  }

  // ---------------------------------------------------------------------------
  // Registro de salidas
  // ---------------------------------------------------------------------------

  /**
   * Costo y lotes de salidas por registrar en `fecha`, en el orden recibido.
   * Valoriza desde el saldo guardado del día con las salidas insertadas; si dejan
   * sin stock a la propia salida o a una posterior, lanza 400 (stock en el tiempo).
   * Llamar dentro de la transacción, con los inventarios ya bloqueados; después
   * de guardar el movimiento, `recalcularDesde` actualiza el kardex.
   */
  async costearSalidas(
    salidas: SalidaPorCostear[],
    fecha: Date,
  ): Promise<SalidaCosteada[]> {
    const ids = [...new Set(salidas.map((s) => Number(s.idInventario)))];
    await this.asegurarAlDia(ids);
    const dia = diaDe(fecha);
    const metodos = await this.valoracion.metodosPara(ids);
    const costeadas = new Array<SalidaCosteada>(salidas.length);

    for (const idInventario of ids) {
      const inicio = await this.estadoAl(idInventario, dia);
      const existentes =
        (
          await this.valoracion.cargarMovimientos(
            [idInventario],
            inicio ? dia : null,
          )
        ).get(idInventario) ?? [];
      const conocidos = await this.costosDeSalidasPrevias(existentes);
      const metodo = metodos.get(idInventario) ?? MetodoValoracion.PROMEDIO;
      const nuevas = salidas
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => Number(s.idInventario) === idInventario)
        .map(({ s, i }) => ({
          indice: i,
          mov: {
            id: ID_PROVISIONAL + i,
            fecha,
            tipo: 'SALIDA' as const,
            cantidad: Number(s.cantidad),
          },
        }));

      const antes = valorizar(existentes, metodo, inicio?.saldo, conocidos);
      const despues = valorizar(
        ordenarMovimientos([...existentes, ...nuevas.map((n) => n.mov)]),
        metodo,
        inicio?.saldo,
        conocidos,
      );
      const faltante = (r: ResultadoValoracion) =>
        r.lineas.reduce((s, l) => s + l.faltante, 0);

      if (faltante(despues) - faltante(antes) > EPSILON) {
        const faltaEnPropias = despues.lineas.some(
          (l) => l.id >= ID_PROVISIONAL && l.faltante > EPSILON,
        );
        const disponible =
          antes.lineas.filter((l) => diaDe(l.fecha) <= dia).slice(-1)[0]
            ?.saldoCantidad ??
          inicio?.saldo.cantidad ??
          0;
        throw new BadRequestException(
          faltaEnPropias
            ? `Stock insuficiente para el inventario ${idInventario}: disponible al ` +
              `${dia}: ${Number(disponible).toFixed(4)}`
            : `Stock insuficiente para el inventario ${idInventario}: con esta salida ` +
              'faltaría stock para salidas posteriores (revise ventas posteriores)',
        );
      }

      for (const { indice, mov } of nuevas) {
        const linea = despues.lineas.find((l) => l.id === mov.id)!;
        costeadas[indice] = {
          costoUnitario: linea.costoUnitario,
          // Lotes ficticios (entradas sin lote) se registran como lote 0
          consumos: linea.consumos.map((c) => ({
            ...c,
            idLote: c.idLote > 0 ? c.idLote : 0,
          })),
        };
      }
    }
    return costeadas;
  }

  /**
   * Costo unitario con que salió cada inventario en un comprobante (para que
   * su devolución reingrese a ese costo).
   */
  async costoDeSalidaDe(
    idComprobante: number,
    idsInventario: number[],
  ): Promise<Map<number, number>> {
    await this.asegurarAlDia(idsInventario);
    const filas: { id_inventario: string; costo: string; cantidad: string }[] =
      await this.manager.query(
        `SELECT k.id_inventario, SUM(k.costo_total) AS costo,
                SUM(k.cantidad - k.faltante) AS cantidad
           FROM kardex_linea k
           JOIN movimiento_detalles md ON md.id = k.id_movimiento_detalle
           JOIN movimientos m ON m.id = md.id_movimiento
          WHERE m.id_comprobante = $1 AND m.tipo = 'SALIDA'
            AND k.id_inventario = ANY($2)
          GROUP BY k.id_inventario`,
        [idComprobante, idsInventario],
      );
    const costos = new Map<number, number>();
    for (const f of filas) {
      if (Number(f.cantidad) > EPSILON) {
        costos.set(
          Number(f.id_inventario),
          Number(f.costo) / Number(f.cantidad),
        );
      }
    }
    return costos;
  }

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  /** Líneas del kardex entre dos días (incluidos) y el saldo al inicio. */
  async leerKardex(
    idInventario: number,
    desde: string,
    hasta: string,
  ): Promise<KardexLeido> {
    await this.asegurarAlDia([idInventario]);
    const [anterior]: {
      saldo_cantidad: string;
      saldo_valor: string;
      saldo_costo_unitario: string;
    }[] = await this.manager.query(
      `SELECT saldo_cantidad, saldo_valor, saldo_costo_unitario FROM kardex_linea
        WHERE id_inventario = $1 AND dia < $2::date
        ORDER BY orden DESC LIMIT 1`,
      [idInventario, desde],
    );
    const filas: {
      id_movimiento_detalle: number | null;
      id_lote: string | null;
      dia: string;
      tipo: 'ENTRADA' | 'SALIDA';
      cantidad: string;
      costo_unitario: string;
      costo_total: string;
      faltante: string;
      saldo_cantidad: string;
      saldo_valor: string;
      saldo_costo_unitario: string;
    }[] = await this.manager.query(
      `SELECT id_movimiento_detalle, id_lote, to_char(dia, 'YYYY-MM-DD') AS dia, tipo,
              cantidad, costo_unitario, costo_total, faltante, saldo_cantidad,
              saldo_valor, saldo_costo_unitario
         FROM kardex_linea
        WHERE id_inventario = $1 AND dia >= $2::date AND dia <= $3::date
        ORDER BY orden`,
      [idInventario, desde, hasta],
    );

    // Datos de cada movimiento (comprobante, operación) y lotes consumidos
    const movimientos = new Map(
      (
        (await this.valoracion.cargarMovimientos([idInventario], desde)).get(
          idInventario,
        ) ?? []
      ).map((m) => [m.id, m]),
    );
    const idsSalida = filas
      .filter((f) => f.tipo === 'SALIDA' && f.id_movimiento_detalle)
      .map((f) => f.id_movimiento_detalle);
    const consumos: {
      id_movimiento_detalle: number;
      id_lote: number;
      cantidad: string;
      costo: string;
    }[] = idsSalida.length
      ? await this.manager.query(
          `SELECT id_movimiento_detalle, id_lote, cantidad,
                  costo_unitario_de_lote AS costo
             FROM detalle_salidas WHERE id_movimiento_detalle = ANY($1)
            ORDER BY id`,
          [idsSalida],
        )
      : [];

    const metodo =
      (await this.valoracion.metodosPara([idInventario])).get(idInventario) ??
      (() => MetodoValoracion.PROMEDIO);

    return {
      saldoInicial: {
        cantidad: Number(anterior?.saldo_cantidad ?? 0),
        valor: Number(anterior?.saldo_valor ?? 0),
        costoUnitario: Number(anterior?.saldo_costo_unitario ?? 0),
      },
      metodo,
      lineas: filas.map((f) => {
        const id = f.id_movimiento_detalle ?? -Number(f.id_lote);
        const fecha = new Date(`${f.dia}T12:00:00Z`);
        return {
          movimiento:
            movimientos.get(id) ??
            ({
              id,
              idInventario,
              fecha,
              tipo: f.tipo,
              cantidad: Number(f.cantidad),
              idMovimiento: null,
              numeroDocumento: null,
              codigoOperacion: null,
              operacion: null,
              codigoComprobante: null,
              comprobante: null,
              serie: null,
              numero: null,
            } as MovimientoInventario),
          linea: {
            id,
            fecha,
            tipo: f.tipo,
            cantidad: Number(f.cantidad),
            costoUnitario: Number(f.costo_unitario),
            costoTotal: Number(f.costo_total),
            faltante: Number(f.faltante),
            saldoCantidad: Number(f.saldo_cantidad),
            saldoValor: Number(f.saldo_valor),
            saldoCostoUnitario: Number(f.saldo_costo_unitario),
            consumos: consumos
              .filter((c) => Number(c.id_movimiento_detalle) === id)
              .map((c) => ({
                idLote: Number(c.id_lote),
                cantidad: Number(c.cantidad),
                costoUnitario: Number(c.costo),
              })),
          },
        };
      }),
    };
  }

  /**
   * Saldo de cada inventario y sus lotes con existencias. Sin `hastaDia`, o si
   * no hay movimientos posteriores a ese día, es el saldo actual guardado.
   */
  async saldos(
    idsInventario: number[],
    hastaDia?: string,
  ): Promise<Map<number, SaldoInventario>> {
    const ids = [...new Set(idsInventario.map(Number))];
    const resultado = new Map<number, SaldoInventario>();
    if (ids.length === 0) return resultado;
    await this.asegurarAlDia(ids);

    const actuales: {
      id: string;
      cantidad: string;
      valor: string;
      costo_unitario: string;
      ultimo_dia: string | null;
    }[] = await this.manager.query(
      `SELECT i.id, s.cantidad, s.valor, s.costo_unitario,
              to_char(s.ultimo_dia, 'YYYY-MM-DD') AS ultimo_dia
         FROM inventario i JOIN inventario_saldo s ON s.id_inventario = i.id
        WHERE i.id = ANY($1)`,
      [ids],
    );
    const lotes: {
      id: string;
      id_inventario: string;
      disponible: string;
      costo: string;
      cantidad_inicial: string;
      fecha_ingreso: Date;
      numero_lote: string;
    }[] = await this.manager.query(
      `SELECT l.id, l.id_inventario, l.cantidad_disponible AS disponible,
              l."costoUnitario" AS costo, l."cantidadInicial" AS cantidad_inicial,
              l."fechaIngreso" AS fecha_ingreso, l."numeroLote" AS numero_lote
         FROM inventario_lote l
        WHERE l.id_inventario = ANY($1) AND l.cantidad_disponible > 0
        ORDER BY l."fechaIngreso", l.id`,
      [ids],
    );
    const infoLote = new Map(lotes.map((l) => [Number(l.id), l]));

    for (const a of actuales) {
      const id = Number(a.id);
      let saldo: SaldoInventario = {
        idInventario: id,
        cantidad: Number(a.cantidad),
        valor: Number(a.valor),
        costoUnitario: Number(a.costo_unitario),
        lotes: lotes
          .filter((l) => Number(l.id_inventario) === id)
          .map((l) => ({
            idLote: Number(l.id),
            cantidad: Number(l.disponible),
            costoUnitario: Number(l.costo),
            cantidadInicial: Number(l.cantidad_inicial),
            fechaIngreso: new Date(l.fecha_ingreso),
            numeroLote: l.numero_lote,
          })),
      };
      // Saldo a una fecha anterior al último movimiento
      if (hastaDia && a.ultimo_dia && hastaDia < a.ultimo_dia) {
        saldo = await this.saldoAl(id, hastaDia, infoLote);
      }
      resultado.set(id, saldo);
    }
    return resultado;
  }

  private async saldoAl(
    idInventario: number,
    hastaDia: string,
    infoLote: Map<number, { cantidad_inicial: string; fecha_ingreso: Date }>,
  ): Promise<SaldoInventario> {
    const siguiente = new Date(`${hastaDia}T12:00:00Z`);
    siguiente.setUTCDate(siguiente.getUTCDate() + 1);
    const estado = await this.estadoAl(idInventario, diaDe(siguiente));
    const saldo = estado?.saldo ?? saldoVacio();
    const lotesBD: {
      id: string;
      cantidad_inicial: string;
      fecha_ingreso: Date;
      numero_lote: string;
    }[] = await this.manager.query(
      `SELECT id, "cantidadInicial" AS cantidad_inicial, "fechaIngreso" AS fecha_ingreso,
              "numeroLote" AS numero_lote
         FROM inventario_lote WHERE id = ANY($1)`,
      [saldo.lotes.map((l) => l.idLote)],
    );
    const porId = new Map(lotesBD.map((l) => [Number(l.id), l]));
    return {
      idInventario,
      cantidad: saldo.cantidad,
      valor: saldo.valor,
      costoUnitario:
        saldo.cantidad > EPSILON ? saldo.valor / saldo.cantidad : 0,
      lotes: saldo.lotes.map((l) => {
        const info = porId.get(l.idLote) ?? infoLote.get(l.idLote);
        return {
          idLote: l.idLote,
          cantidad: l.cantidad,
          costoUnitario: l.costoUnitario,
          cantidadInicial: Number(info?.cantidad_inicial ?? 0),
          fechaIngreso: new Date(info?.fecha_ingreso ?? 0),
          numeroLote: (info as { numero_lote?: string } | undefined)
            ?.numero_lote,
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Verificación
  // ---------------------------------------------------------------------------

  /**
   * Compara el kardex guardado con un cálculo desde cero (mismo motor). Sirve
   * para detectar un recálculo incompleto; con datos al día no debe haber diferencias.
   */
  async verificar(idsInventario: number[]): Promise<DiferenciaKardex[]> {
    const ids = [...new Set(idsInventario.map(Number))];
    await this.asegurarAlDia(ids);
    const calculado = await this.valoracion.valorizarInventarios(ids);
    const diferencias: DiferenciaKardex[] = [];
    const cerca = (a: number, b: number) => Math.abs(a - b) <= 1e-3;

    for (const id of ids) {
      const guardadas: {
        tipo: string;
        cantidad: string;
        costo_total: string;
        saldo_cantidad: string;
        saldo_valor: string;
      }[] = await this.manager.query(
        `SELECT tipo, cantidad, costo_total, saldo_cantidad, saldo_valor
           FROM kardex_linea WHERE id_inventario = $1 ORDER BY orden`,
        [id],
      );
      const lineas = calculado.get(id)?.resultado.lineas ?? [];
      if (guardadas.length !== lineas.length) {
        diferencias.push({
          idInventario: id,
          detalle: `${guardadas.length} líneas guardadas, ${lineas.length} calculadas`,
        });
        continue;
      }
      const distinta = lineas.findIndex((l, i) => {
        const g = guardadas[i];
        return !(
          g.tipo === l.tipo &&
          cerca(Number(g.cantidad), l.cantidad) &&
          cerca(Number(g.costo_total), l.costoTotal) &&
          cerca(Number(g.saldo_cantidad), l.saldoCantidad) &&
          cerca(Number(g.saldo_valor), l.saldoValor)
        );
      });
      if (distinta >= 0) {
        diferencias.push({
          idInventario: id,
          detalle: `la línea ${distinta + 1} no coincide`,
        });
      }
    }
    return diferencias;
  }

  /** Salidas registradas sin stock suficiente (datos antiguos inconsistentes). */
  async faltantes(
    idsInventario: number[],
  ): Promise<{ idInventario: number; dia: string; faltante: number }[]> {
    await this.asegurarAlDia(idsInventario);
    const filas: { id_inventario: string; dia: string; faltante: string }[] =
      await this.manager.query(
        `SELECT id_inventario, to_char(dia, 'YYYY-MM-DD') AS dia, faltante
           FROM kardex_linea
          WHERE id_inventario = ANY($1) AND faltante > 0
          ORDER BY id_inventario, orden`,
        [idsInventario],
      );
    return filas.map((f) => ({
      idInventario: Number(f.id_inventario),
      dia: f.dia,
      faltante: Number(f.faltante),
    }));
  }
}
