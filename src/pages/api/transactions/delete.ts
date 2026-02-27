import type { APIRoute } from "astro";
import { getAuthenticatedSupabase, isDemoMode } from "../../../lib/supabase";

export const DELETE: APIRoute = async ({ request, cookies }) => {
    if (isDemoMode) {
        return new Response(JSON.stringify({ error: "No disponible en modo demo" }), { status: 403 });
    }

    const supabase = getAuthenticatedSupabase(cookies);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const type = url.searchParams.get("type");

    if (!id || !type) {
        return new Response(JSON.stringify({ error: "Missing id or type" }), {
            status: 400,
        });
    }

    let table = "";
    // Map frontend type to database table
    switch (type) {
        case "venta":
            table = "ventas";
            // Note: Cascade delete should handle venta_detalle if configured in DB. 
            // If not, we might need to delete details first or rely on FK constraints.
            // Assuming Supabase foreign keys are set to cascade.
            break;
        case "compra":
            table = "compras";
            break;
        case "gasto":
        case "ingreso":
            table = "otros_ingresos_gastos";
            break;
        default:
            return new Response(JSON.stringify({ error: "Invalid type" }), {
                status: 400,
            });
    }

    const { error } = await supabase
        .from(table)
        .delete()
        .eq("id", id);

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
        });
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
    });
};
