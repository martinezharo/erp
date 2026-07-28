import type { APIRoute } from "astro";
import { resolveProjectId } from "../../../lib/api/auth";
import { ApiError } from "../../../lib/api/errors";
import { apiHandler, json, parseBody, parseQuery, withIdempotency } from "../../../lib/api/handler";
import { crearProductoSchema, paginacionSchema } from "../../../lib/api/schemas";
import { paginated } from "../../../lib/api/serializers";
import { z } from "zod";

const listSchema = paginacionSchema.extend({
    proyecto_id: z.coerce.number().int().positive().optional(),
    /** Case-insensitive partial match on the product name. */
    buscar: z.string().min(1).optional(),
});

/** GET /api/v1/productos - the catalogue, and the source of valid producto_id. */
export const GET: APIRoute = (context) =>
    apiHandler(context, "read", async (principal) => {
        const { page, page_size, proyecto_id, buscar } = parseQuery(context.url, listSchema);
        const projectId = resolveProjectId(principal, proyecto_id);

        let query = principal.supabase
            .from("productos")
            .select("id, proyecto_id, nombre", { count: "exact" })
            .eq("proyecto_id", projectId)
            .order("nombre");

        if (buscar) query = query.ilike("nombre", `%${buscar}%`);

        const from = (page - 1) * page_size;
        const { data, count, error } = await query.range(from, from + page_size - 1);
        if (error) throw new ApiError("internal_error", error.message);

        return json(paginated(data ?? [], count ?? 0, page, page_size));
    });

/** POST /api/v1/productos */
export const POST: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const body = await parseBody(context.request, crearProductoSchema);
        const projectId = resolveProjectId(principal, body.proyecto_id);

        return withIdempotency(context, principal, "POST /api/v1/productos", body, async () => {
            const { data, error } = await principal.supabase
                .from("productos")
                .insert({ proyecto_id: projectId, nombre: body.nombre })
                .select("id, proyecto_id, nombre")
                .single();

            if (error) throw new ApiError("internal_error", error.message);
            return json({ data }, 201);
        });
    });
