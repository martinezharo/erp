import type { APIRoute } from "astro";
import { resolveProjectId } from "../../../lib/api/auth";
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

        const { data, count } = await principal.backend!.listProducts({
            projectId,
            page,
            pageSize: page_size,
            search: buscar,
        });

        return json(paginated(data ?? [], count ?? 0, page, page_size));
    });

/** POST /api/v1/productos */
export const POST: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const body = await parseBody(context.request, crearProductoSchema);
        const projectId = resolveProjectId(principal, body.proyecto_id);

        return withIdempotency(context, principal, "POST /api/v1/productos", body, async () => {
            const data = await principal.backend!.createProduct(projectId, body.nombre);
            return json({ data }, 201);
        });
    });
