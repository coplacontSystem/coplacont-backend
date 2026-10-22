import { Injectable } from '@nestjs/common';
import { ComprobanteDetalle } from '../entities/comprobante-detalle';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { CreateComprobanteDetalleDto } from '../dto/comprobante-detalle/create-comprobante-detalle.dto';
import { Comprobante } from '../entities/comprobante';
import { ComprobanteTotalesService } from './comprobante-totales.service';
import { Inventario } from 'src/modules/inventario/entities';

@Injectable()
export class ComprobanteDetalleService {
  constructor(
    @InjectRepository(ComprobanteDetalle)
    private readonly comprobanteDetalleRepository: Repository<ComprobanteDetalle>,
    @InjectRepository(Inventario)
    private readonly inventarioRepository: Repository<Inventario>,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepository: Repository<Comprobante>,
    private readonly comprobanteTotalesService: ComprobanteTotalesService,
  ) {}

  async register(
    idComprobante: number,
    createComprobanteDetalleDtos: CreateComprobanteDetalleDto[],
    manager?: EntityManager,
    cuentasPorCodigo: Map<string, number> = new Map(),
  ): Promise<ComprobanteDetalle[]> {
    // Usar el repositorio apropiado según si hay EntityManager
    const comprobanteRepo = manager
      ? manager.getRepository(Comprobante)
      : this.comprobanteRepository;
    const inventarioRepo = manager
      ? manager.getRepository(Inventario)
      : this.inventarioRepository;
    const detalleRepo = manager
      ? manager.getRepository(ComprobanteDetalle)
      : this.comprobanteDetalleRepository;

    // Cargar el comprobante completo desde la base de datos
    const comprobante = await comprobanteRepo.findOne({
      where: { idComprobante },
      relations: ['persona', 'entidad', 'periodoContable'],
    });

    if (!comprobante) {
      throw new Error(`Comprobante no encontrado: ${idComprobante}`);
    }

    const detalles = await Promise.all(
      createComprobanteDetalleDtos.map(async (dto) => {
        const detalle = detalleRepo.create(dto);
        detalle.comprobante = comprobante;
        detalle.tipoLinea = dto.tipoLinea ?? 'producto';
        if (dto.idArea)
          detalle.area = { id: dto.idArea } as ComprobanteDetalle['area'];

        if (detalle.tipoLinea === 'servicio') {
          // Gasto o ingreso sin inventario: cuenta contable ya validada
          detalle.inventario = null;
          detalle.cuentaContable = {
            id: cuentasPorCodigo.get(dto.codigoCuenta!),
          } as ComprobanteDetalle['cuentaContable'];
          detalle.descripcion = dto.descripcion || 'Servicio';
        } else if (dto.idInventario) {
          const inventario = await inventarioRepo.findOne({
            where: { id: dto.idInventario },
            relations: ['producto', 'almacen'],
          });

          if (!inventario) {
            throw new Error(`Inventario no encontrado: ${dto.idInventario}`);
          }

          detalle.inventario = inventario;

          // Validar que el inventario tenga producto y almacén
          if (!inventario.producto) {
            throw new Error(
              `El inventario ${dto.idInventario} no tiene un producto asociado`,
            );
          }
          if (!inventario.almacen) {
            throw new Error(
              `El inventario ${dto.idInventario} no tiene un almacén asociado`,
            );
          }
        } else {
          throw new Error('Cada detalle debe tener un inventario asociado');
        }
        return detalle;
      }),
    );

    const detallesSaved = await detalleRepo.save(detalles);

    await this.comprobanteTotalesService.register(
      idComprobante,
      detallesSaved,
      manager,
    );

    return detallesSaved;
  }
}
