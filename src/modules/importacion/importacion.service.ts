import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { Comprobante } from '../comprobantes/entities/comprobante';
import { TablaDetalle } from '../comprobantes/entities/tabla-detalle.entity';
import { ComprobanteService } from '../comprobantes/service/comprobante.service';
import { ymd } from '../comprobantes/service/reglas-registro';
import { Moneda } from '../comprobantes/enum/tipo-moneda.enum';
import type { CreateComprobanteDto } from '../comprobantes/dto/comprobante/create-comprobante.dto';
import type { CreateComprobanteDetalleDto } from '../comprobantes/dto/comprobante-detalle/create-comprobante-detalle.dto';
import { Entidad } from '../entidades/entities';
import { EntidadType } from '../entidades/enums/EntidadType.enum';
import { Producto } from '../productos/entities';
import { ProductoService } from '../productos/service';
import { TipoProducto } from '../productos/enum/tipo-producto.enum';
import { Inventario } from '../inventario/entities/inventario.entity';
import { InventarioService } from '../inventario/service';
import { Almacen } from '../almacen/entities/almacen.entity';
import { PeriodoContableService } from '../periodos/service';
import { TipoCambioService } from '../tipo-cambio/service/tipo-cambio.service';
import { PersonaService } from '../users/services/person.service';
import { CpeError, leerCpe } from './cpe/cpe.parser';
import type { CpeDocumento, CpeLinea } from './cpe/cpe.types';
import { EquivalenciaProducto } from './entities/equivalencia.entity';
import {
  claveLinea,
  normalizar,
  parecido,
  PARECIDO_MINIMO,
  r2,
  separarNombre,
  TOLERANCIA_TOTAL,
} from './importacion.reglas';
import type {
  ArchivoARegistrarDto,
  ArchivoPrevio,
  ArchivoXmlDto,
  LineaPrevia,
  Operacion,
  PrevisualizarDto,
  RegistrarDto,
  ResolucionLineaDto,
  ResultadoRegistro,
  Sugerencia,
} from './importacion.types';

/** Lo que se lee de cada archivo antes de mirar la base de datos */
type Lectura =
  | { nombre: string; doc: CpeDocumento; operacion: Operacion }
  | { nombre: string; error: string };

const serieNumero = (d: Pick<CpeDocumento, 'serie' | 'numero'>) =>
  `${d.serie}-${d.numero}`;

const NOMBRE_TIPO: Record<string, string> = {
  '01': 'Factura',
  '03': 'Boleta',
  '07': 'Nota de crédito',
  '08': 'Nota de débito',
};

/** Clientes sin documento (boletas a consumidor final) */
const CLIENTES_VARIOS = '00000000';

