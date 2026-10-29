import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from '../users/user.module';
import { CatalogoCcnu } from './ccnu.entity';
import { CcnuSeed } from './ccnu.seed';
import { CatalogosController } from './catalogos.controller';
import { CatalogosService } from './catalogos.service';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogoCcnu]), UserModule],
  controllers: [CatalogosController],
  providers: [CatalogosService, CcnuSeed],
  exports: [CatalogosService],
})
export class CatalogosModule {}
