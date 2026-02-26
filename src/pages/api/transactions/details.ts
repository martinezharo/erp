import type { APIRoute } from "astro";
import { getAuthenticatedSupabase } from "../../../lib/supabase";

export const GET: APIRoute = async ({ request, cookies }) => {
    const supabase = getAuthenticatedSupabase(cookies);
    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    const projectId = url.searchParams.get("projectId");

    if (!date || !projectId) {
        return new Response(JSON.stringify({ error: "Missing date or projectId" }), {
            status: 400,
        });
    }

    // 1. Fetch Sales (Ventas) with details
    const { data: ventas, error: ventasError } = await supabase
        .from("ventas")
        .select(`
      id,
      fecha,
      canal,
      estado,
      venta_detalle (
        unidades,
        precio_unitario_venta,
        producto:vista_stock_final(nombre_producto)
      )
    `)
        .eq("proyecto_id", projectId)
        .eq("fecha", date);

    if (ventasError) {
        console.error(ventasError);
        return new Response(JSON.stringify({ error: ventasError.message }), { status: 500 });
    }

    // 2. Fetch Purchases (Compras) with details
    // Note: Assuming similar structure for 'compras' and 'compra_detalle' based on types
    // If 'vista_stock_final' join is tricky for purchases, we might need a direct join on 'productos'
    const { data: compras, error: comprasError } = await supabase
        .from("compras")
        .select(`
      id,
      fecha,
      estado,
      compra_detalle (
        unidades,
        precio_unitario_compra,
        producto:productos(nombre)
      )
    `)
        .eq("proyecto_id", projectId)
        .eq("fecha", date);

    if (comprasError) {
        console.error(comprasError);
        // Don't fail entire request, just log
    }

    // 3. Fetch Expenses/Other Income (Otros Movimientos)
    const { data: otros, error: otrosError } = await supabase
        .from("otros_ingresos_gastos")
        .select("*")
        .eq("proyecto_id", projectId)
        .eq("fecha", date);

    if (otrosError) console.error(otrosError);


    // 4. Normalize Data
    interface NormalizedTransaction {
        id: number;
        type: string;
        date: string;
        concept: string;
        units: number;
        amount: number;
        channel: string;
        status: string;
    }

    const normalizedTransactions: NormalizedTransaction[] = [];

    // Process Sales
    ventas?.forEach((v: any) => {
        let totalUnits = 0;
        let totalAmount = 0;
        const productNames: string[] = [];

        v.venta_detalle.forEach((d: any) => {
            totalUnits += d.unidades;
            totalAmount += d.unidades * d.precio_unitario_venta;
            // Handle optional chaining in case product view is null (though it shouldn't be)
            // Note: Supabase returns array or object depending on relationship. Usually object for singular 'producto'.
            // In vista_stock_final join, it might be tricky. Let's assume standard relation.
            // Actually, 'producto' in 'venta_detalle' likely points to 'productos' table or similar.
            // Let's rely on standard join names. If 'producto' returns null, fallback.
            const pName = d.producto?.nombre_producto || d.producto?.nombre || "Producto desconocido";
            if (!productNames.includes(pName)) productNames.push(pName);
        });

        normalizedTransactions.push({
            id: v.id,
            type: 'venta',
            date: v.fecha,
            concept: productNames.join(", "),
            units: totalUnits,
            amount: totalAmount,
            channel: v.canal,
            status: v.estado,
        });
    });

    // Process Purchases
    compras?.forEach((c: any) => {
        let totalUnits = 0;
        let totalAmount = 0;
        const productNames: string[] = [];

        c.compra_detalle.forEach((d: any) => {
            totalUnits += d.unidades;
            totalAmount += d.unidades * d.precio_unitario_compra;
            const pName = d.producto?.nombre || "Producto desconocido";
            if (!productNames.includes(pName)) productNames.push(pName);
        });

        normalizedTransactions.push({
            id: c.id,
            type: 'compra',
            date: c.fecha,
            concept: productNames.join(", "),
            units: totalUnits,
            amount: totalAmount * -1, // Expense is negative
            channel: 'Proveedor', // Purchases usually don't have channel like sales
            status: c.estado,
        });
    });

    // Process Others
    otros?.forEach((o: any) => {
        normalizedTransactions.push({
            id: o.id,
            type: o.tipo === 'gasto' ? 'gasto' : 'ingreso',
            date: o.fecha,
            concept: o.concepto,
            units: 1,
            amount: o.tipo === 'gasto' ? -Math.abs(o.importe) : Math.abs(o.importe),
            channel: 'Manual',
            status: 'completado',
        });
    });

    // Sort by ID (proxy for time) desc ??? Or just return mixed?
    // Let's sort by ID to keep order of insertion roughly
    normalizedTransactions.sort((a, b) => b.id - a.id);

    return new Response(JSON.stringify(normalizedTransactions), {
        status: 200,
    });
};