@Injectable()
export class ImportacionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly comprobantes: ComprobanteService,
    private readonly productos: ProductoService,
    private readonly inventarios: InventarioService,
    private readonly periodos: PeriodoContableService,
    private readonly tipoCambio: TipoCambioService,
    private readonly personas: PersonaService,
  ) {}

  // ───────────────────────── Vista previa ─────────────────────────

  async previsualizar(
    personaId: number,
    dto: PrevisualizarDto,
  ): Promise<ArchivoPrevio[]> {
    const ruc = await this.rucEmpresa(personaId);
    const lecturas = dto.archivos.map((a) => this.leer(a, ruc));
    const periodo = await this.periodoVigente(personaId);
    const productos = await this.dataSource.getRepository(Producto).find({
      where: { persona: { id: personaId }, estado: true },
    });
    const tiposDeCambio = new Map<string, number | null>();

    // Documentos de esta carga, para detectar repetidos y notas cuyo
    // comprobante se registra en la misma carga
    const enCarga = new Map<string, number>();
    for (const l of lecturas) {
      if ('doc' in l) {
        const k = this.claveDocumento(l.doc, l.operacion, ruc);
        enCarga.set(k, (enCarga.get(k) ?? 0) + 1);
      }
    }
    const vistos = new Set<string>();

    const salida: ArchivoPrevio[] = [];
    for (const l of lecturas) {
      if (!('doc' in l)) {
        salida.push(this.archivoConError(l.nombre, l.error));
        continue;
      }
      const { doc, operacion } = l;
      const errores: string[] = [];
      const avisos: string[] = [];
      const parte = operacion === 'compra' ? doc.emisor : doc.receptor;
      const entidad = await this.buscarEntidad(
        personaId,
        parte.numeroDocumento,
      );

      // Repetido en la carga o ya registrado
      const k = this.claveDocumento(doc, operacion, ruc);
      if (vistos.has(k)) {
        errores.push('Este comprobante está repetido en la carga');
      }
      vistos.add(k);
      if (entidad) {
        const ya = await this.buscarComprobante(
          personaId,
          entidad.id,
          operacion,
          doc.tipoComprobante,
          doc.serie,
          doc.numero,
        );
        if (ya) {
          errores.push(
            `Ya está registrado (${ya.correlativo}). No se volverá a registrar`,
          );
        }
      }

      // Período
      if (!periodo) {
        errores.push('No hay un período contable activo');
      } else if (
        doc.fechaEmision < periodo.inicio ||
        doc.fechaEmision > periodo.fin
      ) {
        errores.push(
          `La fecha ${doc.fechaEmision} está fuera del período vigente (${periodo.inicio} a ${periodo.fin})`,
        );
      }

      // Moneda y tipo de cambio
      let tc: number | null = null;
      if (doc.moneda !== 'PEN' && doc.moneda !== 'USD') {
        errores.push(`Moneda no soportada: ${doc.moneda}`);
      } else if (doc.moneda === 'USD') {
        if (!tiposDeCambio.has(doc.fechaEmision)) {
          tiposDeCambio.set(
            doc.fechaEmision,
            await this.tipoCambioDe(doc.fechaEmision),
          );
        }
        tc = tiposDeCambio.get(doc.fechaEmision) ?? null;
        if (!tc) {
          avisos.push(
            `No se encontró el tipo de cambio del ${doc.fechaEmision}: ingrésalo antes de registrar`,
          );
        }
      }

      // Notas: el comprobante que modifican
      let afectado: ArchivoPrevio['afectado'] = null;
      if (doc.tipoComprobante === '07' || doc.tipoComprobante === '08') {
        afectado = await this.resolverAfectado(
          personaId,
          doc,
          operacion,
          entidad?.id ?? null,
          enCarga,
          ruc,
        );
        if (!afectado) {
          errores.push('La nota no indica qué comprobante modifica');
        } else if (!afectado.idComprobante && !afectado.enEstaCarga) {
          errores.push(
            `Registra primero el comprobante ${afectado.serieNumero} que modifica la nota`,
          );
        }
      }

      // Totales: la suma de las líneas debe cuadrar con el total del XML
      const suma = r2(
        doc.lineas.reduce(
          (s, x) => s + (x.gratuita ? 0 : x.subtotal + x.igv + x.isc),
          0,
        ),
      );
      if (Math.abs(suma - doc.totales.total) > TOLERANCIA_TOTAL) {
        avisos.push(
          `La suma de las líneas (${suma.toFixed(2)}) no coincide con el total del XML (${doc.totales.total.toFixed(2)}): puede haber descuentos globales, anticipos u otros tributos. Se registrará la suma de las líneas`,
        );
      }
      if (doc.lineas.some((x) => x.gratuita)) {
        avisos.push('Tiene líneas gratuitas: se registran con importe cero');
      }
      if (doc.lineas.some((x) => x.icbper > 0)) {
        avisos.push('El ICBPER (impuesto a las bolsas) no se registra');
      }
      if (doc.detraccion) {
        avisos.push(
          `Sujeta a detracción (${doc.detraccion.porcentaje} %, código ${doc.detraccion.codigo ?? '-'})`,
        );
      }
      if (!entidad) {
        avisos.push(
          `Se creará el ${operacion === 'compra' ? 'proveedor' : 'cliente'} ${parte.razonSocial}`,
        );
      }

      const emisor = doc.emisor.numeroDocumento;
      const equivalencias = await this.equivalenciasDe(
        personaId,
        emisor,
        doc.lineas.map(claveLinea),
      );
      const lineas: LineaPrevia[] = doc.lineas.map((x) => {
        const clave = claveLinea(x);
        return {
          ...x,
          clave,
          sugerencia: this.sugerir(x, equivalencias.get(clave), productos),
        };
      });

      const { lineas: _omitir, ...cabecera } = doc;
      void _omitir;
      salida.push({
        nombre: l.nombre,
        valido: errores.length === 0,
        errores,
        avisos,
        operacion,
        documento: cabecera,
        contraparte: {
          tipoDocumento: parte.tipoDocumento,
          numeroDocumento: parte.numeroDocumento,
          razonSocial: parte.razonSocial,
          idEntidad: entidad?.id ?? null,
        },
        afectado,
        tipoCambio: tc,
        lineas,
      });
    }
    return salida;
  }

  // ───────────────────────── Registro ─────────────────────────

  /**
   * Registra cada archivo por separado (cada uno en su transacción): si uno
   * falla, los demás siguen. Las notas se registran después de las facturas
   * para encontrar el comprobante que modifican.
   */
  async registrar(
    personaId: number,
    dto: RegistrarDto,
  ): Promise<ResultadoRegistro[]> {
    const ruc = await this.rucEmpresa(personaId);
    if (dto.idAlmacen) await this.validarAlmacen(personaId, dto.idAlmacen);
    const catalogo = await this.catalogo();

    const lecturas = dto.archivos.map((a, i) => ({
      archivo: a,
      i,
      lectura: this.leer(a, ruc),
    }));
    const esNota = (x: (typeof lecturas)[number]) =>
      'doc' in x.lectura &&
      (x.lectura.doc.tipoComprobante === '07' ||
        x.lectura.doc.tipoComprobante === '08');
    const orden = [
      ...lecturas.filter((x) => !esNota(x)),
      ...lecturas.filter(esNota),
    ];

    const resultados: ResultadoRegistro[] = new Array(lecturas.length);
    for (const { archivo, i, lectura } of orden) {
      if (!('doc' in lectura)) {
        resultados[i] = {
          nombre: archivo.nombre,
          ok: false,
          error: lectura.error,
        };
        continue;
      }
      try {
        const r = await this.registrarUno(
          personaId,
          archivo,
          lectura.doc,
          lectura.operacion,
          dto.idAlmacen,
          catalogo,
        );
        resultados[i] = {
          nombre: archivo.nombre,
          ok: true,
          serieNumero: serieNumero(lectura.doc),
          ...r,
        };
      } catch (e) {
        resultados[i] = {
          nombre: archivo.nombre,
          ok: false,
          serieNumero: serieNumero(lectura.doc),
          error: mensajeDe(e),
        };
      }
    }
    return resultados;
  }

  private async registrarUno(
    personaId: number,
    archivo: ArchivoARegistrarDto,
    doc: CpeDocumento,
    operacion: Operacion,
    idAlmacen: number | undefined,
    catalogo: Awaited<ReturnType<ImportacionService['catalogo']>>,
  ) {
    if (doc.moneda !== 'PEN' && doc.moneda !== 'USD') {
      throw new BadRequestException(`Moneda no soportada: ${doc.moneda}`);
    }
    let tipoCambio = archivo.tipoCambio;
    if (doc.moneda === 'USD' && !tipoCambio) {
      tipoCambio = (await this.tipoCambioDe(doc.fechaEmision)) ?? undefined;
      if (!tipoCambio) {
        throw new BadRequestException(
          `Falta el tipo de cambio del ${doc.fechaEmision}`,
        );
      }
    }

    // Cada línea del XML debe tener su resolución
    const porOrden = new Map(archivo.lineas.map((r) => [r.orden, r]));
    const faltan = doc.lineas.filter((l) => !porOrden.has(l.orden));
    if (faltan.length) {
      throw new BadRequestException(
        `Falta decidir qué es la línea ${faltan.map((l) => l.orden).join(', ')}`,
      );
    }
    for (const l of doc.lineas) {
      const r = porOrden.get(l.orden)!;
      if (r.tipo === 'producto' && !r.idProducto && !r.nuevoProducto) {
        throw new BadRequestException(
          `Línea ${l.orden}: elige un producto o crea uno nuevo`,
        );
      }
      if (r.tipo === 'servicio' && !r.codigoCuenta) {
        throw new BadRequestException(
          `Línea ${l.orden}: elige la cuenta de gasto o ingreso`,
        );
      }
    }
    const hayProductos = archivo.lineas.some((r) => r.tipo === 'producto');
    if (hayProductos && !idAlmacen) {
      throw new BadRequestException(
        'Elige el almacén de la carga: hay líneas de producto',
      );
    }

    const parte = operacion === 'compra' ? doc.emisor : doc.receptor;
    const entidad = await this.entidadPara(personaId, parte, operacion);

    // Nota: comprobante que modifica (ya registrado, quizá en esta carga)
    let idComprobanteAfecto: number | undefined;
    if (doc.tipoComprobante === '07' || doc.tipoComprobante === '08') {
      const ref = doc.referencias[0]?.serieNumero;
      const af = ref
        ? await this.buscarPorSerieNumero(personaId, entidad.id, operacion, ref)
        : null;
      if (!af) {
        throw new BadRequestException(
          `No está registrado el comprobante ${ref ?? '(sin referencia)'} que modifica la nota`,
        );
      }
      idComprobanteAfecto = af.idComprobante;
    }

    // Líneas: producto (con su inventario en el almacén) o servicio
    const detalles: CreateComprobanteDetalleDto[] = [];
    for (const l of doc.lineas) {
      const r = porOrden.get(l.orden)!;
      const montos = importes(l);
      if (r.tipo === 'servicio') {
        detalles.push({
          tipoLinea: 'servicio',
          codigoCuenta: r.codigoCuenta,
          idArea: r.idArea,
          cantidad: l.cantidad,
          unidadMedida: l.unidad.slice(0, 10),
          precioUnitario: montos.subtotal / l.cantidad,
          ...montos,
          descripcion: l.descripcion.slice(0, 255),
        });
        continue;
      }
      const producto = await this.productoPara(personaId, r);
      const factor = r.factor ?? 1;
      const cantidad = l.cantidad * factor;
      const idInventario = await this.inventarioPara(idAlmacen!, producto.id);
      detalles.push({
        tipoLinea: 'producto',
        idInventario,
        cantidad,
        unidadMedida: (factor === 1 ? l.unidad : producto.unidadMedida).slice(
          0,
          10,
        ),
        precioUnitario: montos.subtotal / cantidad,
        ...montos,
        descripcion: l.descripcion.slice(0, 255),
      });
      r.idProducto = producto.id;
    }

    const comprobante: CreateComprobanteDto = {
      idPersona: entidad.id,
      idTipoOperacion: catalogo.operacion[operacion],
      idTipoComprobante: catalogo.comprobante[doc.tipoComprobante],
      fechaEmision: doc.fechaEmision as unknown as Date,
      fechaVencimiento: (doc.fechaVencimiento ?? undefined) as unknown as Date,
      moneda: doc.moneda as Moneda,
      tipoCambio: doc.moneda === 'USD' ? tipoCambio : 1,
      serie: doc.serie.slice(0, 5),
      numero: doc.numero.slice(0, 20),
      detalles,
      idComprobanteAfecto,
    };
    const guardado = await this.comprobantes.register(comprobante, personaId);

    // Se recuerda lo decidido solo si el comprobante quedó registrado
    await this.recordar(personaId, doc, archivo.lineas);

    return {
      idComprobante: guardado.idComprobante,
      correlativo: guardado.correlativo,
    };
  }

  // ───────────────────────── Equivalencias ─────────────────────────

  async listarEquivalencias(personaId: number) {
    return this.dataSource.getRepository(EquivalenciaProducto).find({
      where: { idPersona: personaId },
      order: { actualizado: 'DESC' },
    });
  }

  async eliminarEquivalencia(personaId: number, id: number) {
    await this.dataSource
      .getRepository(EquivalenciaProducto)
      .delete({ id, idPersona: personaId });
    return { ok: true };
  }

  private async recordar(
    personaId: number,
    doc: CpeDocumento,
    resoluciones: ResolucionLineaDto[],
  ) {
    const repo = this.dataSource.getRepository(EquivalenciaProducto);
    const porOrden = new Map(resoluciones.map((r) => [r.orden, r]));
    for (const l of doc.lineas) {
      const r = porOrden.get(l.orden);
      if (!r || r.recordar === false) continue;
      await repo.upsert(
        {
          idPersona: personaId,
          documentoEmisor: doc.emisor.numeroDocumento,
          clave: claveLinea(l),
          descripcion: l.descripcion.slice(0, 255),
          tipo: r.tipo,
          idProducto: r.tipo === 'producto' ? (r.idProducto ?? null) : null,
          factor: r.tipo === 'producto' ? (r.factor ?? 1) : 1,
          codigoCuenta: r.tipo === 'servicio' ? (r.codigoCuenta ?? null) : null,
          idArea: r.tipo === 'servicio' ? (r.idArea ?? null) : null,
          actualizado: new Date(),
        },
        ['idPersona', 'documentoEmisor', 'clave'],
      );
    }
  }

  private async equivalenciasDe(
    personaId: number,
    emisor: string,
    claves: string[],
  ) {
    const filas = claves.length
      ? await this.dataSource.getRepository(EquivalenciaProducto).find({
          where: {
            idPersona: personaId,
            documentoEmisor: emisor,
            clave: In(claves),
          },
        })
      : [];
    return new Map(filas.map((f) => [f.clave, f]));
  }

  /**
   * Orden de búsqueda: lo recordado → código del producto → GTIN →
   * nombre parecido (solo sugerencia, hay que confirmarlo).
   */
  private sugerir(
    l: CpeLinea,
    eq: EquivalenciaProducto | undefined,
    productos: Producto[],
  ): Sugerencia | null {
    const deProducto = (
      p: Producto,
      origen: 'equivalencia' | 'codigo' | 'gtin' | 'nombre',
      factor = 1,
    ): Sugerencia => ({
      tipo: 'producto',
      idProducto: p.id,
      nombre: p.nombre,
      codigo: p.codigo ?? null,
      unidadMedida: p.unidadMedida,
      factor,
      origen,
      segura: origen !== 'nombre',
    });

    if (eq?.tipo === 'servicio' && eq.codigoCuenta) {
      return {
        tipo: 'servicio',
        codigoCuenta: eq.codigoCuenta,
        idArea: eq.idArea,
        origen: 'equivalencia',
        segura: true,
      };
    }
    if (eq?.idProducto) {
      const p = productos.find((x) => x.id === eq.idProducto);
      if (p) return deProducto(p, 'equivalencia', Number(eq.factor) || 1);
    }
    const porCodigo = (codigo: string | null) =>
      codigo
        ? productos.find(
            (p) => p.codigo?.trim().toUpperCase() === codigo.toUpperCase(),
          )
        : undefined;
    const c = porCodigo(l.codigoVendedor);
    if (c) return deProducto(c, 'codigo');
    const g = porCodigo(l.codigoGtin);
    if (g) return deProducto(g, 'gtin');

    let mejor: Producto | null = null;
    let puntaje = 0;
    for (const p of productos) {
      const s = parecido(l.descripcion, p.nombre);
      if (s > puntaje) {
        puntaje = s;
        mejor = p;
      }
    }
    return mejor && puntaje >= PARECIDO_MINIMO
      ? deProducto(mejor, 'nombre')
      : null;
  }

  // ───────────────────────── Apoyo ─────────────────────────

  private leer(a: ArchivoXmlDto, ruc: string): Lectura {
    let doc: CpeDocumento;
    try {
      doc = leerCpe(Buffer.from(a.contenido, 'base64'));
    } catch (e) {
      return {
        nombre: a.nombre,
        error: e instanceof CpeError ? e.message : 'No se pudo leer el XML',
      };
    }
    if (doc.emisor.numeroDocumento === ruc) {
      return { nombre: a.nombre, doc, operacion: 'venta' };
    }
    if (doc.receptor.numeroDocumento === ruc) {
      return { nombre: a.nombre, doc, operacion: 'compra' };
    }
    return {
      nombre: a.nombre,
      error: `${NOMBRE_TIPO[doc.tipoComprobante]} ${serieNumero(doc)}: no es de tu empresa (RUC ${ruc}). Emisor ${doc.emisor.numeroDocumento}, receptor ${doc.receptor.numeroDocumento}`,
    };
  }

  private archivoConError(nombre: string, error: string): ArchivoPrevio {
    return {
      nombre,
      valido: false,
      errores: [error],
      avisos: [],
      operacion: null,
      documento: null,
      contraparte: null,
      afectado: null,
      tipoCambio: null,
      lineas: [],
    };
  }

  /** Identifica un documento: tipo, serie, número, emisor y sentido */
  private claveDocumento(doc: CpeDocumento, op: Operacion, ruc: string) {
    const parte = op === 'compra' ? doc.emisor.numeroDocumento : ruc;
    return `${op}|${parte}|${doc.tipoComprobante}|${serieNumero(doc)}`;
  }

  private async rucEmpresa(personaId: number) {
    const persona = await this.personas.findById(personaId);
    if (!persona?.ruc) {
      throw new BadRequestException('Tu empresa no tiene RUC registrado');
    }
    return persona.ruc.trim();
  }

  private async periodoVigente(personaId: number) {
    try {
      const activo = await this.periodos.obtenerPeriodoActivo(personaId);
      const p = await this.periodos.obtenerPorId(activo.id);
      return { inicio: ymd(p.fechaInicio), fin: ymd(p.fechaFin) };
    } catch {
      return null;
    }
  }

  private async tipoCambioDe(fecha: string): Promise<number | null> {
    const r = await this.tipoCambio.obtenerTipoCambio(fecha);
    return r.success && r.data ? Number(r.data.venta) || null : null;
  }

  private async catalogo() {
    const filas = await this.dataSource.getRepository(TablaDetalle).find({
      where: [
        { tabla: { numeroTabla: '12' }, codigo: In(['01', '02']) },
        { tabla: { numeroTabla: '10' }, codigo: In(['01', '03', '07', '08']) },
      ],
      relations: ['tabla'],
    });
    const id = (tabla: string, codigo: string) => {
      const f = filas.find(
        (x) => x.tabla.numeroTabla === tabla && x.codigo === codigo,
      );
      if (!f) {
        throw new BadRequestException(
          `Falta el código ${codigo} en la tabla ${tabla}`,
        );
      }
      return f.idTablaDetalle;
    };
    return {
      operacion: { venta: id('12', '01'), compra: id('12', '02') },
      comprobante: {
        '01': id('10', '01'),
        '03': id('10', '03'),
        '07': id('10', '07'),
        '08': id('10', '08'),
      } as Record<string, number>,
    };
  }

  private buscarEntidad(personaId: number, documento: string) {
    return this.dataSource.getRepository(Entidad).findOne({
      where: {
        persona: { id: personaId },
        numeroDocumento: documento || CLIENTES_VARIOS,
      },
    });
  }

  /** La contraparte del comprobante; si no existe se crea con el rol que toca */
  private async entidadPara(
    personaId: number,
    parte: CpeDocumento['emisor'],
    operacion: Operacion,
  ): Promise<Entidad> {
    const repo = this.dataSource.getRepository(Entidad);
    const rol = operacion === 'compra' ? 'esProveedor' : 'esCliente';
    const existente = await this.buscarEntidad(
      personaId,
      parte.numeroDocumento,
    );
    if (existente) {
      if (!existente[rol] || !existente.activo) {
        existente[rol] = true;
        existente.activo = true;
        await repo.save(existente);
      }
      return existente;
    }

    const doc = parte.numeroDocumento;
    const direccion =
      parte.direccion && parte.direccion.length >= 5
        ? parte.direccion.slice(0, 255)
        : undefined;
    const base = {
      esProveedor: operacion === 'compra',
      esCliente: operacion === 'venta',
      persona: { id: personaId },
      direccion,
    };
    const nueva = /^\d{11}$/.test(doc)
      ? repo.create({
          ...base,
          tipo: EntidadType.JURIDICA,
          numeroDocumento: doc,
          razonSocial: parte.razonSocial.slice(0, 255),
        })
      : /^\d{8}$/.test(doc)
        ? repo.create({
            ...base,
            tipo: EntidadType.NATURAL,
            numeroDocumento: doc,
            ...separarNombre(parte.razonSocial),
          })
        : repo.create({
            ...base,
            tipo: EntidadType.NATURAL,
            numeroDocumento: CLIENTES_VARIOS,
            nombre: 'CLIENTES',
            apellidoPaterno: 'VARIOS',
            apellidoMaterno: '-',
          });
    if (nueva.numeroDocumento === CLIENTES_VARIOS) {
      const varios = await this.buscarEntidad(personaId, CLIENTES_VARIOS);
      if (varios) return varios;
    }
    return repo.save(nueva);
  }

  private buscarComprobante(
    personaId: number,
    idEntidad: number,
    operacion: Operacion,
    tipo: string,
    serie: string,
    numero: string,
  ) {
    return this.dataSource.getRepository(Comprobante).findOne({
      where: {
        persona: { id: personaId },
        entidad: { id: idEntidad },
        tipoOperacion: {
          codigo: operacion === 'venta' ? '01' : '02',
          tabla: { numeroTabla: '12' },
        },
        tipoComprobante: { codigo: tipo, tabla: { numeroTabla: '10' } },
        serie,
        numero,
      },
    });
  }

  /** Comprobante (factura o boleta) por "serie-número" de la contraparte */
  private async buscarPorSerieNumero(
    personaId: number,
    idEntidad: number,
    operacion: Operacion,
    ref: string,
  ) {
    const g = ref.lastIndexOf('-');
    if (g < 1) return null;
    const serie = ref.slice(0, g).trim();
    const numero = ref.slice(g + 1).trim();
    for (const tipo of ['01', '03']) {
      const c = await this.buscarComprobante(
        personaId,
        idEntidad,
        operacion,
        tipo,
        serie,
        numero,
      );
      if (c) return c;
    }
    return null;
  }

  private async resolverAfectado(
    personaId: number,
    doc: CpeDocumento,
    operacion: Operacion,
    idEntidad: number | null,
    enCarga: Map<string, number>,
    ruc: string,
  ): Promise<ArchivoPrevio['afectado']> {
    const ref = doc.referencias[0]?.serieNumero;
    if (!ref) return null;
    const registrado = idEntidad
      ? await this.buscarPorSerieNumero(personaId, idEntidad, operacion, ref)
      : null;
    const parte = operacion === 'compra' ? doc.emisor.numeroDocumento : ruc;
    const enEstaCarga = ['01', '03'].some((t) =>
      enCarga.has(`${operacion}|${parte}|${t}|${ref}`),
    );
    return {
      serieNumero: ref,
      idComprobante: registrado?.idComprobante ?? null,
      enEstaCarga,
    };
  }

  private async validarAlmacen(personaId: number, idAlmacen: number) {
    const a = await this.dataSource.getRepository(Almacen).findOne({
      where: { id: idAlmacen, persona: { id: personaId } },
    });
    if (!a) throw new BadRequestException('El almacén no es de tu empresa');
  }

  /**
   * Producto elegido o nuevo. Un "nuevo" que ya existe (mismo código o mismo
   * nombre, p. ej. creado por otro archivo de la carga) se reutiliza.
   */
  private async productoPara(
    personaId: number,
    r: ResolucionLineaDto,
  ): Promise<Producto> {
    const repo = this.dataSource.getRepository(Producto);
    if (r.idProducto) {
      const p = await repo.findOne({
        where: { id: r.idProducto, persona: { id: personaId } },
      });
      if (!p) {
        throw new BadRequestException(
          `El producto ${r.idProducto} no es de tu empresa`,
        );
      }
      return p;
    }
    const n = r.nuevoProducto!;
    const codigo = n.codigo?.trim() || undefined;
    const todos = await repo.find({ where: { persona: { id: personaId } } });
    const igual = todos.find(
      (p) =>
        (codigo && p.codigo === codigo) ||
        normalizar(p.nombre) === normalizar(n.nombre),
    );
    if (igual) return igual;
    const creado = await this.productos.create(
      {
        idCategoria: n.idCategoria,
        tipo: TipoProducto.PRODUCTO,
        nombre: n.nombre.trim(),
        descripcion: n.nombre.trim(),
        unidadMedida: n.unidadMedida,
        codigo,
      },
      personaId,
    );
    return (await repo.findOne({ where: { id: creado.id } }))!;
  }

  private async inventarioPara(idAlmacen: number, idProducto: number) {
    const inv = await this.dataSource.getRepository(Inventario).findOne({
      where: { almacen: { id: idAlmacen }, producto: { id: idProducto } },
    });
    if (inv) return Number(inv.id);
    const nuevo = await this.inventarios.create({ idAlmacen, idProducto });
    return Number(nuevo.id);
  }
}

/** Importes de la línea tal como los espera el registro de comprobantes */
function importes(l: CpeLinea) {
  if (l.gratuita) return { subtotal: 0, igv: 0, isc: 0, total: 0 };
  const subtotal = r2(l.subtotal);
  const igv = r2(l.igv);
  const isc = r2(l.isc);
  return { subtotal, igv, isc, total: r2(subtotal + igv + isc) };
}

function mensajeDe(e: unknown): string {
  if (e instanceof BadRequestException || e instanceof Error) {
    const r = (e as BadRequestException).getResponse?.();
    if (r && typeof r === 'object') {
      const m = (r as { message?: unknown }).message;
      if (Array.isArray(m)) return m.join('. ');
      if (typeof m === 'string') return m;
    }
    return e.message;
  }
  return 'Error al registrar';
}
