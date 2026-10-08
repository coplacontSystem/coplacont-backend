export type EstadoPeriodoEmpresa = 'activo' | 'vencido';

export interface EmpresaFila {
  id: number;
  razonSocial: string;
  ruc: string;
  habilitada: boolean;
  usuarios: number;
  periodo: { año: number; estado: EstadoPeriodoEmpresa; fin: string } | null;
  ultimoAcceso: string | null;
  comprobantesMes: number;
  creada: string;
}

export type TipoAtencion =
  | 'sinPeriodo'
  | 'periodoVencido'
  | 'inactiva'
  | 'sinLogin';

export interface ItemAtencion {
  tipo: TipoAtencion;
  severidad: 'alta' | 'media' | 'baja';
  idPersona: number;
  empresa: string;
  /** Solo en sinLogin */
  usuario?: { id: number; nombre: string; email: string; alta: string };
  /** sinPeriodo/periodoVencido: año y fin del periodo; inactiva: última actividad */
  periodo?: { año: number; fin: string };
  ultimaActividad?: string | null;
}

export interface AdminDashboard {
  kpis: {
    empresasHabilitadas: number;
    empresasDeshabilitadas: number;
    usuarios: number;
    empresasActivas30: number;
    comprobantesMes: number;
    comprobantesMesAnterior: number;
    /** % frente al mes anterior; null si el anterior fue 0 */
    variacion: number | null;
  };
  actividad: { mes: string; comprobantes: number; empresasNuevas: number }[];
  atencion: ItemAtencion[];
  empresas: EmpresaFila[];
  accesos: {
    idUsuario: number;
    nombre: string;
    empresa: string | null;
    agente: string | null;
    fecha: string;
  }[];
  altas: { id: number; razonSocial: string; fecha: string; usuarios: number }[];
}

export interface EmpresaDetalle {
  id: number;
  razonSocial: string;
  nombreComercial: string;
  ruc: string;
  direccion: string | null;
  telefono: string | null;
  logo: string | null;
  habilitada: boolean;
  creada: string;
  usuarios: {
    id: number;
    nombre: string;
    email: string;
    habilitado: boolean;
    principal: boolean;
    ultimoAcceso: string | null;
  }[];
  periodos: {
    id: number;
    año: number;
    estado: string;
    inicio: string;
    fin: string;
  }[];
  actividad: { mes: string; comprobantes: number }[];
}
