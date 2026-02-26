import type { APIRoute } from "astro";
import { getAuthenticatedSupabase } from "../../../lib/supabase";

export const POST: APIRoute = async ({ request, cookies }) => {
    const supabase = getAuthenticatedSupabase(cookies);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    try {
        const body = await request.json();
        const { projectId, name } = body;

        if (!projectId || !name) {
            return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
        }

        const { data, error } = await supabase
            .from("productos")
            .insert({
                proyecto_id: projectId,
                nombre: name
            })
            .select()
            .single();

        if (error) {
            throw new Error(error.message);
        }

        return new Response(JSON.stringify({ success: true, data }), { status: 200 });

    } catch (error: any) {
        console.error("API Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
