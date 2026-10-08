import { Api, Empresa, esperarStatus, idOf } from './api';

let correlativoDoc = 1000;

/** Id de un detalle de catálogo por tabla + código. */
export async function detalleCatalogo(api: Api, tabla: number, codigo: string) {
  const res = await api.get(`/api/tablas/${tabla}/detalles/${codigo}`);
  if (!res.body?.idTablaDetalle) {
    throw new Error(`No existe el código ${codigo} en la tabla ${tabla}`);
  }
  return Number(res.body.idTablaDetalle);
}

/** Ids de catálogo resueltos por tabla + código (no dependen del orden del seed). */
export async function catalogo(api: Api) {
  const detalle = (tabla: number, codigo: string) =>
    detalleCatalogo(api, tabla, codigo);
  return {
    venta: await detalle(12, '01'),
    compra: await detalle(12, '02'),
    factura: await detalle(10, '01'),
  };
}

export type Metodo = 'fifo' | 'promedio';

/** Prepara período 2026, método de valoración, almacén, proveedor y cliente. */
export async function prepararEmpresa(empresa: Empresa, metodo: Metodo) {
  const { api, personaId } = empresa;

  const periodo = await api.post('/api/periodos-contables', {
    año: 2026,
    fechaInicio: '2026-01-01',
    fechaFin: '2026-12-31',
    idPersona: personaId,
  });
  esperarStatus(periodo, 201);

  const cfg = await api.put(
    '/api/periodos-contables/configuracion/metodo-valoracion',
    {
      metodoValoracion: metodo,
    },
  );
  esperarStatus(cfg, 200);

  const almacen = await api.post('/api/almacenes', {
    nombre: 'Almacén Central',
    ubicacion: 'Av. Industrial 123, Lima',
  });
  esperarStatus(almacen, 201);

  const categoria = await api.post('/api/categorias', {
    nombre: 'Abarrotes',
    tipo: 'producto',
  });
  esperarStatus(categoria, 201);

  correlativoDoc += 1;
  const proveedor = await api.post('/api/entidades', {
    esProveedor: true,
    esCliente: false,
    tipo: 'JURIDICA',
    numeroDocumento: `20${String(correlativoDoc).padStart(9, '0')}`,
    razonSocial: 'Proveedor de Pruebas S.A.C.',
    direccion: 'Av. Proveedores 456, Lima',
  });
  esperarStatus(proveedor, 201);

  correlativoDoc += 1;
  const cliente = await api.post('/api/entidades', {
    esProveedor: false,
    esCliente: true,
    tipo: 'JURIDICA',
    numeroDocumento: `20${String(correlativoDoc).padStart(9, '0')}`,
    razonSocial: 'Cliente de Pruebas S.A.C.',
    direccion: 'Av. Clientes 789, Lima',
  });
  esperarStatus(cliente, 201);

  return {
    ...(await catalogo(api)),
    notaCredito: await detalleCatalogo(api, 10, '07'),
    idAlmacen: idOf(almacen.body),
    idCategoria: idOf(categoria.body),
    idProveedor: idOf(proveedor.body),
    idCliente: idOf(cliente.body),
  };
}

export type Escenario = Awaited<ReturnType<typeof prepararEmpresa>>;

// Base distinta por archivo de test: hoy el código de producto es único global
let codigoProducto = Number(String(Date.now()).slice(-6)) * 100;

/** Crea un producto y su inventario en el almacén indicado (por defecto el del escenario). */
export async function crearProductoEInventario(
  api: Api,
  esc: Escenario,
  idAlmacen = esc.idAlmacen,
): Promise<{ idProducto: number; idInventario: number }> {
  codigoProducto += 1;
  const producto = await api.post('/api/productos', {
    idCategoria: esc.idCategoria,
    tipo: 'producto',
    nombre: `Producto ${codigoProducto}`,
    descripcion: `Producto de prueba ${codigoProducto}`,
    unidadMedida: 'unidad',
    codigo: `TST-${codigoProducto}`,
  });
  esperarStatus(producto, 201);
  const idProducto = idOf(producto.body);
  return {
    idProducto,
    idInventario: await crearInventarioDe(api, idAlmacen, idProducto),
  };
}

/** Crea el inventario de un producto existente en un almacén. */
export async function crearInventarioDe(
  api: Api,
  idAlmacen: number,
  idProducto: number,
): Promise<number> {
  const inventario = await api.post('/api/inventario', {
    idAlmacen,
    idProducto,
  });
  esperarStatus(inventario, 201);
  return idOf(inventario.body);
}

/** Crea un producto y su inventario en el almacén del escenario. */
export async function crearInventario(
  api: Api,
  esc: Escenario,
): Promise<number> {
  return (await crearProductoEInventario(api, esc)).idInventario;
}

let numeroDoc = 1;

interface Linea {
  idInventario: number;
  cantidad: number;
  precio: number;
}

/** Arma el payload que envía el frontend (precio con IGV 18 % aparte). */
export function payloadComprobante(
  idEntidad: number,
  idTipoOperacion: number,
  idTipoComprobante: number,
  fecha: string,
  lineas: Linea[],
) {
  numeroDoc += 1;
  return {
    idPersona: idEntidad,
    idTipoOperacion,
    idTipoComprobante,
    fechaEmision: fecha,
    moneda: 'PEN',
    tipoCambio: 1,
    serie: 'F001',
    numero: String(numeroDoc).padStart(8, '0'),
    detalles: lineas.map((l) => {
      const subtotal = l.cantidad * l.precio;
      const igv = Math.round(subtotal * 0.18 * 100) / 100;
      return {
        idInventario: l.idInventario,
        cantidad: l.cantidad,
        unidadMedida: 'unidad',
        precioUnitario: l.precio,
        subtotal,
        igv,
        isc: 0,
        total: subtotal + igv,
        descripcion: 'Línea de prueba',
      };
    }),
  };
}

export function comprar(
  api: Api,
  esc: Escenario,
  fecha: string,
  lineas: Linea[],
) {
  return api.post(
    '/api/comprobante',
    payloadComprobante(esc.idProveedor, esc.compra, esc.factura, fecha, lineas),
  );
}

export function vender(
  api: Api,
  esc: Escenario,
  fecha: string,
  lineas: Linea[],
) {
  return api.post(
    '/api/comprobante',
    payloadComprobante(esc.idCliente, esc.venta, esc.factura, fecha, lineas),
  );
}

export async function kardex(empresa: Empresa, idInventario: number) {
  const res = await empresa.api.get(
    `/api/kardex?personaId=${empresa.personaId}&idInventario=${idInventario}&fechaInicio=2026-01-01&fechaFin=2026-12-31`,
  );
  esperarStatus(res, 200);
  return res.body;
}

export async function stockActual(
  api: Api,
  idInventario: number,
): Promise<number> {
  const res = await api.get(`/api/inventario/${idInventario}`);
  esperarStatus(res, 200);
  return Number(res.body.stockActual ?? res.body.data?.stockActual);
}
