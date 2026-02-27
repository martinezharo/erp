import type { APIRoute } from "astro";
import { getAuthenticatedSupabase, isDemoMode } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, cookies }) => {
    return handleSave(request, cookies, "POST");
};

export const PUT: APIRoute = async ({ request, cookies }) => {
    return handleSave(request, cookies, "PUT");
};

async function handleSave(request: Request, cookies: any, method: string) {
    if (isDemoMode) {
        return new Response(JSON.stringify({ error: "No disponible en modo demo" }), { status: 403 });
    }

    const supabase = getAuthenticatedSupabase(cookies);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    try {
        const body = await request.json();
        const { id, projectId, tipo, fecha, concepto, descripcion, importe, porcentaje_iva } = body;

        if (!projectId || !tipo || !fecha || !concepto || !importe) {
            return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
        }

        const payload = {
            proyecto_id: projectId,
            tipo,
            fecha,
            concepto,
            descripcion,
            importe: parseFloat(importe),
            porcentaje_iva: porcentaje_iva ? parseFloat(porcentaje_iva) : 0
        };

        let result;

        if (method === "PUT" && id) {
            result = await supabase
                .from("otros_ingresos_gastos")
                .update(payload)
                .eq("id", id)
                .select()
                .single();
        } else {
            result = await supabase
                .from("otros_ingresos_gastos")
                .insert(payload)
                .select()
                .single();
        }

        if (result.error) throw new Error(result.error.message);

        return new Response(JSON.stringify({ success: true, id: result.data.id }), { status: 200 });

    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}
