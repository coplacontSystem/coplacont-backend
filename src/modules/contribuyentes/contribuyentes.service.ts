import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContribuyenteConsulta } from './contribuyente-consulta.entity';
import type { Contribuyente } from './contribuyente.types';
import { DecolectaCliente, ServicioNoDisponible } from './decolecta.cliente';
import { tipoDocumento } from './documento-identidad';

const DIA = 24 * 60 * 60 * 1000;
/** Los datos de un RUC cambian poco; un número no encontrado se reintenta antes. */
const VIGENCIA = { encontrado: 30 * DIA, noEncontrado: DIA };

@Injectable()
export class ContribuyentesService {
  private readonly logger = new Logger(ContribuyentesService.name);

  constructor(
    @InjectRepository(ContribuyenteConsulta)
    private readonly cache: Repository<ContribuyenteConsulta>,
    private readonly decolecta: DecolectaCliente,
  ) {}

  /** Valida el número y trae sus datos (de la caché si están vigentes). */
  async consultar(numero: string): Promise<Contribuyente> {
    const t = tipoDocumento(numero);
    if ('error' in t) throw new BadRequestException(t.error);
    const tipo = t.tipo;

    const guardado = await this.cache.findOne({ where: { numero } });
    const vigencia = guardado?.encontrado
      ? VIGENCIA.encontrado
      : VIGENCIA.noEncontrado;
    if (guardado && Date.now() - guardado.fechaConsulta.getTime() < vigencia) {
      return this.respuesta(guardado, 'cache');
    }

    try {
      const datos = await this.decolecta.consultar(tipo, numero);
      const fila = await this.cache.save({
        numero,
        tipo,
        encontrado: !!datos,
        datos: datos ?? {},
        fechaConsulta: new Date(),
      });
      return this.respuesta(fila, 'consulta');
    } catch (e) {
      if (!(e instanceof ServicioNoDisponible)) throw e;
      this.logger.warn(`No se pudo consultar ${numero}: ${e.message}`);
      // Mejor un dato antiguo que ninguno
      if (guardado) return this.respuesta(guardado, 'cache');
      return {
        tipo,
        numero,
        encontrado: false,
        fuente: 'sin-servicio',
        avisos: ['No se pudo consultar SUNAT/RENIEC en este momento'],
      };
    }
  }

  /** Igual que consultar, pero nunca falla: para avisos en otros procesos. */
  async consultarSinFallar(numero: string): Promise<Contribuyente | null> {
    try {
      return await this.consultar(numero);
    } catch {
      return null;
    }
  }

  private respuesta(
    f: ContribuyenteConsulta,
    fuente: Contribuyente['fuente'],
  ): Contribuyente {
    const avisos: string[] = [];
    const nombre = f.datos.razonSocial ?? f.numero;
    if (!f.encontrado) {
      avisos.push(
        f.tipo === 'RUC'
          ? `El RUC ${f.numero} no figura en el padrón de SUNAT`
          : `El DNI ${f.numero} no figura en RENIEC`,
      );
    }
    if (f.datos.estado && f.datos.estado !== 'ACTIVO') {
      avisos.push(`${nombre}: RUC en estado ${f.datos.estado}`);
    }
    if (f.datos.condicion && f.datos.condicion !== 'HABIDO') {
      avisos.push(`${nombre}: condición ${f.datos.condicion}`);
    }
    return {
      tipo: f.tipo,
      numero: f.numero,
      encontrado: f.encontrado,
      ...f.datos,
      fuente,
      fechaConsulta: f.fechaConsulta.toISOString(),
      avisos,
    };
  }
}
