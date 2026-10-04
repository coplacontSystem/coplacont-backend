import { Global, Module } from '@nestjs/common';
import { PertenenciaService } from './pertenencia.service';

@Global()
@Module({
  providers: [PertenenciaService],
  exports: [PertenenciaService],
})
export class CommonModule {}
