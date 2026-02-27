import type { APIRoute } from "astro";
import { getAuthenticatedSupabase, isDemoMode } from "../../../lib/supabase";

export const PUT: APIRoute = async ({ request, cookies }) => {
    if (isDemoMode) {
        return new Response(JSON.stringify({ error: "No disponible en modo demo" }), { status: 403 });
    }

    const supabase = getAuthenticatedSupabase(cookies);
    const body = await request.json();

    const { id, date, channel, items, projectId } = body;

    if (!id || !date || !channel || !items || items.length === 0 || !projectId) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
            status: 400,
        });
    }

    // 1. Update 'ventas'
    const { error: ventaError } = await supabase
        .from("ventas")
        .update({
            fecha: date,
            canal: channel,
            // proyecto_id usually doesn't change, but we can update it if needed
        })
        .eq("id", id);

    if (ventaError) {
        return new Response(JSON.stringify({ error: ventaError.message }), {
            status: 500,
        });
    }

    // 2. Replace 'venta_detalle'
    // Strategy: Delete all existing details for this sale and insert new ones.
    // This is simpler than diffing.

    // Delete existing
    const { error: deleteError } = await supabase
        .from("venta_detalle")
        .delete()
        .eq("venta_id", id);

    if (deleteError) {
        return new Response(JSON.stringify({ error: "Error clearing old details" }), {
            status: 500,
        });
    }

    // Insert new
    const detalles = items.map((item: any) => ({
        venta_id: id,
        producto_id: item.productId,
        unidades: item.units,
        precio_unitario_venta: item.price,
        porcentaje_iva: item.tax || 21,
    }));

    const { error: insertError } = await supabase
        .from("venta_detalle")
        .insert(detalles);

    if (insertError) {
        return new Response(JSON.stringify({ error: insertError.message }), {
            status: 500,
        });
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
    });
};
