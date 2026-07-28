import type { APIRoute } from "astro";
import { resolveProjectId } from "../../../lib/api/auth";
import { ApiError, fromPostgresError } from "../../../lib/api/errors";
import { apiHandler, json, parseBody, parseQuery, withIdempotency } from "../../../lib/api/handler";
import { crearVentaSchema, filtrosVentasSchema } from "../../../lib/api/schemas";
import { paginated, serializeVenta } from "../../../lib/api/serializers";

export const VENTA_SELECT = `
    id,
    proyecto_id,
    fecha,
    canal,
    estado,
    venta_detalle (
        id,
        producto_id,
        unidades,
        precio_unitario_venta,
        porcentaje_iva,
        producto:productos ( nombre )
    )
`;

/** GET /api/v1/ventas */
export const GET: APIRoute = (context) =>
    apiHandler(context, "read", async (principal) => {
        const filtros = parseQuery(context.url, filtrosVentasSchema);
        const projectId = resolveProjectId(principal, filtros.proyecto_id);

        let query = principal.supabase
            .from("ventas")
            .select(VENTA_SELECT, { count: "exact" })
            .eq("proyecto_id", projectId)
            .order("fecha", { ascending: false })
            .order("id", { ascending: false });

        if (filtros.desde) query = query.gte("fecha", filtros.desde);
        if (filtros.hasta) query = query.lte("fecha", filtros.hasta);
        if (filtros.estado) query = query.eq("estado", filtros.estado);
        if (filtros.canal) query = query.eq("canal", filtros.canal);

        const from = (filtros.page - 1) * filtros.page_size;
        const { data, count, error } = await query.range(from, from + filtros.page_size - 1);
        if (error) throw new ApiError("internal_error", error.message);

        return json(
            paginated(
                (data ?? []).map(serializeVenta),
                count ?? 0,
                filtros.page,
                filtros.page_size,
            ),
        );
    });

/**
 * POST /api/v1/ventas
 *
 * Goes through the `crear_venta` RPC so the sale header and its lines are
 * written in one transaction; a failure on any line leaves nothing behind.
 */
export const POST: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const body = await parseBody(context.request, crearVentaSchema);
        const projectId = resolveProjectId(principal, body.proyecto_id);

        return withIdempotency(context, principal, "POST /api/v1/ventas", body, async () => {
            const { data, error } = await principal.supabase.rpc("crear_venta", {
                p_proyecto_id: projectId,
                p_fecha: body.fecha,
                p_canal: body.canal,
                p_items: body.items,
                p_estado: body.estado,
            });

            if (error) throw fromPostgresError(error);

            const { data: venta, error: readError } = await principal.supabase
                .from("ventas")
                .select(VENTA_SELECT)
                .eq("id", (data as { id: number }).id)
                .single();

            if (readError) throw new ApiError("internal_error", readError.message);
            return json({ data: serializeVenta(venta) }, 201);
        });
    });
