import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/app';
import { crearEmpresa, Empresa, esperarStatus } from './support/api';
import {
  comprar,
  crearInventario,
  Escenario,
  prepararEmpresa,
  vender,
} from './support/escenario';

/**
 * Benchmark de kardex e inventario. No corre por defecto:
 *   BENCH=1 npm run test:e2e -- rendimiento
 * Tamaño configurable con BENCH_PRODUCTOS y BENCH_OPERACIONES (compras y ventas por producto).
 */
const activo = process.env.BENCH === '1';
const PRODUCTOS = Number(process.env.BENCH_PRODUCTOS ?? 25);
const OPERACIONES = Number(process.env.BENCH_OPERACIONES ?? 12);

(activo ? describe : describe.skip)('Rendimiento (benchmark)', () => {
  let app: INestApplication;
  let empresa: Empresa;
  let esc: Escenario;
  const inventarios: number[] = [];
  let consultas = 0;

  beforeAll(async () => {
    app = await createTestApp();
    empresa = await crearEmpresa(app, 'Empresa Benchmark');
    esc = await prepararEmpresa(empresa, 'fifo');

    for (let p = 0; p < PRODUCTOS; p++) {
      const inv = await crearInventario(empresa.api, esc);
      inventarios.push(inv);
      for (let i = 0; i < OPERACIONES; i++) {
        const dia = String(1 + (i % 27)).padStart(2, '0');
        const mes = String(1 + Math.floor(i / 27) + 1).padStart(2, '0');
        esperarStatus(
          await comprar(empresa.api, esc, `2026-${mes}-${dia}`, [
            { idInventario: inv, cantidad: 10, precio: 10 + i },
          ]),
          201,
        );
        esperarStatus(
          await vender(empresa.api, esc, `2026-${mes}-${dia}`, [
            { idInventario: inv, cantidad: 7, precio: 40 },
          ]),
          201,
        );
      }
    }

    // Cuenta las consultas SQL que hace cada endpoint
    const ds = app.get(DataSource);
    const original = ds.driver.createQueryRunner.bind(ds.driver);
    ds.driver.createQueryRunner = (mode) => {
      const qr = original(mode);
      const query = qr.query.bind(qr);
      qr.query = async (...args: Parameters<typeof qr.query>) => {
        consultas++;
        const t0 = performance.now();
        const r = await query(...args);
        const ms = performance.now() - t0;
        // BENCH_LENTAS=<ms>: muestra las consultas más lentas que ese umbral
        if (process.env.BENCH_LENTAS && ms > Number(process.env.BENCH_LENTAS)) {
          console.log(
            `[LENTA] ${ms.toFixed(1)} ms ${String(args[0]).replace(/\s+/g, ' ').slice(0, 120)}`,
          );
        }
        return r;
      };
      return qr;
    };
  }, 600_000);

  afterAll(async () => {
    await app?.close();
  });

  async function medir(nombre: string, fn: () => Promise<{ status: number }>) {
    // Una pasada para calentar y tres medidas
    await fn();
    const tiempos: number[] = [];
    let q = 0;
    for (let i = 0; i < 3; i++) {
      consultas = 0;
      const t0 = performance.now();
      const res = await fn();
      tiempos.push(performance.now() - t0);
      q = consultas;
      expect(res.status).toBe(200);
    }
    tiempos.sort((a, b) => a - b);
    console.log(
      `[BENCH] ${nombre}: ${tiempos[1].toFixed(0)} ms (mediana), ${q} consultas SQL`,
    );
  }

  it('mide inventario, kardex y costo de ventas', async () => {
    console.log(
      `[BENCH] Datos: ${PRODUCTOS} productos × ${OPERACIONES} compras y ${OPERACIONES} ventas`,
    );
    await medir('GET /api/inventario', () =>
      empresa.api.get('/api/inventario'),
    );
    await medir('GET /api/inventario/:id', () =>
      empresa.api.get(`/api/inventario/${inventarios[0]}`),
    );
    await medir('GET /api/kardex (un producto, año)', () =>
      empresa.api.get(
        `/api/kardex?idInventario=${inventarios[0]}&fechaInicio=2026-01-01&fechaFin=2026-12-31`,
      ),
    );
    await medir('GET /api/kardex (desde junio: saldo inicial)', () =>
      empresa.api.get(
        `/api/kardex?idInventario=${inventarios[0]}&fechaInicio=2026-06-01&fechaFin=2026-12-31`,
      ),
    );
    await medir('GET /api/costo-venta/reporte', () =>
      empresa.api.get('/api/costo-venta/reporte?año=2026'),
    );
    await medir('POST venta (registro)', async () => {
      const res = await vender(empresa.api, esc, '2026-12-01', [
        { idInventario: inventarios[1], cantidad: 1, precio: 40 },
      ]);
      return { status: res.status === 201 ? 200 : res.status };
    });
  }, 600_000);
});
