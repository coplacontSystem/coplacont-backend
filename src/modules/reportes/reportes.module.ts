import { Module } from '@nestjs/common';
import { UserModule } from '../users/user.module';
import { ReportesController } from './reportes.controller';
import { ReportesService } from './reportes.service';

/**
 * Exportación centralizada de reportes (CSV, XLSX, PDF). Los módulos que
 * tienen reportes importan este módulo y registran sus generadores al iniciar.
 */
@Module({
  // JwtAuthGuard necesita JwtService y UserService
  imports: [UserModule],
  controllers: [ReportesController],
  providers: [ReportesService],
  exports: [ReportesService],
})
export class ReportesModule {}
