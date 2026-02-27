import type { APIRoute } from "astro";
import { getAuthenticatedSupabase, isDemoMode } from "../../../lib/supabase";

export const GET: APIRoute = async ({ cookies, url }) => {
    if (isDemoMode) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }

    const supabase = getAuthenticatedSupabase(cookies);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const productId = url.searchParams.get('productId');
    if (!productId) {
        return new Response(JSON.stringify({ error: "Missing productId" }), { status: 400 });
    }

    try {
        // Fetch movements with related data
        // We have to use a slightly complex query because the relationships are 2 levels deep for sales/purchases
        // movimientos_stock -> compra_detalle -> compras
        // movimientos_stock -> venta_detalle -> ventas

        // Since Supabase JS client doesn't support complex joins in one go easily if relationships aren't perfect,
        // we might need to fetch movements first, then fetch details if needed, or use a view.
        // But let's try deep select first. Assuming foreign keys are set up correctly.

        // Note: Based on previous context, we might not have perfect FK definitions for deep selection in the types,
        // but let's assume the standard Supabase structure.

        const { data: movements, error } = await supabase
            .from('movimientos_stock')
            .select(`
                id,
                unidades,
                tipo_movimiento,
                fecha,
                ref_compra_detalle_id,
                ref_venta_detalle_id,
                compra_detalle:ref_compra_detalle_id (
                    precio_unitario_compra,
                    compras (
                        fecha
                    )
                ),
                venta_detalle:ref_venta_detalle_id (
                    precio_unitario_venta,
                    ventas (
                        fecha,
                        canal
                    )
                )
            `)
            .eq('producto_id', productId)
            .order('fecha', { ascending: false });

        if (error) {
            throw error;
        }

        // Process data to flatten structure
        const formattedMovements = movements.map((m: any) => {
            let fecha = m.fecha; // Default to movement date (for manual adjustments)
            let precio = null;
            let canal = '-';

            if (m.tipo_movimiento === 'compra' && m.compra_detalle?.compras?.fecha) {
                fecha = m.compra_detalle.compras.fecha;
                precio = m.compra_detalle.precio_unitario_compra;
                canal = 'Proveedor';
            } else if (m.tipo_movimiento === 'venta' && m.venta_detalle?.ventas?.fecha) {
                fecha = m.venta_detalle.ventas.fecha;
                precio = m.venta_detalle.precio_unitario_venta;
                canal = m.venta_detalle.ventas.canal || 'Directo';
            } else if (m.tipo_movimiento === 'ajuste_manual') {
                canal = 'Manual';
            }

            return {
                id: m.id,
                fecha,
                tipo: m.tipo_movimiento,
                unidades: m.unidades,
                precio,
                canal
            };
        });

        // Re-sort by date in case the source date (purchase/sale) is different from movement creation date
        formattedMovements.sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

        return new Response(JSON.stringify({ data: formattedMovements }), { status: 200 });

    } catch (error: any) {
        console.error("API Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
