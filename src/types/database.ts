export type EstadoCompra = 'pendiente' | 'recibida' | 'cancelada';
export type TipoMovimiento = 'compra' | 'venta' | 'devolucion_vta' | 'ajuste manual' | 'devolucion_com';
export type TipoTransaccion = 'ingreso' | 'gasto';
export type EstadoVenta = 'pendiente' | 'enviada' | 'devuelta' | 'reembolsada';

export interface Proyecto {
    id: number;
    nombre: string;
    activo: boolean;
}

export interface Producto {
    id: number;
    proyecto_id: number;
    nombre: string;
}

export interface Compra {
    id: number;
    proyecto_id: number;
    fecha: string;
    estado: EstadoCompra;
}

export interface CompraDetalle {
    id: number;
    compra_id: number;
    producto_id: number;
    unidades: number;
    precio_unitario_compra: number;
    porcentaje_iva: number;
}

export interface Venta {
    id: number;
    proyecto_id: number;
    fecha: string;
    canal: string;
    estado: EstadoVenta;
}

export interface VentaDetalle {
    id: number;
    venta_id: number;
    producto_id: number;
    unidades: number;
    precio_unitario_venta: number;
    porcentaje_iva: number;
}

export interface MovimientoStock {
    id: number;
    producto_id: number;
    unidades: number;
    tipo_movimiento: TipoMovimiento;
    ref_compra_detalle_id?: number;
    ref_venta_detalle_id?: number;
    fecha: string;
}

export interface OtrosIngresosGastos {
    id: number;
    proyecto_id: number;
    tipo: TipoTransaccion;
    concepto: string;
    descripcion?: string;
    importe: number;
    porcentaje_iva?: number;
    fecha: string;
}

// Views
export interface VistaFinanzasDiarias {
    dia: string;
    proyecto_id: number;
    nombre_proyecto: string;
    ingresos: number;
    gastos: number;
    balance: number;
    urp: number;
    iva_soportado: number;
    iva_repercutido: number;
    saldo_iva: number;
}

export interface VistaStockFinal {
    proyecto_id: number;
    nombre_proyecto: string;
    producto_id: number;
    nombre_producto: string;
    stock_actual: number;
    coste_ud: number;
    venta_ud: number;
    num_ventas_30d: number;
    beneficio_ud: number;
    beneficio_total_30d: number;
    valor_stock: number;
    venta_diaria_promedio: number;
    dias_stock_restante: number;
}
