import type { APIRoute } from "astro";
import { getAuthenticatedSupabase, isDemoMode } from "../../../lib/supabase";

export const PUT: APIRoute = async ({ request, cookies }) => {
    if (isDemoMode) {
        return new Response(JSON.stringify({ error: "No disponible en modo demo" }), { status: 403 });
    }

    const supabase = getAuthenticatedSupabase(cookies);

    // Verify user session
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    try {
        const body = await request.json();
        const { id, projectId, date, estado, items } = body;

        if (!id || !projectId || !date || !items || items.length === 0) {
            return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
        }

        // 1. Update Header
        const { error: compraError } = await supabase
            .from("compras")
            .update({
                fecha: date,
                estado: estado
            })
            .eq("id", id);

        if (compraError) {
            throw new Error(compraError.message);
        }

        // 2. Update Details (Delete all and re-insert strategy for simplicity)
        // Delete existing details
        const { error: deleteError } = await supabase
            .from("compra_detalle")
            .delete()
            .eq("compra_id", id);

        if (deleteError) {
            throw new Error("Error clearing old details");
        }

        // Insert new details
        const detailsData = items.map((item: any) => ({
            compra_id: id,
            producto_id: item.productId,
            unidades: item.units,
            precio_unitario_compra: item.unitPrice,
            porcentaje_iva: item.tax
        }));

        const { error: detailsError } = await supabase
            .from("compra_detalle")
            .insert(detailsData);

        if (detailsError) {
            throw new Error(`Error saving purchase details: ${detailsError.message}`);
        }

        return new Response(JSON.stringify({ success: true, id: id }), { status: 200 });

    } catch (error: any) {
        console.error("API Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
