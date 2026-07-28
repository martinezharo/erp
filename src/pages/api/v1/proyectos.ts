import type { APIRoute } from "astro";
import { apiHandler, json } from "../../../lib/api/handler";
import { ApiError } from "../../../lib/api/errors";

/**
 * GET /api/v1/proyectos
 *
 * The entry point for any caller: every other resource is scoped by project, so
 * an agent starts here to learn the ids it may use. A pinned key sees only its
 * own project.
 */
export const GET: APIRoute = (context) =>
    apiHandler(context, "read", async (principal) => {
        let query = principal.supabase
            .from("proyectos")
            .select("id, nombre, activo")
            .order("nombre");

        if (principal.projectId !== null) {
            query = query.eq("id", principal.projectId);
        }

        const { data, error } = await query;
        if (error) throw new ApiError("internal_error", error.message);

        return json({ data });
    });
