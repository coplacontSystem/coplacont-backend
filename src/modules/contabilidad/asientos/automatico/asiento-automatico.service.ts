import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AsientoService } from '../asiento.service';
import type { LineaAsientoDto } from '../asiento.types';
import { PlanContableService } from '../../plan-contable.service';
import {
  CUENTAS_AUTOMATICAS,
  ClaveCuenta,
  ConfiguracionContable,
  CuentasAutomaticas,
  cuentasPorDefecto,
} from './cuentas-automaticas';

type Fila = Record<string, any>;

const centimos = (n: number) => Math.round(Number(n) * 100);

/** Suma importes por cuenta en un lado del asiento */
class Lado {
  private readonly porCuenta = new Map<string, number>();
  agregar(cuenta: string, importe: number) {
    const c = centimos(importe);
    if (c > 0)
      this.porCuenta.set(cuenta, (this.porCuenta.get(cuenta) ?? 0) + c);
  }
  get total() {
    let t = 0;
    for (const v of this.porCuenta.values()) t += v;
    return t;
  }
  entradas() {
    return [...this.porCuenta.entries()];
  }
}

export interface ResultadoGeneracion {
  generados: number;
  actualizados: number;
  errores: { idComprobante: number; comprobante: string; error: string }[];
}

/**
 * Asiento automático de cada compra y venta (Libro Diario con todas las
 * operaciones, una factura = un asiento), con sus destinos:
 *
 * - Compra: 60 (o la cuenta de gasto de la línea) + 40 IGV contra 42.
 *   Destino: 20 contra 61 por las mercaderías; 9x (área) contra 79 por los
 *   gastos de la clase 6 con área.
 * - Venta: 12 contra 40 IGV y 70 (o la cuenta de ingreso de la línea).
 *   Costo de ventas desde el kardex: 69 contra 20.
 * - Nota de crédito: el mismo asiento al revés (en ventas, con 709).
 * - En dólares, todo se convierte a soles con el tipo de cambio.
 */
@Injectable()
export class AsientoAutomaticoService {
  private readonly logger = new Logger(AsientoAutomaticoService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly asientos: AsientoService,
    private readonly plan: PlanContableService,
  ) {}

  /* ---------- Cuentas ---------- */

  async cuentas(personaId: number): Promise<CuentasAutomaticas> {
    const c = await this.dataSource
      .getRepository(ConfiguracionContable)
      .findOne({ where: { idPersona: personaId } });
    // Lo sugerido por el plan de la empresa, y encima lo que ella eligió
    return { ...(await this.porDefecto(personaId)), ...(c?.cuentas ?? {}) };
  }

  /** Cuentas sugeridas por el plan de la empresa (o las de siempre) */
  private async porDefecto(personaId: number): Promise<CuentasAutomaticas> {
    const plan = await this.plan.planDe(personaId);
    const sugeridas = Object.fromEntries(
      Object.entries(plan.cuentasSugeridas ?? {}).filter(
        ([k]) => k in CUENTAS_AUTOMATICAS,
      ),
    );
    return { ...cuentasPorDefecto(), ...sugeridas };
  }

  async vistaCuentas(personaId: number) {
    const elegidas = await this.cuentas(personaId);
    const base = await this.porDefecto(personaId);
    const claves = Object.keys(CUENTAS_AUTOMATICAS) as ClaveCuenta[];
    return Promise.all(
      claves.map(async (clave) => {
        const codigo = elegidas[clave];
        // Una cuenta que ya no sirve (p. ej. otro plan) se muestra con su error
        const r = await this.plan
          .resolverImputables(personaId, [codigo])
          .then((m) => ({ nombre: m.get(codigo)?.nombre ?? null, error: null }))
          .catch((e: BadRequestException) => {
            const msg = (e.getResponse() as { message?: string[] }).message;
            return { nombre: null, error: msg?.[0] ?? e.message };
          });
        return {
          clave,
          uso: CUENTAS_AUTOMATICAS[clave].nombre,
          codigo,
          porDefecto: base[clave],
          nombreCuenta: r.nombre,
          error: r.error,
        };
      }),
    );
  }

  async guardarCuentas(
    personaId: number,
    cambios: Partial<CuentasAutomaticas>,
  ) {
    const claves = Object.keys(cambios).filter(
      (k): k is ClaveCuenta =>
        k in CUENTAS_AUTOMATICAS && !!cambios[k as ClaveCuenta],
    );
    if (!claves.length)
      throw new BadRequestException('No hay cuentas que cambiar');
    // resolverImputables falla si alguna no existe o agrupa subcuentas
    await this.plan.resolverImputables(
      personaId,
      claves.map((k) => cambios[k]!),
    );
    const repo = this.dataSource.getRepository(ConfiguracionContable);
    const actual =
      (await repo.findOne({ where: { idPersona: personaId } }))?.cuentas ?? {};
    const cuentas = { ...actual };
    const base = await this.porDefecto(personaId);
    for (const k of claves) {
      if (cambios[k] === base[k]) delete cuentas[k];
      else cuentas[k] = cambios[k];
    }
    await repo.save({ idPersona: personaId, cuentas });
    return this.vistaCuentas(personaId);
  }

