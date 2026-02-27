import type { APIRoute } from "astro";
import { getAuthenticatedSupabase, isDemoMode } from "../../../lib/supabase";

export const GET: APIRoute = async ({ request, cookies }) => {
    if (isDemoMode) {
        return new Response(JSON.stringify({ error: "No disponible en modo demo" }), { status: 403 });
    }

    const supabase = getAuthenticatedSupabase(cookies);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });

    const { data, error } = await supabase
        .from("otros_ingresos_gastos")
        .select("*")
        .eq("id", id)
        .single();

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    return new Response(JSON.stringify(data), { status: 200 });
};
