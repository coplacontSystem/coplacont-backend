import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus } from './support/api';
import { rucValido } from 'src/modules/contribuyentes/documento-identidad';

/** Respuestas de Decolecta simuladas (mismos campos que la API real). */
const PADRON: Record<string, object> = {
  '/sunat/ruc/full?numero=20612355461': {
    razon_social: 'ECUIDA E.I.R.L.',
    numero_documento: '20612355461',
    estado: 'ACTIVO',
    condicion: 'HABIDO',
    direccion: 'AV. LOS PINOS 123',
  },
  '/sunat/ruc/full?numero=20601030013': {
    razon_social: 'PROVEEDOR FANTASMA S.A.C.',
    estado: 'BAJA DE OFICIO',
    condicion: 'NO HABIDO',
  },
  '/reniec/dni?numero=46027897': {
    first_name: 'ANA MARIA',
    first_last_name: 'QUISPE',
    second_last_name: 'ROJAS',
  },
};

describe('Validación de RUC/DNI con SUNAT y RENIEC (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let stub: Server;
  let llamadas = 0;
  let caido = false;
  const api = () => empresa.api;

  beforeAll(async () => {
    stub = createServer((req, res) => {
      llamadas++;
      const ruta = (req.url ?? '').replace(/^\/v1/, '');
      const cuerpo = PADRON[ruta];
      if (caido) res.writeHead(503).end();
      else if (req.headers.authorization !== 'Bearer token-prueba') {
        res.writeHead(401).end();
      } else if (cuerpo) res.writeHead(200).end(JSON.stringify(cuerpo));
      else res.writeHead(404).end('{}');
    });
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
    const { port } = stub.address() as AddressInfo;
    process.env.DECOLECTA_URL = `http://127.0.0.1:${port}/v1`;
    process.env.SUNAT_API_TOKEN = 'token-prueba';
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Contribuyentes');
  });

  afterAll(async () => {
    await app.close();
    stub.close();
  });

  it('valida el dígito verificador del RUC', () => {
    expect(rucValido('20611143878')).toBe(true);
    expect(rucValido('10467793549')).toBe(true);
    expect(rucValido('20611143877')).toBe(false);
    expect(rucValido('30611143878')).toBe(false);
  });

  it('trae los datos del RUC y luego los sirve desde la caché', async () => {
    const r = await api().get('/api/contribuyentes/20612355461');
    esperarStatus(r, 200);
    expect(r.body).toMatchObject({
      tipo: 'RUC',
      encontrado: true,
      razonSocial: 'ECUIDA E.I.R.L.',
      estado: 'ACTIVO',
      condicion: 'HABIDO',
      direccion: 'AV. LOS PINOS 123',
      fuente: 'consulta',
      avisos: [],
    });
    const antes = llamadas;
    const otra = await api().get('/api/contribuyentes/20612355461');
    expect(otra.body.fuente).toBe('cache');
    expect(llamadas).toBe(antes);
  });

  it('avisa si el RUC no está activo o no es habido', async () => {
    const r = await api().get('/api/contribuyentes/20601030013');
    expect(r.body.avisos).toEqual([
      'PROVEEDOR FANTASMA S.A.C.: RUC en estado BAJA DE OFICIO',
      'PROVEEDOR FANTASMA S.A.C.: condición NO HABIDO',
    ]);
  });

  it('trae nombres del DNI y marca los que no existen', async () => {
    const dni = await api().get('/api/contribuyentes/46027897');
    expect(dni.body).toMatchObject({
      tipo: 'DNI',
      nombres: 'ANA MARIA',
      apellidoPaterno: 'QUISPE',
      apellidoMaterno: 'ROJAS',
    });
    const nada = await api().get('/api/contribuyentes/10467793549');
    expect(nada.body).toMatchObject({ encontrado: false });
    expect(nada.body.avisos[0]).toMatch(/no figura en el padrón/);
  });

  it('rechaza números inválidos sin consultar fuera', async () => {
    const antes = llamadas;
    esperarStatus(await api().get('/api/contribuyentes/20611143877'), 400);
    esperarStatus(await api().get('/api/contribuyentes/123'), 400);
    expect(llamadas).toBe(antes);
  });

  it('si el servicio cae, responde sin datos en lugar de fallar', async () => {
    caido = true;
    const r = await api().get('/api/contribuyentes/20611143878');
    esperarStatus(r, 200);
    expect(r.body).toMatchObject({ fuente: 'sin-servicio', encontrado: false });
    caido = false;
  });
});