  /* ---------- Generación ---------- */

  /** Tras registrar un comprobante: si falla, queda pendiente y no lo impide */
  async generarSinFallar(
    personaId: number,
    idComprobante: number,
    usuario: string,
  ) {
    try {
      await this.generar(personaId, idComprobante, usuario);
    } catch (e) {
      this.logger.warn(
        `Asiento del comprobante ${idComprobante} pendiente: ${(e as Error).message}`,
      );
    }
  }

  /** (Re)genera los asientos de las compras y ventas entre dos fechas */
  async generarRango(
    personaId: number,
    desde: string,
    hasta: string,
    usuario: string,
  ): Promise<ResultadoGeneracion> {
    const comprobantes: Fila[] = await this.dataSource.query(
      `SELECT c."idComprobante" AS id, c.serie, c.numero
         FROM comprobante c
         JOIN tabla_detalle op ON op."idTablaDetalle" = c.id_tipo_operacion
        WHERE c.id_persona = $1 AND op.codigo IN ('01', '02')
          AND c."fechaEmision"::date BETWEEN $2 AND $3
        ORDER BY c."fechaEmision", c."idComprobante"`,
      [personaId, desde, hasta],
    );
    const r: ResultadoGeneracion = {
      generados: 0,
      actualizados: 0,
      errores: [],
    };
    for (const c of comprobantes) {
      try {
        const { nuevo } = await this.generar(personaId, Number(c.id), usuario);
        if (nuevo) r.generados++;
        else r.actualizados++;
      } catch (e) {
        const resp = (e as BadRequestException).getResponse?.() as
          | { message?: string | string[] }
          | undefined;
        const msg = resp?.message ?? (e as Error).message;
        r.errores.push({
          idComprobante: Number(c.id),
          comprobante: `${c.serie}-${c.numero}`,
          error: Array.isArray(msg) ? msg.join('. ') : String(msg),
        });
      }
    }
    return r;
  }

