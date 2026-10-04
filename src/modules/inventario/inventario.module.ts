import { ValoracionService } from './valoracion/valoracion.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inventario } from './entities/inventario.entity';
import { InventarioLote } from './entities/inventario-lote.entity';
import { Almacen } from '../almacen/entities/almacen.entity';
import { Producto } from '../productos/entities/producto.entity';
import { Movimiento } from '../movimientos/entities/movimiento.entity';
import { MovimientoDetalle } from '../movimientos/entities/movimiento-detalle.entity';
import { ComprobanteDetalle } from '../comprobantes/entities/comprobante-detalle';
import { TablaDetalle } from '../comprobantes/entities/tabla-detalle.entity';

import { InventarioService } from './service/inventario.service';
import { InventarioLoteService } from './service/inventario-lote.service';
import { LoteService } from './service/lote.service';
import { LoteCreationService } from './service/lote-creation.service';
import { StockCalculationService } from './service/stock-calculation.service';
import { StockCacheService } from './service/stock-cache.service';
import { KardexCalculationService } from './service/kardex-calculation.service';
import { KardexService } from './service/kardex.service';
import { CostoVentaService } from './service/costo-venta.service';
import { InventarioRepository } from './repository';
import { KardexRepository } from './repository/kardex.repository';
import { CostoVentaRepository } from './repository/costo-venta.repository';
import { InventarioController } from './controller/inventario.controller';
import { InventarioLoteController } from './controller/inventario-lote.controller';
import { LoteController } from './controller/lote.controller';
import { KardexController } from './controller/kardex.controller';
import { CostoVentaController } from './controller/costo-venta.controller';
import { ProductosModule } from '../productos/productos.module';
import { UserModule } from '../users/user.module';
import { PeriodosModule } from '../periodos/periodos.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Inventario,
      InventarioLote,
      Almacen,
      Producto,
      Movimiento,
      MovimientoDetalle,
      ComprobanteDetalle,
      TablaDetalle,
    ]),
    ProductosModule,
    UserModule,
    PeriodosModule,
  ],
  controllers: [
    InventarioController,
    InventarioLoteController,
    LoteController,
    KardexController,
    CostoVentaController,
  ],
  providers: [
    InventarioService,
    InventarioLoteService,
    LoteService,
    LoteCreationService,
    StockCalculationService,
    StockCacheService,
    KardexCalculationService,
    KardexService,
    CostoVentaService,
    InventarioRepository,
    KardexRepository,
    CostoVentaRepository,
    ValoracionService,
  ],
  exports: [
    InventarioService,
    InventarioLoteService,
    LoteService,
    LoteCreationService,
    StockCalculationService,
    StockCacheService,
    KardexCalculationService,
    KardexService,
    CostoVentaService,
    ValoracionService,
    TypeOrmModule,
  ],
})
export class InventarioModule {}
