import type { APIRoute } from "astro";
import { getAuthenticatedSupabase } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, cookies }) => {
    const supabase = getAuthenticatedSupabase(cookies);

    // Verify user session
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    try {
        const body = await request.json();
        const { projectId, date, estado, items } = body;

        if (!projectId || !date || !items || items.length === 0) {
            return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
        }

        // Start transaction (conceptually, Supabase doesn't support generic transactions via REST easily without RPC, 
        // so we'll do sequential inserts. If detailed fail, we might have orphan header, but acceptable for this MVP).

        // 1. Insert Header
        const { data: compra, error: compraError } = await supabase
            .from("compras")
            .insert({
                proyecto_id: projectId,
                fecha: date,
                estado: estado || 'pendiente'
            })
            .select()
            .single();

        if (compraError) {
            throw new Error(compraError.message);
        }

        // 2. Insert Details
        const detailsData = items.map((item: any) => ({
            compra_id: compra.id,
            producto_id: item.productId,
            unidades: item.units,
            precio_unitario_compra: item.unitPrice,
            porcentaje_iva: item.tax
        }));

        const { error: detailsError } = await supabase
            .from("compra_detalle")
            .insert(detailsData);

        if (detailsError) {
            // Rollback header? (Hard via REST)
            console.error("Error inserting details:", detailsError);
            throw new Error(`Error saving purchase details: ${detailsError.message} (${detailsError.code})`);
        }

        return new Response(JSON.stringify({ success: true, id: compra.id }), { status: 200 });

    } catch (error: any) {
        console.error("API Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