  async generar(personaId: number, idComprobante: number, usuario: string) {
    const [c] = await this.dataSource.query(
      `SELECT c."idComprobante" AS id, c.serie, c.numero, c.moneda, c."tipoCambio" AS tc,
              to_char(c."fechaEmision", 'YYYY-MM-DD') AS fecha,
              op.codigo AS operacion, tc.codigo AS tipo,
              COALESCE(e."razonSocial", trim(concat_ws(' ', e.nombre, e."apellidoPaterno", e."apellidoMaterno"))) AS contraparte,
              t."totalGravada" AS gravada, t."totalExonerada" AS exonerada,
              t."totalInafecta" AS inafecta, t."totalIgv" AS igv, t."totalIsc" AS isc,
              t."totalGeneral" AS total
         FROM comprobante c
         JOIN tabla_detalle op ON op."idTablaDetalle" = c.id_tipo_operacion
         JOIN tabla_detalle tc ON tc."idTablaDetalle" = c.id_tipo_comprobante
         LEFT JOIN entidades e ON e.id = c.id_entidad
         LEFT JOIN comprobante_totales t ON t.id_comprobante = c."idComprobante"
        WHERE c."idComprobante" = $1 AND c.id_persona = $2`,
      [idComprobante, personaId],
    );
    if (!c)
      throw new NotFoundException(`Comprobante ${idComprobante} no encontrado`);
    if (c.operacion !== '01' && c.operacion !== '02') {
      throw new BadRequestException(
        'Solo las compras y ventas generan asiento automático',
      );
    }

    const detalles: Fila[] = await this.dataSource.query(
      `SELECT d.tipo_linea, d.subtotal, d.isc, cc.codigo AS cuenta, a.cuenta_destino
         FROM comprobante_detalle d
         LEFT JOIN cuenta_contable cc ON cc.id = d.id_cuenta_contable
         LEFT JOIN area_contable a ON a.id = d.id_area
        WHERE d.id_comprobante = $1 ORDER BY d."idDetalle"`,
      [idComprobante],
    );
    const cuentas = await this.cuentas(personaId);
    const venta = c.operacion === '01';
    const notaCredito = c.tipo === '07';
    const factor = c.moneda === 'USD' ? Number(c.tc) || 1 : 1;
    const s = (n: unknown) => (Number(n) || 0) * factor;

    // Lado "natural" del comprobante; una nota de crédito lo invierte
    const cargo = new Lado(); // compras: Debe · ventas: Haber
    const abono = new Lado(); // compras: Haber · ventas: Debe
    const destinoDebe = new Lado();
    const destinoHaber = new Lado();
    let mercaderias = 0;

    if (detalles.length) {
      for (const d of detalles) {
        const base = s(d.subtotal) + s(d.isc);
        if (d.tipo_linea === 'servicio') {
          cargo.agregar(d.cuenta, base);
          // Gasto de la clase 6 con área: destino 9x contra 79
          if (!venta && d.cuenta_destino && String(d.cuenta).startsWith('6')) {
            destinoDebe.agregar(d.cuenta_destino, base);
            destinoHaber.agregar(cuentas.cargasImputables, base);
          }
        } else {
          const cuenta = venta
            ? notaCredito
              ? cuentas.devolucionVentas
              : cuentas.ventaMercaderias
            : cuentas.compraMercaderias;
          cargo.agregar(cuenta, base);
          mercaderias += base;
        }
      }
    } else {
      // Sin detalle (solo totales): a la cuenta de mercaderías
      const base = s(c.gravada) + s(c.exonerada) + s(c.inafecta) + s(c.isc);
      cargo.agregar(
        venta
          ? notaCredito
            ? cuentas.devolucionVentas
            : cuentas.ventaMercaderias
          : cuentas.compraMercaderias,
        base,
      );
    }
    cargo.agregar(cuentas.igv, s(c.igv));
    // La contraparte cierra el asiento: total en soles, cuadrado al céntimo
    abono.agregar(
      venta ? cuentas.clientes : cuentas.proveedores,
      cargo.total / 100,
    );

    // Compras de mercaderías: 20 contra 61
    if (!venta && mercaderias > 0) {
      destinoDebe.agregar(cuentas.almacen, mercaderias);
      destinoHaber.agregar(cuentas.variacion, mercaderias);
    }
    // Ventas: costo según el kardex (salidas; en nota de crédito, reingresos)
    if (venta) {
      const costo = await this.costoKardex(
        idComprobante,
        notaCredito ? 'ENTRADA' : 'SALIDA',
      );
      if (costo > 0) {
        destinoDebe.agregar(cuentas.costoVentas, costo);
        destinoHaber.agregar(cuentas.almacen, costo);
      }
    }

    // Compras: el cargo va al Debe; ventas: al Haber. La nota de crédito invierte.
    const cargoAlDebe = venta === notaCredito;
    const lineas: LineaAsientoDto[] = [];
    const poner = (lado: Lado, debe: boolean, glosa?: string) => {
      for (const [codigoCuenta, cents] of lado.entradas()) {
        lineas.push({
          codigoCuenta,
          glosa,
          debe: debe ? cents / 100 : 0,
          haber: debe ? 0 : cents / 100,
        });
      }
    };
    poner(cargoAlDebe ? cargo : abono, true);
    poner(cargoAlDebe ? abono : cargo, false);
    // Destinos: en compras van tal cual (la nota los invierte); en ventas el costo igual
    const destinoAlDebe = !notaCredito;
    poner(destinoAlDebe ? destinoDebe : destinoHaber, true, 'Destino');
    poner(destinoAlDebe ? destinoHaber : destinoDebe, false, 'Destino');

    const nombreTipo: Record<string, string> = {
      '01': 'Factura',
      '03': 'Boleta',
      '07': 'Nota de crédito',
      '08': 'Nota de débito',
    };
    const referencia = `${c.serie}-${c.numero}`;
    const glosa = `${venta ? 'Venta' : 'Compra'}: ${nombreTipo[c.tipo] ?? 'Comprobante'} ${referencia}${c.contraparte ? ` · ${c.contraparte}` : ''}${factor !== 1 ? ` (US$ a T.C. ${factor})` : ''}`;

    return this.asientos.guardarAutomatico(
      personaId,
      {
        idComprobante,
        origen: venta ? 'venta' : 'compra',
        fecha: c.fecha,
        glosa: glosa.slice(0, 250),
        referencia: referencia.slice(0, 60),
        lineas,
      },
      usuario,
    );
  }

  private async costoKardex(idComprobante: number, tipo: 'ENTRADA' | 'SALIDA') {
    const [r] = await this.dataSource.query(
      `SELECT COALESCE(SUM(k.costo_total), 0) AS costo
         FROM kardex_linea k
         JOIN movimiento_detalles md ON md.id = k.id_movimiento_detalle
         JOIN movimientos mv ON mv.id = md.id_movimiento
        WHERE mv.id_comprobante = $1 AND k.tipo = $2`,
      [idComprobante, tipo],
    );
    return Number(r?.costo) || 0;
  }
}
