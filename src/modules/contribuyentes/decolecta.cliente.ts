import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { TipoDocumentoIdentidad } from './documento-identidad';
import type { DatosContribuyente } from './contribuyente.types';

type Crudo = Record<string, unknown>;

/** Error del servicio externo (sin token, caído, límite…), distinto de "no existe". */
export class ServicioNoDisponible extends Error {}

const texto = (o: Crudo, ...claves: string[]) => {
  for (const c of claves) {
    const v = o[c];
    if (typeof v === 'string' && v.trim() && v.trim() !== '-') return v.trim();
  }
  return undefined;
};

/**
 * Cliente de Decolecta: RUC desde el padrón de SUNAT y DNI desde RENIEC.
 * Usa el mismo token que el tipo de cambio (SUNAT_API_TOKEN).
 */
@Injectable()
export class DecolectaCliente {
  constructor(private readonly config: ConfigService) {}

  /** null si el número no existe; lanza ServicioNoDisponible si no se pudo consultar. */
  async consultar(
    tipo: TipoDocumentoIdentidad,
    numero: string,
  ): Promise<DatosContribuyente | null> {
    const token = this.config.get<string>('SUNAT_API_TOKEN');
    if (!token) throw new ServicioNoDisponible('Falta SUNAT_API_TOKEN');
    const base =
      this.config.get<string>('DECOLECTA_URL') ??
      'https://api.decolecta.com/v1';
    const ruta = tipo === 'RUC' ? 'sunat/ruc/full' : 'reniec/dni';
    try {
      const { data } = await axios.get<Crudo>(`${base}/${ruta}`, {
        params: { numero },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      });
      return tipo === 'RUC' ? this.ruc(data) : this.dni(data);
    } catch (e) {
      const http = e as { response?: { status?: number }; code?: string };
      const status = http.response?.status;
      if (status === 404 || status === 422) return null;
      throw new ServicioNoDisponible(`Decolecta ${status ?? http.code ?? e}`);
    }
  }

  private ruc(o: Crudo): DatosContribuyente | null {
    const razonSocial = texto(o, 'razon_social', 'razonSocial', 'nombre');
    if (!razonSocial) return null;
    return {
      razonSocial,
      direccion: texto(o, 'direccion', 'direccion_completa'),
      estado: texto(o, 'estado')?.toUpperCase(),
      condicion: texto(o, 'condicion')?.toUpperCase(),
    };
  }

  private dni(o: Crudo): DatosContribuyente | null {
    const nombres = texto(o, 'first_name', 'nombres');
    if (!nombres) return null;
    return {
      nombres,
      apellidoPaterno: texto(
        o,
        'first_last_name',
        'apellido_paterno',
        'apellidoPaterno',
      ),
      apellidoMaterno: texto(
        o,
        'second_last_name',
        'apellido_materno',
        'apellidoMaterno',
      ),
    };
  }
}
