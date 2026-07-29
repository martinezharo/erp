/**
 * Response shaping for the v1 API.
 *
 * The stored prices include VAT (the daily-finance view derives the tax as
 * `precio * iva / (100 + iva)`), so every total is broken out into base, tax and
 * gross here. A consumer building an invoice or a report should not have to
 * rediscover that convention from the SQL.
 */

interface LineaRow {
    id?: number;
    producto_id: number;
    unidades: number;
    porcentaje_iva: number | string;
    precio_unitario_venta?: number | string;
    precio_unitario_compra?: number | string;
    producto?: { nombre?: string } | null;
}

function num(value: number | string | null | undefined): number {
    const parsed = typeof value === "string" ? parseFloat(value) : (value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** Rounds to cents, keeping the JSON free of float noise like 12.340000000001. */
function money(value: number): number {
    return Math.round(value * 100) / 100;
}

function serializeLinea(row: LineaRow) {
    const precio = num(row.precio_unitario_venta ?? row.precio_unitario_compra);
    const iva = num(row.porcentaje_iva);
    const total = precio * row.unidades;
    const base = total / (1 + iva / 100);

    return {
        id: row.id,
        producto_id: row.producto_id,
        producto: row.producto?.nombre ?? null,
        unidades: row.unidades,
        precio_unitario: money(precio),
        porcentaje_iva: iva,
        total_base: money(base),
        total_iva: money(total - base),
        total: money(total),
    };
}

function totales(lineas: ReturnType<typeof serializeLinea>[]) {
    return {
        unidades: lineas.reduce((acc, l) => acc + l.unidades, 0),
        base: money(lineas.reduce((acc, l) => acc + l.total_base, 0)),
        iva: money(lineas.reduce((acc, l) => acc + l.total_iva, 0)),
        total: money(lineas.reduce((acc, l) => acc + l.total, 0)),
    };
}

export function serializeVenta(row: any) {
    const items = (row.venta_detalle ?? []).map(serializeLinea);
    return {
        id: row.id,
        proyecto_id: row.proyecto_id,
        fecha: row.fecha,
        canal: row.canal,
        estado: row.estado,
        items,
        totales: totales(items),
    };
}

export function serializeCompra(row: any) {
    const items = (row.compra_detalle ?? []).map(serializeLinea);
    return {
        id: row.id,
        proyecto_id: row.proyecto_id,
        fecha: row.fecha,
        estado: row.estado,
        items,
        totales: totales(items),
    };
}

export function serializeTransaccion(row: any) {
    const importe = num(row.importe);
    const iva = num(row.porcentaje_iva);
    const base = importe / (1 + iva / 100);

    return {
        id: row.id,
        proyecto_id: row.proyecto_id,
        tipo: row.tipo,
        concepto: row.concepto,
        descripcion: row.descripcion ?? null,
        fecha: row.fecha,
        porcentaje_iva: iva,
        importe_base: money(base),
        importe_iva: money(importe - base),
        importe: money(importe),
    };
}

export function serializeStock(row: any) {
    return {
        producto_id: row.producto_id,
        producto: row.nombre_producto,
        proyecto_id: row.proyecto_id,
        stock_actual: num(row.stock_actual),
        coste_unitario: money(num(row.coste_ud)),
        precio_venta_unitario: money(num(row.venta_ud)),
        beneficio_unitario: money(num(row.beneficio_ud)),
        ventas_30d: num(row.num_ventas_30d),
        venta_diaria_promedio: Math.round(num(row.venta_diaria_promedio) * 1000) / 1000,
        /** 999 is the view's sentinel for "no sales, so stock never runs out". */
        dias_stock_restante: Math.round(num(row.dias_stock_restante) * 10) / 10,
        valor_stock: money(num(row.valor_stock)),
    };
}

export function serializeFinanzas(row: any) {
    return {
        dia: row.dia,
        proyecto_id: row.proyecto_id,
        ingresos: money(num(row.ingresos)),
        gastos: money(num(row.gastos)),
        balance: money(num(row.balance)),
        beneficio_neto: money(num(row.urp)),
        iva_soportado: money(num(row.iva_soportado)),
        iva_repercutido: money(num(row.iva_repercutido)),
        saldo_iva: money(num(row.saldo_iva)),
    };
}

/** Uniform envelope for every list endpoint. */
export function paginated<T>(items: T[], total: number, page: number, pageSize: number) {
    return {
        data: items,
        pagination: {
            page,
            page_size: pageSize,
            total,
            total_pages: Math.max(1, Math.ceil(total / pageSize)),
            has_more: page * pageSize < total,
        },
    };
}
