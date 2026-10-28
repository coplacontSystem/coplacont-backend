import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { DataSource } from 'typeorm';

type FilaCcnu = [
  codigo: string,
  nombre: string,
  nivel: number,
  padre: string | null,
];

/** Carga el catálogo CCNU (UNSPSC v14) una sola vez; es idempotente */
@Injectable()
export class CcnuSeed implements OnModuleInit {
  private readonly logger = new Logger(CcnuSeed.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit() {
    const datos = JSON.parse(
      gunzipSync(
        readFileSync(join(__dirname, 'data', 'ccnu-v14.json.gz')),
      ).toString('utf8'),
    ) as { filas: FilaCcnu[] };
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM catalogo_ccnu`,
    );
    if (n >= datos.filas.length) return;

    const LOTE = 2000;
    for (let i = 0; i < datos.filas.length; i += LOTE) {
      const lote = datos.filas.slice(i, i + LOTE);
      await this.dataSource.query(
        `INSERT INTO catalogo_ccnu (codigo, nombre, nivel, codigo_padre)
         SELECT * FROM unnest($1::varchar[], $2::varchar[], $3::smallint[], $4::varchar[])
         ON CONFLICT (codigo) DO NOTHING`,
        [
          lote.map((f) => f[0]),
          lote.map((f) => f[1]),
          lote.map((f) => f[2]),
          lote.map((f) => f[3]),
        ],
      );
    }
    this.logger.log(`Catálogo CCNU cargado: ${datos.filas.length} códigos`);
  }
}
