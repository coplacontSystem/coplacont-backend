import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  autoLoadEntities: true,
  // Sincroniza el esquema con las entidades. Desactivar en producción con
  // DB_SYNCHRONIZE=false una vez existan migraciones.
  synchronize: process.env.DB_SYNCHRONIZE !== 'false',
  //dropSchema:true,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
};
