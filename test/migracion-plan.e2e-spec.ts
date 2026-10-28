import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus, idOf } from './support/api';
import {
  comprar,
  crearInventario,
  Escenario,
  prepararEmpresa,
} from './support/escenario';

describe('Cambio de plan PCGE 2019 → 2026 desde un período (e2e)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let esc: Escenario;
  let ds: DataSource;
  let idPcge2026: number;
  let idPcge2019: number;
  let periodo2026: number;
  let periodo2027: number;
  let compra2026: number;
  const api = () => empresa.api;

  /** Códigos de las líneas de un asiento */
  const lineasDe = async (where: string, params: unknown[]) =>
    (
      await ds.query(
        `SELECT c.codigo, c.id_plan FROM asiento_linea l
           JOIN asiento_contable a ON a.id = l.id_asiento
           JOIN cuenta_contable c ON c.id = l.id_cuenta
          WHERE ${where} ORDER BY l.orden`,
        params,
      )
    ).map((f: any) => [f.codigo, Number(f.id_plan)]);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    empresa = await crearEmpresa(app, 'Empresa Cambio Plan');
    esc = await prepararEmpresa(empresa, 'promedio');
    const planes = (await api().get('/api/plan-contable/planes')).body;
    idPcge2019 = planes.find((p: any) => p.codigo === 'PCGE2019').id;
    idPcge2026 = planes.find((p: any) => p.codigo === 'PCGE2026').id;

    // Período 2026 (del escenario) y un 2027
    const [p26] = await ds.query(
      `SELECT id FROM periodo_contable WHERE id_persona = $1 AND "año" = 2026`,
      [empresa.personaId],
    );
    periodo2026 = Number(p26.id);
    const [p27] = await ds.query(
      `INSERT INTO periodo_contable ("año", "fechaInicio", "fechaFin", activo, cerrado, id_persona)
       VALUES (2027, '2027-01-01', '2027-12-31', false, false, $1) RETURNING id`,
      [empresa.personaId],
    );
    periodo2027 = Number(p27.id);

    // 2026: una compra (asiento automático); áreas por defecto (94, 95, 92 propias)
    await api().get('/api/areas');
    const inv = await crearInventario(api(), esc);
    const compra = await comprar(api(), esc, '2026-05-03', [
      { idInventario: inv, cantidad: 10, precio: 5 },
    ]);
    esperarStatus(compra, 201);
    compra2026 = idOf(compra.body);

    // Subcuenta propia y un asiento de 2027 con cuentas que cambian
    esperarStatus(
      await api().post('/api/plan-contable/cuentas', {
        codigoPadre: '1041',
        codigo: '10411',
        nombre: 'Banco Ejemplo',
      }),
      201,
    );
    esperarStatus(
      await api().post('/api/asientos', {
        fecha: '2027-01-15',
        glosa: 'Devolución y cuenta de orden',
        lineas: [
          { codigoCuenta: '70921', debe: 100, haber: 0 },
          { codigoCuenta: '01', debe: 50, haber: 0 },
          { codigoCuenta: '10411', debe: 0, haber: 150 },
        ],
      }),
      201,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const cambio = { idPlan: 0, idPeriodoDesde: 0 };

  it('previsualiza: qué pasa, qué se traslada y qué lo impide', async () => {
    Object.assign(cambio, { idPlan: idPcge2026, idPeriodoDesde: periodo2027 });
    const res = await api().post(
      '/api/plan-contable/cambio/previsualizar',
      cambio,
    );
    esperarStatus(res, 200);
    const inf = res.body;
    expect(inf.periodos).toEqual([
      { id: periodo2026, año: 2026, pasa: false },
      { id: periodo2027, año: 2027, pasa: true },
    ]);
    const usada = (c: string) =>
      inf.cuentasUsadas.find((u: any) => u.codigo === c);
    // 70921 cambia de significado: va a la 70911 del 2026
    expect(usada('70921')).toMatchObject({ destino: '70911', problema: null });
    expect(usada('10411')).toMatchObject({ destino: '10411', problema: null });
    // La cuenta de orden 01 no existe en 2026: bloquea hasta reasignarla
    expect(usada('01').problema).toMatch(/sin cuenta equivalente/i);
    expect(inf.errores.join()).toMatch(/Cuenta 01/);
    // La 92 propia choca con la 92 oficial de 2026: Producción queda sin destino
    expect(inf.areas.find((a: any) => a.nombre === 'Producción')).toMatchObject(
      {
        actual: '92',
        nuevo: null,
      },
    );
    expect(inf.avisos.join()).toMatch(
      /Producción quedará sin cuenta de destino/,
    );

    expect((await api().put('/api/plan-contable', cambio)).status).toBe(400);
  });

  it('migra con la reasignación y conserva el pasado', async () => {
    const res = await api().put('/api/plan-contable', {
      ...cambio,
      reasignar: { '01': '1121' },
    });
    esperarStatus(res, 200);
    expect(res.body.plan.codigo).toBe('PCGE2026');

    const periodos = await ds.query(
      `SELECT "año", id_plan FROM periodo_contable WHERE id_persona = $1 ORDER BY "año"`,
      [empresa.personaId],
    );
    expect(periodos.map((p: any) => [p.año, Number(p.id_plan)])).toEqual([
      [2026, idPcge2019],
      [2027, idPcge2026],
    ]);

    // 2027: las líneas pasan a las cuentas del plan nuevo
    expect(
      await lineasDe(`a.id_persona = $1 AND a.fecha = '2027-01-15'`, [
        empresa.personaId,
      ]),
    ).toEqual([
      ['70911', idPcge2026],
      ['1121', idPcge2026],
      ['10411', idPcge2026],
    ]);
    // 2026: el asiento de la compra sigue en el PCGE 2019
    const compra = await lineasDe(`a.id_comprobante = $1`, [compra2026]);
    expect(
      compra.every(([, plan]: [string, number]) => plan === idPcge2019),
    ).toBe(true);

    const areas = (await api().get('/api/areas')).body;
    expect(
      areas.find((a: any) => a.nombre === 'Administración').cuentaDestino,
    ).toBe('94');
    expect(
      areas.find((a: any) => a.nombre === 'Producción').cuentaDestino,
    ).toBeNull();
  });

  it('cada período valida sus asientos con su propio plan', async () => {
    // 2026 sigue con el PCGE 2019 (70921 = devolución de mercaderías)
    esperarStatus(
      await api().post('/api/asientos', {
        fecha: '2026-06-01',
        glosa: 'Asiento en 2026',
        lineas: [
          { codigoCuenta: '70921', debe: 10, haber: 0 },
          { codigoCuenta: '10411', debe: 0, haber: 10 },
        ],
      }),
      201,
    );
    // 2027 usa el PCGE 2026: la subcuenta propia nueva y la 70911
    esperarStatus(
      await api().post('/api/asientos', {
        fecha: '2027-02-01',
        glosa: 'Asiento en 2027',
        lineas: [
          { codigoCuenta: '70911', debe: 10, haber: 0 },
          { codigoCuenta: '10411', debe: 0, haber: 10 },
        ],
      }),
      201,
    );
    const libro = await api().get('/api/libros/diario?año=2027&mes=1');
    esperarStatus(libro, 200);
    expect(libro.body.totalDebe).toBe(150);
  });
});
