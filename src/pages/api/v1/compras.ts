import type { APIRoute } from "astro";
import { resolveProjectId } from "../../../lib/api/auth";
import { ApiError, fromPostgresError } from "../../../lib/api/errors";
import { apiHandler, json, parseBody, parseQuery, withIdempotency } from "../../../lib/api/handler";
import { crearCompraSchema, filtrosComprasSchema } from "../../../lib/api/schemas";
import { paginated, serializeCompra } from "../../../lib/api/serializers";

export const COMPRA_SELECT = `
    id,
    proyecto_id,
    fecha,
    estado,
    compra_detalle (
        id,
        producto_id,
        unidades,
        precio_unitario_compra,
        porcentaje_iva,
        producto:productos ( nombre )
    )
`;

/** GET /api/v1/compras */
export const GET: APIRoute = (context) =>
    apiHandler(context, "read", async (principal) => {
        const filtros = parseQuery(context.url, filtrosComprasSchema);
        const projectId = resolveProjectId(principal, filtros.proyecto_id);

        let query = principal.supabase
            .from("compras")
            .select(COMPRA_SELECT, { count: "exact" })
            .eq("proyecto_id", projectId)
            .order("fecha", { ascending: false })
            .order("id", { ascending: false });

        if (filtros.desde) query = query.gte("fecha", filtros.desde);
        if (filtros.hasta) query = query.lte("fecha", filtros.hasta);
        if (filtros.estado) query = query.eq("estado", filtros.estado);

        const from = (filtros.page - 1) * filtros.page_size;
        const { data, count, error } = await query.range(from, from + filtros.page_size - 1);
        if (error) throw new ApiError("internal_error", error.message);

        return json(
            paginated(
                (data ?? []).map(serializeCompra),
                count ?? 0,
                filtros.page,
                filtros.page_size,
            ),
        );
    });

/**
 * POST /api/v1/compras
 *
 * Transactional, like sales. Note that only purchases in state `recibida` move
 * stock and count as an expense, so a pre-order should be created as
 * `pendiente` and patched later.
 */
export const POST: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const body = await parseBody(context.request, crearCompraSchema);
        const projectId = resolveProjectId(principal, body.proyecto_id);

        return withIdempotency(context, principal, "POST /api/v1/compras", body, async () => {
            const { data, error } = await principal.supabase.rpc("crear_compra", {
                p_proyecto_id: projectId,
                p_fecha: body.fecha,
                p_items: body.items,
                p_estado: body.estado,
            });

            if (error) throw fromPostgresError(error);

            const { data: compra, error: readError } = await principal.supabase
                .from("compras")
                .select(COMPRA_SELECT)
                .eq("id", (data as { id: number }).id)
                .single();

            if (readError) throw new ApiError("internal_error", readError.message);
            return json({ data: serializeCompra(compra) }, 201);
        });
    });
