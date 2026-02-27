import type { APIRoute } from "astro";
import { getAuthenticatedSupabase, isDemoMode } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, cookies }) => {
    if (isDemoMode) {
        return new Response(JSON.stringify({ error: "No disponible en modo demo" }), { status: 403 });
    }

    const supabase = getAuthenticatedSupabase(cookies);
    const body = await request.json();

    const { date, channel, items, projectId } = body;

    console.log("Received Sale Body:", body); // Debug Log

    if (!date || !channel || !items || items.length === 0 || !projectId) {
        console.error("Missing fields:", { date, channel, itemsLen: items?.length, projectId });
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
            status: 400,
        });
    }

    // 1. Insert into 'ventas'
    const { data: venta, error: ventaError } = await supabase
        .from("ventas")
        .insert({
            proyecto_id: projectId,
            fecha: date,
            canal: channel,
            estado: "enviada", // Default status
        })
        .select()
        .single();

    if (ventaError) {
        return new Response(JSON.stringify({ error: ventaError.message }), {
            status: 500,
        });
    }

    // 2. Insert into 'venta_detalle'
    const detalles = items.map((item: any) => ({
        venta_id: venta.id,
        producto_id: item.productId,
        unidades: item.units,
        precio_unitario_venta: item.price,
        porcentaje_iva: item.tax || 21, // Default to 21% if not specified
    }));

    const { error: detalleError } = await supabase
        .from("venta_detalle")
        .insert(detalles);

    if (detalleError) {
        // Ideally we would rollback the 'venta' insertion here, but Supabase HTTP client doesn't support transactions easily.
        // We could try to delete the venta.
        await supabase.from("ventas").delete().eq("id", venta.id);

        return new Response(JSON.stringify({ error: detalleError.message }), {
            status: 500,
        });
    }

    return new Response(JSON.stringify({ success: true, id: venta.id }), {
        status: 200,
    });
};
