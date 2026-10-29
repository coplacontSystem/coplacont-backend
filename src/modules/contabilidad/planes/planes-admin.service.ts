import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { EquivalenciasService } from './equivalencias.service';
import { PlanArchivo, validarPlan } from './plan-archivo';
import { PlanCargador } from './plan-cargador';
import type { ImportarPlanDto } from './planes-admin.types';

type Fila = Record<string, any>;

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const COLUMNA_CODIGO = [
  'codigo',
  'cuenta',
  'codigo cuenta',
  'cod',
  'cod cuenta',
];
const COLUMNA_NOMBRE = [
  'nombre',
  'denominacion',
  'descripcion',
  'cuenta contable',
  'nombre cuenta',
];

/** Texto de una celda de Excel (también fórmulas y texto enriquecido) */
function texto(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('result' in v) return texto(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v).trim();
}

/** Pares código-nombre de una tabla (primera fila = cabecera) */
function desdeTabla(filas: string[][]): [string, string][] {
  const iCab = filas.findIndex((f) =>
    f.some((c) => COLUMNA_CODIGO.includes(normalizar(c))),
  );
  if (iCab < 0) {
    throw new BadRequestException(
      'No se encontró la columna del código (Código o Cuenta) en la primera fila',
    );
  }
  const cab = filas[iCab].map(normalizar);
  const ic = cab.findIndex((c) => COLUMNA_CODIGO.includes(c));
  const inom = cab.findIndex((c, i) => i !== ic && COLUMNA_NOMBRE.includes(c));
  if (inom < 0) {
    throw new BadRequestException(
      'No se encontró la columna del nombre (Nombre, Denominación o Descripción)',
    );
  }
  return filas
    .slice(iCab + 1)
    .map(
      (f) =>
        [String(f[ic] ?? '').trim(), String(f[inom] ?? '').trim()] as [
          string,
          string,
        ],
    )
    .filter(([c, n]) => c || n);
}

export interface Diferencias {
  /** Plan con el que se compara (el mismo al actualizar; el por defecto si es nuevo) */
  comparadoCon: string | null;
  total: number;
  nuevas: [string, string][];
  quitadas: [string, string][];
  renombradas: [string, string, string][];
}

/**
 * Importación de planes de cuentas desde el panel del administrador: un plan
 * nuevo (p. ej. un PCGE futuro) o una actualización de uno existente. Nada
 * de esto requiere cambiar el código fuente.
 */
