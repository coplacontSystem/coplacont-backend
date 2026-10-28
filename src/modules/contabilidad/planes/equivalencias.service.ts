import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { DocumentoTabular } from 'src/modules/reportes/documento-tabular';
import type { TipoEquivalencia } from './equivalencia.entity';

type Fila = Record<string, any>;

const VACIAS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'e',
  'o',
  'en',
  'a',
  'al',
  'por',
  'para',
  'con',
  'sin',
  'otros',
  'otras',
  'otro',
  'otra',
]);

/** Palabras significativas de un texto, sin tildes ni signos */
function palabras(texto: string): Set<string> {
  return new Set(
    texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((p) => p.length > 1 && !VACIAS.has(p)),
  );
}

/** Parecido 0..1 entre dos conjuntos de palabras (Dice) */
function parecido(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let comunes = 0;
  for (const p of a) if (b.has(p)) comunes++;
  return (2 * comunes) / (a.size + b.size);
}

interface CuentaPlan {
  codigo: string;
  nombre: string;
  propio: Set<string>;
  /** Palabras del nombre y de sus cuentas padre de 3+ dígitos */
  ruta: Set<string>;
  /** Nombres de la cuenta y sus padres (para mostrar) */
  rutaTexto: string;
}

const UMBRAL_MISMO_SENTIDO = 0.7;
const UMBRAL_PROPUESTA = 0.5;

export interface Propuesta {
  codigoOrigen: string;
  codigoDestino: string | null;
  tipo: TipoEquivalencia;
  similitud: number;
}

/**
 * Equivalencias entre dos planes de cuentas (p. ej. PCGE 2019 → 2026). El
 * sistema las propone comparando código y nombres (también los de las
 * cuentas padre); las dudosas quedan para revisión de los contadores.
 */
