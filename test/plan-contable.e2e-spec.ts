import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import {
  crearAdmin,
  crearEmpresa,
  Empresa,
  esperarStatus,
} from './support/api';
import { planesIncluidos } from 'src/modules/contabilidad/planes/plan-archivo';

const PCGE_2019 = planesIncluidos().find(
  (p) => p.codigo === 'PCGE2019',
)!.cuentas;

describe('Plan contable (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let otra: Empresa;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Plan Contable');
    otra = await crearEmpresa(app, 'Empresa Plan Ajena');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => empresa.api;
  const cuenta = async (e: Empresa, codigo: string) =>
    (await e.api.get(`/api/plan-contable/cuentas/${codigo}`)).body;

  describe('Carga del PCGE 2019', () => {
    it('carga todas las cuentas oficiales una sola vez', async () => {
      const ds = app.get(DataSource);
      const [{ n }] = await ds.query(
        `SELECT COUNT(*) AS n FROM cuenta_contable c JOIN plan_contable p ON p.id = c.id_plan
          WHERE p.codigo = 'PCGE2019' AND c.id_persona IS NULL`,
      );
      expect(Number(n)).toBe(PCGE_2019.length);
      expect(PCGE_2019.length).toBe(1772);
    });

    it('cada cuenta cuelga de su cuenta padre y los códigos no se repiten', async () => {
      const ds = app.get(DataSource);
      const sinPadre = await ds.query(
        `SELECT codigo FROM cuenta_contable
          WHERE id_persona IS NULL AND length(codigo) > 2 AND id_padre IS NULL`,
      );
      expect(sinPadre).toEqual([]);
      const malColgadas = await ds.query(
        `SELECT c.codigo FROM cuenta_contable c JOIN cuenta_contable p ON p.id = c.id_padre
          WHERE c.codigo NOT LIKE p.codigo || '%'`,
      );
      expect(malColgadas).toEqual([]);
    });
  });

  describe('Consulta', () => {
    it('asigna el PCGE 2019 por defecto y resume por elemento', async () => {
      const res = await api().get('/api/plan-contable');
      esperarStatus(res, 200);
      expect(res.body.plan).toMatchObject({
        codigo: 'PCGE2019',
        codigoSunat: '01',
      });
      expect(res.body.elementos).toHaveLength(10);
      const e4 = res.body.elementos.find((e: any) => e.elemento === '4');
      expect(e4.cuentas).toBeGreaterThan(100);
    });

    it('lista un elemento con naturaleza e imputabilidad', async () => {
      const res = await api().get('/api/plan-contable/cuentas?elemento=4');
      esperarStatus(res, 200);
      const igv = res.body.find((c: any) => c.codigo === '40111');
      expect(igv).toMatchObject({
        nombre: 'IGV – Cuenta propia',
        nivel: 4,
        naturaleza: 'acreedora',
        imputable: true,
        propia: false,
        codigoPadre: '4011',
      });
      const padre = res.body.find((c: any) => c.codigo === '4011');
      expect(padre).toMatchObject({ imputable: false, tieneHijas: true });
      const depreciacion = (await cuenta(empresa, '39')).cuenta;
      expect(depreciacion.naturaleza).toBe('acreedora');
    });

    it('busca por nombre sin tildes y por código', async () => {
      const porNombre = await api().get(
        '/api/plan-contable/cuentas?q=deposito',
      );
      expect(porNombre.body.some((c: any) => c.codigo === '106')).toBe(true);
      const porCodigo = await api().get('/api/plan-contable/cuentas?q=6011');
      expect(porCodigo.body.map((c: any) => c.codigo)).toEqual(
        expect.arrayContaining(['6011']),
      );
      expect(
        porCodigo.body.every((c: any) => c.codigo.startsWith('6011')),
      ).toBe(true);
    });

    it('devuelve una cuenta con su ruta y sus subcuentas', async () => {
      const res = await api().get('/api/plan-contable/cuentas/4011');
      esperarStatus(res, 200);
      expect(res.body.ruta.map((c: any) => c.codigo)).toEqual(['40', '401']);
      expect(res.body.hijas.map((c: any) => c.codigo)).toContain('40111');
      expect((await api().get('/api/plan-contable/cuentas/99999')).status).toBe(
        404,
      );
    });
  });

  describe('Subcuentas propias', () => {
    it('crea una subcuenta bajo una cuenta de movimiento y la vuelve agrupadora solo para esa empresa', async () => {
      const res = await api().post('/api/plan-contable/cuentas', {
        codigoPadre: '1041',
        codigo: '104101',
        nombre: 'BCP cuenta corriente soles',
      });
      esperarStatus(res, 201);
      expect(res.body).toMatchObject({
        codigo: '104101',
        propia: true,
        imputable: true,
        naturaleza: 'deudora',
        nivel: 5,
      });
      expect((await cuenta(empresa, '1041')).cuenta.imputable).toBe(false);
      // La otra empresa no la ve y su 1041 sigue recibiendo movimientos
      expect((await cuenta(otra, '1041')).cuenta.imputable).toBe(true);
      expect(
        (await otra.api.get('/api/plan-contable/cuentas/104101')).status,
      ).toBe(404);
    });

    it('valida el código, el padre y los duplicados', async () => {
      const crear = (body: object) =>
        api().post('/api/plan-contable/cuentas', body);
      expect(
        (await crear({ codigoPadre: '1041', codigo: '105101', nombre: 'Otra' }))
          .status,
      ).toBe(400);
      expect(
        (
          await crear({
            codigoPadre: '1041',
            codigo: '1041001',
            nombre: 'Muy larga',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await crear({
            codigoPadre: '1041',
            codigo: '104101',
            nombre: 'Repetida',
          })
        ).status,
      ).toBe(409);
      expect(
        (await crear({ codigoPadre: '40', codigo: '401', nombre: 'Oficial' }))
          .status,
      ).toBe(409);
      expect(
        (
          await crear({
            codigoPadre: '7777',
            codigo: '77771',
            nombre: 'Sin padre',
          })
        ).status,
      ).toBe(404);
      expect((await crear({ codigo: '45', nombre: 'Sin padre' })).status).toBe(
        400,
      );
      expect(
        (await crear({ codigoPadre: '1041', codigo: '10A1', nombre: 'Letras' }))
          .status,
      ).toBe(400);
    });

    it('permite cuentas propias del elemento 9 sin padre', async () => {
      const res = await api().post('/api/plan-contable/cuentas', {
        codigo: '94',
        nombre: 'Gastos administrativos',
      });
      esperarStatus(res, 201);
      expect(res.body).toMatchObject({
        elemento: '9',
        nivel: 1,
        naturaleza: 'deudora',
      });
    });

    it('renombra y desactiva subcuentas propias; las oficiales no se tocan', async () => {
      const propia = (await cuenta(empresa, '104101')).cuenta;
      const ren = await api().patch(`/api/plan-contable/cuentas/${propia.id}`, {
        nombre: 'BCP soles',
      });
      esperarStatus(ren, 200);
      expect(ren.body.nombre).toBe('BCP soles');

      const hija = await api().post('/api/plan-contable/cuentas', {
        codigoPadre: '104101',
        codigo: '1041011',
        nombre: 'Subcuenta de prueba',
      });
      esperarStatus(hija, 201);
      // Con subcuentas activas no se desactiva
      expect(
        (
          await api().patch(`/api/plan-contable/cuentas/${propia.id}`, {
            activa: false,
          })
        ).status,
      ).toBe(400);
      esperarStatus(
        await api().patch(`/api/plan-contable/cuentas/${hija.body.id}`, {
          activa: false,
        }),
        200,
      );
      const des = await api().patch(`/api/plan-contable/cuentas/${propia.id}`, {
        activa: false,
      });
      expect(des.body).toMatchObject({ activa: false, imputable: false });
      // 1041 vuelve a recibir movimientos
      expect((await cuenta(empresa, '1041')).cuenta.imputable).toBe(true);

      const oficial = (await cuenta(empresa, '40111')).cuenta;
      expect(
        (
          await api().patch(`/api/plan-contable/cuentas/${oficial.id}`, {
            nombre: 'Nombre nuevo',
          })
        ).status,
      ).toBe(403);
      // Otra empresa no puede tocar la subcuenta
      expect(
        (
          await otra.api.patch(`/api/plan-contable/cuentas/${propia.id}`, {
            nombre: 'Nombre nuevo',
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('Cambio de plan', () => {
    it('cambia de plan si nada lo impide y vuelve al anterior', async () => {
      const planes = (await api().get('/api/plan-contable/planes')).body;
      expect(planes.length).toBeGreaterThanOrEqual(1);
      const idPcge = planes.find((p: any) => p.codigo === 'PCGE2019').id;

      // Plan alternativo de prueba
      const ds = app.get(DataSource);
      const [alt] = await ds.query(
        `INSERT INTO plan_contable (codigo, nombre, norma, codigo_sunat, vigente_desde)
         VALUES ('PRUEBA', 'Plan de prueba', 'Ninguna', '99', '2028-01-01') RETURNING id`,
      );
      const ok = await otra.api.put('/api/plan-contable', {
        idPlan: Number(alt.id),
      });
      esperarStatus(ok, 200);
      expect(ok.body.plan.codigo).toBe('PRUEBA');
      esperarStatus(
        await otra.api.put('/api/plan-contable', { idPlan: idPcge }),
        200,
      );
      await ds.query(`DELETE FROM plan_contable WHERE codigo = 'PRUEBA'`);
    });

    it('un usuario sin empresa no tiene plan', async () => {
      const admin = await crearAdmin(app);
      expect((await admin.get('/api/plan-contable')).status).toBe(403);
    });
  });
});
