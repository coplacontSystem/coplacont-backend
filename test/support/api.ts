import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

/** Cliente HTTP autenticado para los tests. */
export class Api {
  constructor(
    private readonly app: INestApplication,
    public token?: string,
  ) {}

  private auth(req: request.Test): request.Test {
    return this.token ? req.set('Authorization', `Bearer ${this.token}`) : req;
  }

  get(url: string) {
    return this.auth(request(this.app.getHttpServer()).get(url));
  }

  post(url: string, body: object = {}) {
    return this.auth(request(this.app.getHttpServer()).post(url).send(body));
  }

  put(url: string, body: object = {}) {
    return this.auth(request(this.app.getHttpServer()).put(url).send(body));
  }

  patch(url: string, body: object = {}) {
    return this.auth(request(this.app.getHttpServer()).patch(url).send(body));
  }

  delete(url: string) {
    return this.auth(request(this.app.getHttpServer()).delete(url));
  }
}

/** Devuelve el id de una respuesta, venga plana o envuelta en `data`. */
export function idOf(body: any): number {
  const id = body?.id ?? body?.data?.id ?? body?.idComprobante;
  if (id === undefined || id === null) {
    throw new Error(
      `La respuesta no trae id: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return Number(id);
}

export interface Empresa {
  personaId: number;
  api: Api;
}

let ruc = 20100000000;

/**
 * Crea una empresa con un usuario EMPRESA directamente en BD (el alta real envía
 * la clave por correo) y devuelve un cliente ya autenticado.
 */
export async function crearEmpresa(
  app: INestApplication,
  nombre: string,
): Promise<Empresa> {
  const ds = app.get(DataSource);
  ruc += 1;
  const email = `${nombre.toLowerCase().replace(/\W+/g, '.')}@test.local`;
  const password = `Clave-${ruc}`;

  const [persona] = await ds.query(
    `INSERT INTO persona ("nombreEmpresa", ruc, "razonSocial", telefono, direccion)
     VALUES ($1, $2, $3, '999999999', 'Av. de Pruebas 123') RETURNING id`,
    [nombre, String(ruc), `${nombre} S.A.C.`],
  );
  const hash = await bcrypt.hash(password, 10);
  const [user] = await ds.query(
    `INSERT INTO "user" (email, nombre, contrasena, habilitado, "esPrincipal", "personaId")
     VALUES ($1, $2, $3, true, true, $4) RETURNING id`,
    [email, `Usuario ${nombre}`, hash, persona.id],
  );
  await ds.query(
    `INSERT INTO user_role ("userId", "roleId") SELECT $1, id FROM role WHERE nombre = 'EMPRESA'`,
    [user.id],
  );

  const api = new Api(app);
  const login = await api.post('/api/auth/login', {
    email,
    contrasena: password,
  });
  if (!login.body?.jwt) {
    throw new Error(`No se pudo iniciar sesión: ${JSON.stringify(login.body)}`);
  }
  api.token = login.body.jwt;
  return { personaId: Number(persona.id), api };
}