@Injectable()
export class PlanesAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cargador: PlanCargador,
    private readonly equivalencias: EquivalenciasService,
  ) {}

  async listar() {
    const filas: Fila[] = await this.dataSource.query(
      `SELECT p.id, p.codigo, p.nombre, p.norma, p.codigo_sunat, p.por_defecto, p.origen,
              p.version, p.nota, to_char(p.vigente_desde, 'YYYY-MM-DD') AS desde,
              p.fecha_actualizacion,
              (SELECT COUNT(*) FROM cuenta_contable c WHERE c.id_plan = p.id AND c.id_persona IS NULL AND c.activa) AS cuentas,
              (SELECT COUNT(*) FROM persona e
                WHERE COALESCE(e.id_plan_contable,
                      (SELECT id FROM plan_contable WHERE por_defecto ORDER BY id LIMIT 1)) = p.id) AS empresas
         FROM plan_contable p ORDER BY p.vigente_desde, p.id`,
    );
    return filas.map((f) => ({
      id: Number(f.id),
      codigo: f.codigo,
      nombre: f.nombre,
      norma: f.norma,
      codigoSunat: f.codigo_sunat,
      porDefecto: Boolean(f.por_defecto),
      origen: f.origen,
      version: Number(f.version),
      nota: f.nota,
      vigenteDesde: f.desde,
      actualizado: f.fecha_actualizacion,
      cuentas: Number(f.cuentas),
      empresas: Number(f.empresas),
    }));
  }

  /** Lee el archivo (xlsx, csv o json) y arma el plan con los datos del formulario */
  async leer(dto: ImportarPlanDto): Promise<PlanArchivo> {
    const buffer = Buffer.from(dto.archivo.contenido, 'base64');
    const nombre = dto.archivo.nombre.toLowerCase();
    let cuentas: [string, string][];
    let base: Partial<PlanArchivo> = {};
    if (nombre.endsWith('.json')) {
      try {
        base = JSON.parse(buffer.toString('utf8')) as PlanArchivo;
      } catch {
        throw new BadRequestException('El JSON no es válido');
      }
      cuentas = base.cuentas ?? [];
    } else if (nombre.endsWith('.csv') || nombre.endsWith('.txt')) {
      const textoPlano = buffer.toString('utf8').replace(/^\uFEFF/, '');
      const sep =
        (textoPlano.split('\n')[0].match(/;/g)?.length ?? 0) > 0 ? ';' : ',';
      cuentas = desdeTabla(
        textoPlano
          .split(/\r?\n/)
          .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim())),
      );
    } else {
      const libro = new ExcelJS.Workbook();
      try {
        await libro.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      } catch {
        throw new BadRequestException(
          'No se pudo abrir el archivo: usa .xlsx, .csv o .json',
        );
      }
      const hoja = libro.worksheets[0];
      const filas: string[][] = [];
      hoja.eachRow((row) => {
        const valores = (row.values as ExcelJS.CellValue[]).slice(1).map(texto);
        filas.push(valores);
      });
      cuentas = desdeTabla(filas);
    }

    // Códigos de Excel pueden venir como número: "10.0" → "10"
    cuentas = cuentas.map(([c, n]) => [
      c.replace(/\.0+$/, '').replace(/\s/g, ''),
      n,
    ]);

    const actual =
      dto.modo === 'actualizar' ? await this.planPorCodigo(dto.codigo) : null;
    return {
      codigo: dto.codigo,
      nombre: dto.nombre ?? base.nombre ?? actual?.nombre ?? '',
      norma: dto.norma ?? base.norma ?? actual?.norma ?? '',
      codigoSunat:
        dto.codigoSunat ?? base.codigoSunat ?? actual?.codigo_sunat ?? '01',
      vigenteDesde:
        dto.vigenteDesde ?? base.vigenteDesde ?? actual?.desde ?? '',
      porDefecto: actual ? Boolean(actual.por_defecto) : false,
      nota: dto.nota ?? base.nota ?? actual?.nota ?? undefined,
      elementos: base.elementos ?? actual?.elementos ?? {},
      areasSugeridas: base.areasSugeridas ?? actual?.areas_sugeridas ?? [],
      cuentasSugeridas: {
        ...(actual?.cuentas_sugeridas ?? {}),
        ...(base.cuentasSugeridas ?? {}),
        ...(dto.cuentasSugeridas ?? {}),
      },
      cuentas,
    };
  }

  private async planPorCodigo(codigo: string): Promise<Fila> {
    const [p]: Fila[] = await this.dataSource.query(
      `SELECT id, codigo, nombre, norma, codigo_sunat, por_defecto, nota, elementos,
              cuentas_sugeridas, areas_sugeridas, to_char(vigente_desde, 'YYYY-MM-DD') AS desde
         FROM plan_contable WHERE codigo = $1`,
      [codigo],
    );
    if (!p) throw new NotFoundException(`No existe el plan ${codigo}`);
    return p;
  }

  /** Validación y diferencias, sin guardar nada */
  async previsualizar(dto: ImportarPlanDto) {
    const plan = await this.leer(dto);
    const errores = validarPlan(plan);
    if (!plan.vigenteDesde || !/^\d{4}-\d{2}-\d{2}$/.test(plan.vigenteDesde)) {
      errores.push('Indica desde cuándo rige el plan (AAAA-MM-DD)');
    }
    const [existe] = await this.dataSource.query(
      `SELECT 1 FROM plan_contable WHERE codigo = $1`,
      [plan.codigo],
    );
    if (dto.modo === 'nuevo' && existe) {
      errores.push(
        `Ya existe un plan con el código ${plan.codigo}: elige "Actualizar"`,
      );
    }
    // Lo sugerido que no está en el plan se quita (no impide importar)
    const avisos: string[] = [];
    const codigos = new Set(plan.cuentas.map(([c]) => c));
    for (const [rol, c] of Object.entries(plan.cuentasSugeridas)) {
      if (!codigos.has(c)) {
        delete plan.cuentasSugeridas[rol];
        avisos.push(
          `La cuenta sugerida para "${rol}" (${c}) no está en el archivo: se quitará`,
        );
      }
    }
    const reales = errores.filter((e) => !e.startsWith('La cuenta sugerida'));
    return {
      plan: { ...plan, cuentas: undefined },
      errores: reales,
      avisos,
      diferencias: await this.diferencias(plan, dto.modo),
    };
  }

  private async diferencias(
    plan: PlanArchivo,
    modo: 'nuevo' | 'actualizar',
  ): Promise<Diferencias> {
    const [comparar]: Fila[] =
      modo === 'actualizar'
        ? await this.dataSource.query(
            `SELECT id, codigo FROM plan_contable WHERE codigo = $1`,
            [plan.codigo],
          )
        : await this.dataSource.query(
            `SELECT id, codigo FROM plan_contable ORDER BY vigente_desde DESC, id DESC LIMIT 1`,
          );
    if (!comparar) {
      return {
        comparadoCon: null,
        total: plan.cuentas.length,
        nuevas: plan.cuentas,
        quitadas: [],
        renombradas: [],
      };
    }
    const filas: Fila[] = await this.dataSource.query(
      `SELECT codigo, nombre FROM cuenta_contable WHERE id_plan = $1 AND id_persona IS NULL AND activa`,
      [comparar.id],
    );
    const antes = new Map(
      filas.map((f) => [String(f.codigo), String(f.nombre)]),
    );
    const ahora = new Map(plan.cuentas);
    return {
      comparadoCon: comparar.codigo,
      total: plan.cuentas.length,
      nuevas: plan.cuentas.filter(([c]) => !antes.has(c)),
      quitadas: [...antes].filter(([c]) => !ahora.has(c)),
      renombradas: plan.cuentas
        .filter(([c, n]) => antes.has(c) && antes.get(c) !== n)
        .map(([c, n]) => [c, antes.get(c)!, n]),
    };
  }

  /** Guarda el plan (nuevo o actualización) y propone sus equivalencias */
  async publicar(dto: ImportarPlanDto) {
    const previa = await this.previsualizar(dto);
    if (previa.errores.length) throw new BadRequestException(previa.errores);
    const plan = await this.leer(dto);
    for (const rol of Object.keys(plan.cuentasSugeridas)) {
      if (!plan.cuentas.some(([c]) => c === plan.cuentasSugeridas[rol])) {
        delete plan.cuentasSugeridas[rol];
      }
    }
    if (dto.modo === 'nuevo') {
      const [existe] = await this.dataSource.query(
        `SELECT 1 FROM plan_contable WHERE codigo = $1`,
        [plan.codigo],
      );
      if (existe)
        throw new ConflictException(`Ya existe el plan ${plan.codigo}`);
    }
    const r = await this.cargador.cargar(plan, {
      origen: 'importado',
      desactivarFaltantes: dto.modo === 'actualizar',
    });
    if (dto.modo === 'actualizar') {
      await this.dataSource.query(
        `UPDATE plan_contable SET version = version + 1, fecha_actualizacion = now() WHERE id = $1`,
        [r.idPlan],
      );
    }
    await this.equivalencias.proponerFaltantes();
    return { ...r, planes: await this.listar() };
  }
}
