import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ComprobanteTotales } from '../entities/comprobante-totales';
import { Repository, EntityManager } from 'typeorm';
import { ComprobanteDetalle } from '../entities/comprobante-detalle';
import { Comprobante } from '../entities/comprobante';

export interface DesgloseTotales {
  gravada?: number;
  exonerada?: number;
  inafecta?: number;
  igv?: number;
  isc?: number;
}

/** G gravada, E exonerada, I inafecta o exportación (catálogo 07) */
export function grupoAfectacion(codigo?: string | null): 'G' | 'E' | 'I' {
  if (codigo?.startsWith('2')) return 'E';
  if (codigo?.startsWith('3') || codigo === '40') return 'I';
  return 'G';
}

@Injectable()
export class ComprobanteTotalesService {
  constructor(
    @InjectRepository(ComprobanteTotales)
    private readonly comprobanteTotalesRepository: Repository<ComprobanteTotales>,
  ) {}

  async register(
    idComprobante: number,
    detalles: ComprobanteDetalle[],
    manager?: EntityManager,
  ) {
    /**
     * Registra los totales de un comprobante calculándolos a partir de sus detalles.
     * En caso de comprobantes sin detalles, utilizar `registerFromTotal`.
     */
    const comprobante = new Comprobante();
    comprobante.idComprobante = idComprobante;

    // Calcular totales
    // Base por afectación del IGV (sin dato: gravada, como antes)
    const base = (grupo: 'G' | 'E' | 'I') =>
      detalles
        .filter((d) => grupoAfectacion(d.afectacionIgv) === grupo)
        .reduce((sum, d) => sum + Number(d.subtotal), 0);
    const totalGravada = base('G');
    const totalIgv = detalles.reduce((sum, d) => sum + Number(d.igv ?? 0), 0);
    const totalIsc = detalles.reduce((sum, d) => sum + Number(d.isc ?? 0), 0);
    const totalGeneral = detalles.reduce((sum, d) => sum + Number(d.total), 0);

    const totalExonerada = base('E');
    const totalInafecta = base('I');

    // Usar el repositorio apropiado según si hay EntityManager
    const totalesRepo = manager
      ? manager.getRepository(ComprobanteTotales)
      : this.comprobanteTotalesRepository;

    // Crear entidad totales
    const totales = totalesRepo.create({
      comprobante,
      totalGravada,
      totalExonerada,
      totalInafecta,
      totalIgv,
      totalIsc,
      totalGeneral,
    });

    // Guardar totales en BD
    await totalesRepo.save(totales);
  }

  /**
   * Registra totales para comprobantes sin detalles, usando un total general provisto.
   * Los campos restantes se inicializan en 0 por defecto.
   * @param idComprobante ID del comprobante recién creado
   * @param totalGeneral Total general enviado en el payload
   * @param manager EntityManager opcional para transacción
   */
  async registerFromTotal(
    idComprobante: number,
    totalGeneral: number,
    manager?: EntityManager,
    desglose?: DesgloseTotales,
  ) {
    const comprobante = new Comprobante();
    comprobante.idComprobante = idComprobante;

    const totalesRepo = manager
      ? manager.getRepository(ComprobanteTotales)
      : this.comprobanteTotalesRepository;

    const totales = totalesRepo.create({
      comprobante,
      totalGravada: desglose?.gravada ?? 0,
      totalExonerada: desglose?.exonerada ?? 0,
      totalInafecta: desglose?.inafecta ?? 0,
      totalIgv: desglose?.igv ?? 0,
      totalIsc: desglose?.isc ?? 0,
      totalGeneral: Number(totalGeneral ?? 0),
    });

    await totalesRepo.save(totales);
  }
}
