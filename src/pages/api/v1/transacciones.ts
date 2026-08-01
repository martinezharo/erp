import type { APIRoute } from "astro";
import { resolveProjectId } from "../../../lib/api/auth";
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

        const { data, count } = await principal.backend!.listTransactions({
            projectId,
            page: filtros.page,
            pageSize: filtros.page_size,
            fromDate: filtros.desde,
            toDate: filtros.hasta,
            type: filtros.tipo,
        });

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
            const id = await principal.backend!.createTransaction({
                projectId,
                type: body.tipo,
                concept: body.concepto,
                description: body.descripcion,
                amount: body.importe,
                vatRate: body.porcentaje_iva,
                date: body.fecha,
            });
            const data = await principal.backend!.getTransaction(id);
            return json({ data: serializeTransaccion(data) }, 201);
        });
    });
