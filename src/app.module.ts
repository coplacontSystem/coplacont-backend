import { CommonModule } from './common/common.module';
import { ReportesModule } from './modules/reportes/reportes.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './modules/users/user.module';
import { EntidadModule } from './modules/entidades/entidad.module';
import { AlmacenModule } from './modules/almacen/almacen.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriaModule } from './modules/categoria/categoria.module';
import { databaseConfig } from './config/database.config';
import { ConfigModule } from '@nestjs/config';
import { ComprobanteController } from './modules/comprobantes/controller/comprobante.controller';
import { ComprobanteModule } from './modules/comprobantes/comprobante.module';
import { TablaModule } from './modules/comprobantes/tabla.module';
import { ProductosModule } from './modules/productos/productos.module';
import { TipoCambioModule } from './modules/tipo-cambio/tipo-cambio.module';
import { MovimientosModule } from './modules/movimientos/movimientos.module';
import { InventarioModule } from './modules/inventario/inventario.module';
import { PeriodosModule } from './modules/periodos/periodos.module';
import { DatabaseSeedService } from './config/database-seed.service';
import { Role } from './modules/users/entities/role.entity';
import { User } from './modules/users/entities/user.entity';
import { UserRole } from './modules/users/entities/user-role.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Conexión global a la base de datos
    TypeOrmModule.forRoot(databaseConfig),

    // TypeORM para el servicio de seed
    TypeOrmModule.forFeature([Role, User, UserRole]),

    // Servicios transversales (verificación de pertenencia por empresa)
    CommonModule,

    // Módulos funcionales
    UserModule,
    EntidadModule,
    ComprobanteModule,
    TablaModule,
    ProductosModule,
    CategoriaModule,
    AlmacenModule,
    TipoCambioModule,
    MovimientosModule,
    InventarioModule,
    PeriodosModule,
    ReportesModule,
  ],
  controllers: [AppController, ComprobanteController],
  providers: [AppService, DatabaseSeedService],
})
export class AppModule {}
