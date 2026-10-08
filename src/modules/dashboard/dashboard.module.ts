import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module';
import { UserModule } from '../users/user.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Portada: indicadores de la empresa en una sola llamada. */
@Module({
  // JwtAuthGuard necesita JwtService y UserService
  imports: [UserModule, InventarioModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
