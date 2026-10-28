import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComprobanteModule } from '../comprobantes/comprobante.module';
import { ProductosModule } from '../productos/productos.module';
import { InventarioModule } from '../inventario/inventario.module';
import { PeriodosModule } from '../periodos/periodos.module';
import { TipoCambioModule } from '../tipo-cambio/tipo-cambio.module';
import { UserModule } from '../users/user.module';
import { ReportesModule } from '../reportes/reportes.module';
import { PlantillaReporte } from './plantilla/plantilla.reporte';
import { EquivalenciaProducto } from './entities/equivalencia.entity';
import { ImportacionController } from './importacion.controller';
import { ImportacionService } from './importacion.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([EquivalenciaProducto]),
    ComprobanteModule,
    ProductosModule,
    InventarioModule,
    PeriodosModule,
    TipoCambioModule,
    UserModule,
    ReportesModule,
  ],
  controllers: [ImportacionController],
  providers: [ImportacionService, PlantillaReporte],
})
export class ImportacionModule {}
