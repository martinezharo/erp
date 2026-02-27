/**
 * Mock data for Demo Mode
 * Used when Supabase environment variables are not configured
 */

import type {
    Proyecto,
    VistaFinanzasDiarias,
    VistaStockFinal,
} from "../types/database";

// ── Projects ──────────────────────────────────────────────
export const mockProjects: Proyecto[] = [
    { id: 1, nombre: "Octopus Control", activo: true },
    { id: 2, nombre: "Demo Store", activo: true },
];

// ── Stock ─────────────────────────────────────────────────
export const mockStock: VistaStockFinal[] = [
    {
        proyecto_id: 1,
        nombre_proyecto: "Octopus Control",
        producto_id: 1,
        nombre_producto: "Mando Samsung BN59",
        stock_actual: 48,
        coste_ud: 3.2,
        venta_ud: 9.99,
        num_ventas_30d: 22,
        beneficio_ud: 6.79,
        beneficio_total_30d: 149.38,
        valor_stock: 153.6,
        venta_diaria_promedio: 0.73,
        dias_stock_restante: 66,
    },
    {
        proyecto_id: 1,
        nombre_proyecto: "Octopus Control",
        producto_id: 2,
        nombre_producto: "Mando LG AKB75095308",
        stock_actual: 35,
        coste_ud: 2.8,
        venta_ud: 8.99,
        num_ventas_30d: 18,
        beneficio_ud: 6.19,
        beneficio_total_30d: 111.42,
        valor_stock: 98.0,
        venta_diaria_promedio: 0.6,
        dias_stock_restante: 58,
    },
    {
        proyecto_id: 1,
        nombre_proyecto: "Octopus Control",
        producto_id: 3,
        nombre_producto: "Mando Sony RMT-TX300E",
        stock_actual: 12,
        coste_ud: 4.5,
        venta_ud: 12.99,
        num_ventas_30d: 9,
        beneficio_ud: 8.49,
        beneficio_total_30d: 76.41,
        valor_stock: 54.0,
        venta_diaria_promedio: 0.3,
        dias_stock_restante: 40,
    },
    {
        proyecto_id: 1,
        nombre_proyecto: "Octopus Control",
        producto_id: 4,
        nombre_producto: "Mando Fire TV Stick",
        stock_actual: 60,
        coste_ud: 1.9,
        venta_ud: 7.49,
        num_ventas_30d: 30,
        beneficio_ud: 5.59,
        beneficio_total_30d: 167.7,
        valor_stock: 114.0,
        venta_diaria_promedio: 1.0,
        dias_stock_restante: 60,
    },
    {
        proyecto_id: 1,
        nombre_proyecto: "Octopus Control",
        producto_id: 5,
        nombre_producto: "Mando Xiaomi Mi Box",
        stock_actual: 5,
        coste_ud: 2.1,
        venta_ud: 6.99,
        num_ventas_30d: 7,
        beneficio_ud: 4.89,
        beneficio_total_30d: 34.23,
        valor_stock: 10.5,
        venta_diaria_promedio: 0.23,
        dias_stock_restante: 22,
    },
];

// ── Daily Finance (last 90 days) ──────────────────────────
function generateMockFinanzas(): VistaFinanzasDiarias[] {
    const data: VistaFinanzasDiarias[] = [];
    const now = new Date();

    for (let i = 90; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split("T")[0];

        // Simulate some variance – weekends have less activity
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const activityFactor = isWeekend ? 0.3 : 1;

        // Random but deterministic-ish values based on day index
        const seed = (i * 7 + 13) % 100;
        const ingresos =
            Math.round((40 + seed * 1.2) * activityFactor * 100) / 100;
        const gastos = Math.round((15 + (seed % 40) * 0.8) * activityFactor * 100) / 100;
        const balance = Math.round((ingresos - gastos) * 100) / 100;
        const iva_repercutido = Math.round(ingresos * 0.21 * 100) / 100;
        const iva_soportado = Math.round(gastos * 0.21 * 100) / 100;

        data.push({
            dia: dateStr,
            proyecto_id: 1,
            nombre_proyecto: "Octopus Control",
            ingresos,
            gastos,
            balance,
            urp: Math.round(balance * 0.85 * 100) / 100,
            iva_soportado,
            iva_repercutido,
            saldo_iva: Math.round((iva_repercutido - iva_soportado) * 100) / 100,
        });
    }

    return data;
}

export const mockFinanzas = generateMockFinanzas();

// ── Evolution chart data helper ───────────────────────────
export function getMockEvolution(days: number) {
    const now = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = [];
    const currentDate = new Date(startDate);

    while (currentDate <= now) {
        const dateStr = currentDate.toISOString().split("T")[0];
        const match = mockFinanzas.find((f) => f.dia === dateStr);

        result.push({
            date: dateStr,
            ingresos: match ? match.ingresos : 0,
            urp: match ? match.urp : 0,
        });

        currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
}
