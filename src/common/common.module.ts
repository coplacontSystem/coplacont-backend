import { Global, Module } from '@nestjs/common';
import { PertenenciaService } from './pertenencia.service';
import { CatalogoService } from './catalogo.service';

@Global()
@Module({
  providers: [PertenenciaService, CatalogoService],
  exports: [PertenenciaService, CatalogoService],
})
export class CommonModule {}
