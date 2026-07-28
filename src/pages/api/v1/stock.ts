import type { APIRoute } from "astro";
import { z } from "zod";
import { resolveProjectId } from "../../../lib/api/auth";
import { ApiError } from "../../../lib/api/errors";
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

        let q = principal.supabase
            .from("vista_stock_final")
            .select("*", { count: "exact" })
            .eq("proyecto_id", projectId)
            .order("dias_stock_restante", { ascending: true });

        if (query.max_dias_stock !== undefined) {
            q = q.lte("dias_stock_restante", query.max_dias_stock);
        }
        if (query.max_unidades !== undefined) {
            q = q.lte("stock_actual", query.max_unidades);
        }

        const from = (query.page - 1) * query.page_size;
        const { data, count, error } = await q.range(from, from + query.page_size - 1);
        if (error) throw new ApiError("internal_error", error.message);

        return json(
            paginated((data ?? []).map(serializeStock), count ?? 0, query.page, query.page_size),
        );
    });
