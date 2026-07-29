import type { APIRoute } from "astro";
import { resolveProjectId } from "../../../lib/api/auth";
import { ApiError, fromPostgresError } from "../../../lib/api/errors";
import { apiHandler, json, parseBody, parseQuery, withIdempotency } from "../../../lib/api/handler";
import { crearTransaccionSchema, filtrosTransaccionesSchema } from "../../../lib/api/schemas";
import { paginated, serializeTransaccion } from "../../../lib/api/serializers";

export const TRANSACCION_SELECT =
    "id, proyecto_id, tipo, concepto, descripcion, importe, porcentaje_iva, fecha";

/**
 * Other income and expenses: everything that is neither a sale nor a purchase
 * (subscriptions, fees, refunds from a supplier...).
 */
export const GET: APIRoute = (context) =>
    apiHandler(context, "read", async (principal) => {
        const filtros = parseQuery(context.url, filtrosTransaccionesSchema);
        const projectId = resolveProjectId(principal, filtros.proyecto_id);

        let query = principal.supabase
            .from("otros_ingresos_gastos")
            .select(TRANSACCION_SELECT, { count: "exact" })
            .eq("proyecto_id", projectId)
            .order("fecha", { ascending: false })
            .order("id", { ascending: false });

        if (filtros.desde) query = query.gte("fecha", filtros.desde);
        if (filtros.hasta) query = query.lte("fecha", filtros.hasta);
        if (filtros.tipo) query = query.eq("tipo", filtros.tipo);

        const from = (filtros.page - 1) * filtros.page_size;
        const { data, count, error } = await query.range(from, from + filtros.page_size - 1);
        if (error) throw new ApiError("internal_error", error.message);

        return json(
            paginated(
                (data ?? []).map(serializeTransaccion),
                count ?? 0,
                filtros.page,
                filtros.page_size,
            ),
        );
    });

/**
 * POST /api/v1/transacciones
 *
 * Single-table, so no RPC is needed; the insert is already atomic.
 */
export const POST: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const body = await parseBody(context.request, crearTransaccionSchema);
        const projectId = resolveProjectId(principal, body.proyecto_id);

        return withIdempotency(context, principal, "POST /api/v1/transacciones", body, async () => {
            const { data, error } = await principal.supabase
                .from("otros_ingresos_gastos")
                .insert({
                    proyecto_id: projectId,
                    tipo: body.tipo,
                    concepto: body.concepto,
                    descripcion: body.descripcion ?? null,
                    importe: body.importe,
                    porcentaje_iva: body.porcentaje_iva,
                    fecha: body.fecha,
                })
                .select(TRANSACCION_SELECT)
                .single();

            if (error) throw fromPostgresError(error);
            return json({ data: serializeTransaccion(data) }, 201);
        });
    });
