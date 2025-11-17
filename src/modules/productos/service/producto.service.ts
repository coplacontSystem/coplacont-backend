import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { plainToClass } from 'class-transformer';
import { Producto } from '../entities/producto.entity';
import { Categoria } from 'src/modules/categoria/entities';
import {
  CreateProductoDto,
  UpdateProductoDto,
  ResponseProductoDto,
} from '../dto';
import { TipoProducto } from '../enum/tipo-producto.enum';
import { TipoCategoria } from '../../categoria/enum/tipo-categoria.enum';

/**
 * Servicio para gestionar las operaciones CRUD de productos
 * Maneja la lógica de negocio relacionada con los productos
 */
@Injectable()
export class ProductoService {
  constructor(
    @InjectRepository(Producto)
    private readonly productoRepository: Repository<Producto>,
    @InjectRepository(Categoria)
    private readonly categoriaRepository: Repository<Categoria>,
  ) {}

  /**
   * Crear un nuevo producto
   * @param createProductoDto - Datos para crear el producto
   * @param personaId - ID de la persona/empresa propietaria
   * @returns Promise<ResponseProductoDto> - Producto creado
   */
  async create(
    createProductoDto: CreateProductoDto,
    personaId: number,
  ): Promise<ResponseProductoDto> {
    // Verificar que la categoría existe, está activa y pertenece a la misma empresa
    const categoria = await this.categoriaRepository.findOne({
      where: {
        id: createProductoDto.idCategoria,
        estado: true,
        persona: { id: personaId },
      },
      relations: ['persona'],
    });

    if (!categoria) {
      throw new BadRequestException(
        'La categoría especificada no existe, está inactiva o no pertenece a su empresa',
      );
    }

    let codigo = createProductoDto.codigo;

    // Autogenerar código si no se proporciona
    if (!codigo) {
      codigo = await this.generateProductCode(
        categoria.nombre,
        categoria.tipo,
        personaId,
      );
    } else {
      const existingProducto = await this.productoRepository.findOne({
        where: { codigo },
      });

      if (existingProducto) {
        throw new ConflictException('Ya existe un producto con este código');
      }
    }

    // Crear nuevo producto
    const producto = this.productoRepository.create({
      ...createProductoDto,
      codigo,
      categoria,
      persona: { id: personaId },
      estado: createProductoDto.estado ?? true,
      stockMinimo: createProductoDto.stockMinimo ?? 0,
    });

    const savedProducto = await this.productoRepository.save(producto);

    // Cargar el producto con la relación de categoría
    const productoWithCategoria = await this.productoRepository.findOne({
      where: { id: savedProducto.id },
      relations: ['categoria', 'persona'],
    });

    return plainToClass(ResponseProductoDto, productoWithCategoria, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Obtener todos los productos de una empresa
   * @param personaId - ID de la persona/empresa
   * @param includeInactive - Incluir productos inactivos (opcional)
   * @param tipo - Filtrar por tipo de ítem (PRODUCTO | SERVICIO)
   * @returns Promise<ResponseProductoDto[]> - Lista de productos
   */
  async findAll(
    personaId: number,
    includeInactive: boolean = false,
    tipo?: TipoProducto,
  ): Promise<ResponseProductoDto[]> {
    const queryBuilder = this.productoRepository
      .createQueryBuilder('producto')
      .leftJoinAndSelect('producto.categoria', 'categoria')
      .leftJoin('producto.persona', 'persona')
      .where('persona.id = :personaId', { personaId });

    if (!includeInactive) {
      queryBuilder.andWhere('producto.estado = :estado', { estado: true });
    }

    if (tipo) {
      queryBuilder.andWhere('producto.tipo = :tipo', { tipo });
    }

    queryBuilder.orderBy('producto.descripcion', 'ASC');

    const productos = await queryBuilder.getMany();
    return productos.map((producto) =>
      plainToClass(ResponseProductoDto, producto, {
        excludeExtraneousValues: true,
      }),
    );
  }

  /**
   * Obtener un producto por ID de una empresa específica
   * @param id - ID del producto
   * @param personaId - ID de la persona/empresa
   * @returns Promise<ResponseProductoDto> - Producto encontrado
   */
  async findOne(id: number, personaId: number): Promise<ResponseProductoDto> {
    const producto = await this.productoRepository.findOne({
      where: {
        id,
        persona: { id: personaId },
      },
      relations: ['categoria', 'persona'],
    });

    if (!producto) {
      throw new NotFoundException(
        `Producto con ID ${id} no encontrado o no pertenece a su empresa`,
      );
    }

    return plainToClass(ResponseProductoDto, producto, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Actualizar un producto de una empresa específica
   * @param id - ID del producto a actualizar
   * @param updateProductoDto - Datos para actualizar
   * @param personaId - ID de la persona/empresa
   * @returns Promise<ResponseProductoDto> - Producto actualizado
   */
  async update(
    id: number,
    updateProductoDto: UpdateProductoDto,
    personaId: number,
  ): Promise<ResponseProductoDto> {
    const producto = await this.productoRepository.findOne({
      where: {
        id,
        persona: { id: personaId },
      },
      relations: ['categoria', 'persona'],
    });

    if (!producto) {
      throw new NotFoundException(
        `Producto con ID ${id} no encontrado o no pertenece a su empresa`,
      );
    }

    // Verificar la categoría si se está cambiando
    if (
      updateProductoDto.idCategoria &&
      updateProductoDto.idCategoria !== producto.categoria.id
    ) {
      const categoria = await this.categoriaRepository.findOne({
        where: {
          id: updateProductoDto.idCategoria,
          estado: true,
          persona: { id: personaId },
        },
        relations: ['persona'],
      });

      if (!categoria) {
        throw new BadRequestException(
          'La categoría especificada no existe, está inactiva o no pertenece a su empresa',
        );
      }

      producto.categoria = categoria;
    }

    // Verificar si el nuevo código ya existe (si se está cambiando)
    if (
      updateProductoDto.codigo &&
      updateProductoDto.codigo !== producto.codigo
    ) {
      const existingProducto = await this.productoRepository.findOne({
        where: {
          codigo: updateProductoDto.codigo,
          persona: { id: personaId },
        },
      });

      if (existingProducto) {
        throw new ConflictException(
          'Ya existe un producto con este código en su empresa',
        );
      }
    }

    // Actualizar producto (excluyendo idCategoria ya que se maneja por separado)
    const updateData = { ...updateProductoDto } as Record<string, unknown>;
    delete (updateData as { idCategoria?: unknown }).idCategoria;
    Object.assign(producto, updateData);

    const updatedProducto = await this.productoRepository.save(producto);

    // Recargar con relaciones
    const productoWithCategoria = await this.productoRepository.findOne({
      where: { id: updatedProducto.id },
      relations: ['categoria', 'persona'],
    });

    return plainToClass(ResponseProductoDto, productoWithCategoria, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Eliminar un producto (soft delete) de una empresa específica
   * @param id - ID del producto a eliminar
   * @param personaId - ID de la persona/empresa
   * @returns Promise<void>
   */
  async remove(id: number, personaId: number): Promise<void> {
    const producto = await this.productoRepository.findOne({
      where: {
        id,
        persona: { id: personaId },
      },
    });

    if (!producto) {
      throw new NotFoundException(
        `Producto con ID ${id} no encontrado o no pertenece a su empresa`,
      );
    }

    // Soft delete - cambiar estado a false
    producto.estado = false;
    await this.productoRepository.save(producto);
  }

  /**
   * Buscar productos por descripción en una empresa específica
   * @param descripcion - Descripción a buscar
   * @param personaId - ID de la persona/empresa
   * @param tipo - Filtrar por tipo de ítem (PRODUCTO | SERVICIO)
   * @returns Promise<ResponseProductoDto[]> - Productos encontrados
   */
  async findByDescription(
    descripcion: string,
    personaId: number,
    tipo?: TipoProducto,
  ): Promise<ResponseProductoDto[]> {
    const queryBuilder = this.productoRepository
      .createQueryBuilder('producto')
      .leftJoinAndSelect('producto.categoria', 'categoria')
      .leftJoin('producto.persona', 'persona')
      .where('producto.descripcion ILIKE :descripcion', {
        descripcion: `%${descripcion}%`,
      })
      .andWhere('producto.estado = :estado', { estado: true })
      .andWhere('persona.id = :personaId', { personaId });

    if (tipo) {
      queryBuilder.andWhere('producto.tipo = :tipo', { tipo });
    }

    const productos = await queryBuilder
      .orderBy('producto.descripcion', 'ASC')
      .getMany();

    return productos.map((producto) =>
      plainToClass(ResponseProductoDto, producto, {
        excludeExtraneousValues: true,
      }),
    );
  }

  /**
   * Buscar productos por nombre en una empresa específica
   * @param nombre - Nombre a buscar
   * @param personaId - ID de la persona/empresa
   * @param tipo - Filtrar por tipo de ítem (PRODUCTO | SERVICIO)
   * @returns Promise<ResponseProductoDto[]> - Productos encontrados
   */
  async findByName(
    nombre: string,
    personaId: number,
    tipo?: TipoProducto,
  ): Promise<ResponseProductoDto[]> {
    const queryBuilder = this.productoRepository
      .createQueryBuilder('producto')
      .leftJoinAndSelect('producto.categoria', 'categoria')
      .leftJoin('producto.persona', 'persona')
      .where('producto.nombre IS NOT NULL')
      .andWhere('producto.nombre ILIKE :nombre', { nombre: `%${nombre}%` })
      .andWhere('producto.estado = :estado', { estado: true })
      .andWhere('persona.id = :personaId', { personaId });

    if (tipo) {
      queryBuilder.andWhere('producto.tipo = :tipo', { tipo });
    }

    const productos = await queryBuilder
      .orderBy('producto.nombre', 'ASC')
      .getMany();

    return productos.map((producto) =>
      plainToClass(ResponseProductoDto, producto, {
        excludeExtraneousValues: true,
      }),
    );
  }

  /**
   * Buscar productos por categoría en una empresa específica
   * @param categoriaId - ID de la categoría
   * @param personaId - ID de la persona/empresa
   * @param tipo - Filtrar por tipo de ítem (PRODUCTO | SERVICIO)
   * @returns Promise<ResponseProductoDto[]> - Productos de la categoría
   */
  async findByCategory(
    categoriaId: number,
    personaId: number,
    tipo?: TipoProducto,
  ): Promise<ResponseProductoDto[]> {
    const queryBuilder = this.productoRepository
      .createQueryBuilder('producto')
      .leftJoinAndSelect('producto.categoria', 'categoria')
      .leftJoin('producto.persona', 'persona')
      .where('categoria.id = :categoriaId', { categoriaId })
      .andWhere('producto.estado = :estado', { estado: true })
      .andWhere('persona.id = :personaId', { personaId });

    if (tipo) {
      queryBuilder.andWhere('producto.tipo = :tipo', { tipo });
    }

    const productos = await queryBuilder
      .orderBy('producto.descripcion', 'ASC')
      .getMany();

    return productos.map((producto) =>
      plainToClass(ResponseProductoDto, producto, {
        excludeExtraneousValues: true,
      }),
    );
  }

  /**
   * Buscar productos con stock bajo en una empresa específica
   * @param personaId - ID de la persona/empresa
   * @param tipo - Filtrar por tipo de ítem (PRODUCTO | SERVICIO)
   * @returns Promise<ResponseProductoDto[]> - Productos con stock bajo
   */
  async findLowStock(
    personaId: number,
    tipo?: TipoProducto,
  ): Promise<ResponseProductoDto[]> {
    const queryBuilder = this.productoRepository
      .createQueryBuilder('producto')
      .leftJoinAndSelect('producto.categoria', 'categoria')
      .leftJoin('producto.persona', 'persona')
      .where('producto.stockMinimo > 0')
      .andWhere('producto.estado = :estado', { estado: true })
      .andWhere('persona.id = :personaId', { personaId });

    if (tipo) {
      queryBuilder.andWhere('producto.tipo = :tipo', { tipo });
    }

    const productos = await queryBuilder
      .orderBy('producto.descripcion', 'ASC')
      .getMany();

    return productos.map((producto) =>
      plainToClass(ResponseProductoDto, producto, {
        excludeExtraneousValues: true,
      }),
    );
  }

  /**
   * Genera un código único para el producto
   * Formato: [PREFIJO_CATEGORIA]-[TIPO]-[NUMERO_SECUENCIAL]
   * @param categoriaNombre - Nombre de la categoría
   * @param tipo - Tipo de categoría
   * @param personaId - ID de la persona/empresa
   */
  private async generateProductCode(
    categoriaNombre: string,
    tipo: TipoCategoria,
    personaId: number,
  ): Promise<string> {
    // Crear prefijo de categoría (primeras 3 letras en mayúsculas)
    const categoriaPrefix = categoriaNombre
      .replace(/[^a-zA-Z]/g, '') // Remover caracteres especiales
      .substring(0, 3)
      .toUpperCase()
      .padEnd(3, 'X'); // Rellenar con X si es menor a 3 caracteres

    // Prefijo de tipo
    const tipoPrefix = tipo === TipoCategoria.PRODUCTO ? 'PROD' : 'SERV';

    const lastProduct = await this.productoRepository
      .createQueryBuilder('producto')
      .leftJoin('producto.persona', 'persona')
      .where('producto.codigo LIKE :pattern', {
        pattern: `${categoriaPrefix}-${tipoPrefix}-%`,
      })
      .andWhere('persona.id = :personaId', { personaId })
      .orderBy('producto.codigo', 'DESC')
      .getOne();

    let nextNumber = 1;
    if (lastProduct && lastProduct.codigo) {
      const match = lastProduct.codigo.match(/-([0-9]+)$/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    for (let attempts = 0; attempts < 10000; attempts++) {
      const formattedNumber = nextNumber.toString().padStart(4, '0');
      const candidate = `${categoriaPrefix}-${tipoPrefix}-${formattedNumber}`;
      const exists = await this.productoRepository.findOne({
        where: { codigo: candidate },
      });
      if (!exists) {
        return candidate;
      }
      nextNumber++;
    }

    const formattedNumber = nextNumber.toString().padStart(4, '0');
    return `${categoriaPrefix}-${tipoPrefix}-${formattedNumber}`;
  }
}
