import { Module } from '@nestjs/common';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { TypeOrmModule } from '@nestjs/typeorm';

// Entities
import { Producto } from './entities';
import { Almacen } from '../almacen/entities/almacen.entity';
import { Categoria } from '../categoria/entities';
// Services
import { ProductoService } from './service';

// Controllers
import { ProductoController } from './controller';
import { UserModule } from '../users/user.module';

/**
 * Módulo de productos y almacenes
 * Gestiona las operaciones CRUD para productos, categorías y almacenes
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Producto, Almacen, Categoria]),
    UserModule, // Importar UserModule para JwtAuthGuard, JwtService y UserService
    CatalogosModule,
  ],
  controllers: [ProductoController],
  providers: [ProductoService],
  exports: [ProductoService],
})
export class ProductosModule {}