@Injectable()
export class EquivalenciasService {
  private readonly logger = new Logger(EquivalenciasService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Propone las equivalencias de cada par de planes que aún no las tenga */
  async proponerFaltantes() {
    const planes: Fila[] = await this.dataSource.query(
      `SELECT id, codigo FROM plan_contable ORDER BY vigente_desde, id`,
    );
    for (let i = 0; i < planes.length; i++) {
      for (let j = i + 1; j < planes.length; j++) {
        const [hay] = await this.dataSource.query(
          `SELECT 1 FROM cuenta_equivalencia WHERE id_plan_origen = $1 AND id_plan_destino = $2 LIMIT 1`,
          [planes[i].id, planes[j].id],
        );
        if (hay) continue;
        const n = await this.guardarPropuesta(
          Number(planes[i].id),
          Number(planes[j].id),
        );
        this.logger.log(
          `Equivalencias ${planes[i].codigo} → ${planes[j].codigo}: ${n} propuestas`,
        );
      }
    }
  }

  private async cuentas(idPlan: number): Promise<Map<string, CuentaPlan>> {
    const filas: Fila[] = await this.dataSource.query(
      `SELECT codigo, nombre FROM cuenta_contable
        WHERE id_plan = $1 AND id_persona IS NULL ORDER BY codigo`,
      [idPlan],
    );
    const nombres = new Map(
      filas.map((f) => [String(f.codigo), String(f.nombre)]),
    );
    const mapa = new Map<string, CuentaPlan>();
    for (const [codigo, nombre] of nombres) {
      const ancestros: string[] = [];
      for (let n = 3; n <= codigo.length; n++) {
        const a = nombres.get(codigo.slice(0, n));
        if (a) ancestros.push(a);
      }
      const todos: string[] = [];
      for (let n = 2; n <= codigo.length; n++) {
        const a = nombres.get(codigo.slice(0, n));
        if (a) todos.push(a);
      }
      mapa.set(codigo, {
        codigo,
        nombre,
        propio: palabras(nombre),
        ruta: palabras(ancestros.join(' ')),
        rutaTexto: todos.join(' › '),
      });
    }
    return mapa;
  }

  /** Propuesta automática (pura: no escribe en la base) */
  async proponer(idOrigen: number, idDestino: number): Promise<Propuesta[]> {
    const origen = await this.cuentas(idOrigen);
    const destino = await this.cuentas(idDestino);
    const porLargo = new Map<number, CuentaPlan[]>();
    for (const c of destino.values()) {
      porLargo.set(c.codigo.length, [
        ...(porLargo.get(c.codigo.length) ?? []),
        c,
      ]);
    }

    // El sentido se conserva si el nombre y la ruta de nombres (padres de
    // 3+ dígitos) se parecen
    const mismoSentido = (a: CuentaPlan, b: CuentaPlan) =>
      parecido(a.ruta, b.ruta) >= UMBRAL_MISMO_SENTIDO &&
      parecido(a.propio, b.propio) >= 0.5;
    // La más parecida del mismo elemento, con preferencia por la misma cuenta
    const mejor = (a: CuentaPlan) => {
      const candidatos = (porLargo.get(a.codigo.length) ?? []).filter(
        (b) => b.codigo[0] === a.codigo[0],
      );
      let elegido: CuentaPlan | null = null;
      let puntaje = 0;
      for (const b of candidatos) {
        let s =
          0.7 * parecido(a.ruta, b.ruta) + 0.3 * parecido(a.propio, b.propio);
        if (b.codigo.slice(0, 2) === a.codigo.slice(0, 2)) s += 0.15;
        if (s > puntaje) {
          puntaje = s;
          elegido = b;
        }
      }
      return { elegido, puntaje: Math.min(1, puntaje) };
    };

    const propuestas: Propuesta[] = [];
    for (const a of origen.values()) {
      const mismo = destino.get(a.codigo);
      if (mismo && mismoSentido(a, mismo)) {
        const igualNombre = parecido(a.propio, mismo.propio) === 1;
        propuestas.push({
          codigoOrigen: a.codigo,
          codigoDestino: a.codigo,
          tipo: igualNombre ? 'igual' : 'renombrada',
          similitud: Number(parecido(a.ruta, mismo.ruta).toFixed(3)),
        });
        continue;
      }
      const { elegido, puntaje } = mejor(a);
      propuestas.push({
        codigoOrigen: a.codigo,
        codigoDestino:
          elegido && puntaje >= UMBRAL_PROPUESTA ? elegido.codigo : null,
        tipo: mismo ? 'cambio' : 'eliminada',
        similitud: Number(puntaje.toFixed(3)),
      });
    }
    return propuestas;
  }

  private async guardarPropuesta(idOrigen: number, idDestino: number) {
    const propuestas = await this.proponer(idOrigen, idDestino);
    const LOTE = 500;
    for (let i = 0; i < propuestas.length; i += LOTE) {
      const lote = propuestas.slice(i, i + LOTE);
      await this.dataSource.query(
        `INSERT INTO cuenta_equivalencia
           (id_plan_origen, id_plan_destino, codigo_origen, codigo_destino, tipo, similitud, revisada)
         SELECT $1, $2, * FROM unnest($3::varchar[], $4::varchar[], $5::varchar[], $6::numeric[], $7::boolean[])
         ON CONFLICT DO NOTHING`,
        [
          idOrigen,
          idDestino,
          lote.map((p) => p.codigoOrigen),
          lote.map((p) => p.codigoDestino),
          lote.map((p) => p.tipo),
          lote.map((p) => p.similitud),
          lote.map((p) => p.tipo === 'igual' || p.tipo === 'renombrada'),
        ],
      );
    }
    return propuestas.length;
  }

  private async planes(origen: string, destino: string) {
    const filas: Fila[] = await this.dataSource.query(
      `SELECT id, codigo, nombre FROM plan_contable WHERE codigo = ANY($1)`,
      [[origen, destino]],
    );
    const o = filas.find((f) => f.codigo === origen);
    const d = filas.find((f) => f.codigo === destino);
    if (!o || !d) throw new NotFoundException('Plan contable no encontrado');
    return { origen: o, destino: d };
  }

  /** Equivalencias con los nombres de ambas cuentas */
  async listar(origen: string, destino: string, soloPorRevisar = false) {
    const { origen: o, destino: d } = await this.planes(origen, destino);
    const filas: Fila[] = await this.dataSource.query(
      `SELECT e.id, e.codigo_origen, co.nombre AS nombre_origen,
              e.codigo_destino, cd.nombre AS nombre_destino,
              e.tipo, e.similitud, e.revisada, e.nota, e.revisada_por
         FROM cuenta_equivalencia e
         LEFT JOIN cuenta_contable co
                ON co.id_plan = e.id_plan_origen AND co.id_persona IS NULL AND co.codigo = e.codigo_origen
         LEFT JOIN cuenta_contable cd
                ON cd.id_plan = e.id_plan_destino AND cd.id_persona IS NULL AND cd.codigo = e.codigo_destino
        WHERE e.id_plan_origen = $1 AND e.id_plan_destino = $2
          ${soloPorRevisar ? 'AND NOT e.revisada' : ''}
        ORDER BY e.codigo_origen`,
      [o.id, d.id],
    );
    const resumen: Record<string, number> = {};
    for (const f of filas) resumen[f.tipo] = (resumen[f.tipo] ?? 0) + 1;
    return {
      origen: { codigo: o.codigo, nombre: o.nombre },
      destino: { codigo: d.codigo, nombre: d.nombre },
      resumen,
      porRevisar: filas.filter((f) => !f.revisada).length,
      equivalencias: filas.map((f) => ({
        id: Number(f.id),
        codigoOrigen: f.codigo_origen,
        nombreOrigen: f.nombre_origen,
        codigoDestino: f.codigo_destino,
        nombreDestino: f.nombre_destino,
        tipo: f.tipo as TipoEquivalencia,
        similitud: Number(f.similitud),
        revisada: Boolean(f.revisada),
        nota: f.nota,
        revisadaPor: f.revisada_por,
      })),
    };
  }

  /** Fija la cuenta destino de una equivalencia (revisión de un contador) */
  async revisar(
    id: number,
    cambio: { codigoDestino: string | null; nota?: string },
    usuario: string,
  ) {
    const [e] = await this.dataSource.query(
      `SELECT id, id_plan_destino FROM cuenta_equivalencia WHERE id = $1`,
      [id],
    );
    if (!e) throw new NotFoundException('Equivalencia no encontrada');
    if (cambio.codigoDestino) {
      const [c] = await this.dataSource.query(
        `SELECT 1 FROM cuenta_contable WHERE id_plan = $1 AND id_persona IS NULL AND codigo = $2`,
        [e.id_plan_destino, cambio.codigoDestino],
      );
      if (!c) {
        throw new BadRequestException(
          `La cuenta ${cambio.codigoDestino} no existe en el plan destino`,
        );
      }
    }
    await this.dataSource.query(
      `UPDATE cuenta_equivalencia
          SET codigo_destino = $2, nota = $3, revisada = true,
              revisada_por = $4, fecha_revision = now()
        WHERE id = $1`,
      [id, cambio.codigoDestino, cambio.nota ?? null, usuario],
    );
  }

  /** Excel para que los contadores revisen la tabla */
  async documento(origen: string, destino: string): Promise<DocumentoTabular> {
    const datos = await this.listar(origen, destino);
    const o = await this.cuentas(
      (await this.planes(origen, destino)).origen.id,
    );
    const d = await this.cuentas(
      (await this.planes(origen, destino)).destino.id,
    );
    const TIPO: Record<string, string> = {
      igual: 'Igual',
      renombrada: 'Renombrada',
      cambio: 'Mismo código, otro significado',
      eliminada: 'Eliminada en el plan nuevo',
    };
    const fila = (e: (typeof datos.equivalencias)[number]) => ({
      origen: e.codigoOrigen,
      rutaOrigen: o.get(e.codigoOrigen)?.rutaTexto ?? e.nombreOrigen,
      tipo: TIPO[e.tipo],
      destino: e.codigoDestino ?? '',
      rutaDestino: e.codigoDestino
        ? (d.get(e.codigoDestino)?.rutaTexto ?? '')
        : 'SIN EQUIVALENTE',
      similitud: Math.round(e.similitud * 100),
      correcta: '',
      nota: e.nota ?? '',
    });
    const columnas = [
      {
        clave: 'origen',
        titulo: `Cuenta ${datos.origen.codigo}`,
        tipo: 'texto' as const,
        ancho: 11,
      },
      {
        clave: 'rutaOrigen',
        titulo: 'Denominación (con sus cuentas padre)',
        tipo: 'texto' as const,
        ancho: 60,
      },
      { clave: 'tipo', titulo: 'Cambio', tipo: 'texto' as const, ancho: 24 },
      {
        clave: 'destino',
        titulo: `Propuesta ${datos.destino.codigo}`,
        tipo: 'texto' as const,
        ancho: 12,
      },
      {
        clave: 'rutaDestino',
        titulo: 'Denominación propuesta',
        tipo: 'texto' as const,
        ancho: 60,
      },
      {
        clave: 'similitud',
        titulo: 'Parecido %',
        tipo: 'numero' as const,
        ancho: 10,
      },
      {
        clave: 'correcta',
        titulo: 'Cuenta correcta (contador)',
        tipo: 'texto' as const,
        ancho: 16,
      },
      { clave: 'nota', titulo: 'Nota', tipo: 'texto' as const, ancho: 30 },
    ];
    return {
      titulo: `Equivalencias ${datos.origen.nombre} → ${datos.destino.nombre}`,
      nombreArchivo: `equivalencias_${datos.origen.codigo}_${datos.destino.codigo}`,
      soloTabla: true,
      empresa: null,
      secciones: [
        {
          nombre: 'Por revisar',
          columnas,
          filas: datos.equivalencias.filter((e) => !e.revisada).map(fila),
        },
        {
          nombre: 'Iguales o renombradas',
          columnas,
          filas: datos.equivalencias.filter((e) => e.revisada).map(fila),
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
            `Cada fila es una cuenta del ${datos.origen.nombre} y la cuenta del ${datos.destino.nombre} a la que el sistema propone pasarla.`,
            '"Mismo código, otro significado": el código existe en ambos planes pero ya no es la misma cuenta (p. ej. 70921).',
            '"Eliminada": la cuenta no existe en el plan nuevo; se propone la más parecida o "SIN EQUIVALENTE".',
            'Revise la hoja "Por revisar" y escriba en "Cuenta correcta (contador)" el código que corresponde cuando la propuesta no sea correcta. Deje vacío si está bien.',
            'La hoja "Iguales o renombradas" es informativa: esas cuentas conservan su código y su significado.',
          ].map((texto) => ({ texto })),
        },
      ],
    };
  }
}
