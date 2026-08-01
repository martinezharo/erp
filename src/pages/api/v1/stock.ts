import type { APIRoute } from "astro";
import { z } from "zod";
import { resolveProjectId } from "../../../lib/api/auth";
import { apiHandler, json, parseQuery } from "../../../lib/api/handler";
import { paginacionSchema } from "../../../lib/api/schemas";
import { paginated, serializeStock } from "../../../lib/api/serializers";

const stockQuerySchema = paginacionSchema.extend({
    proyecto_id: z.coerce.number().int().positive().optional(),
    /**
     * Days-of-cover ceiling. The whole point of exposing this as a filter is
     * restock automation: `?max_dias_stock=7` is "what runs out this week".
     */
    max_dias_stock: z.coerce.number().nonnegative().optional(),
    /** Only products at or below this unit count. */
    max_unidades: z.coerce.number().int().optional(),
});

/**
 * GET /api/v1/stock
 *
 * Reads `vista_stock_final`, which already carries current stock, average cost
 * and price, 30-day velocity and the derived days-of-cover.
 */
export const GET: APIRoute = (context) =>
    apiHandler(context, "read", async (principal) => {
        const query = parseQuery(context.url, stockQuerySchema);
        const projectId = resolveProjectId(principal, query.proyecto_id);

        const { data, count } = await principal.backend!.listStock({
            projectId,
            page: query.page,
            pageSize: query.page_size,
            maxDays: query.max_dias_stock,
            maxUnits: query.max_unidades,
        });

        return json(
            paginated((data ?? []).map(serializeStock), count ?? 0, query.page, query.page_size),
        );
    });
