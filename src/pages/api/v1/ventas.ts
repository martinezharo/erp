import type { APIRoute } from "astro";
import { resolveProjectId } from "../../../lib/api/auth";
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

        const { data, count } = await principal.backend!.listSales({
            projectId,
            page: filtros.page,
            pageSize: filtros.page_size,
            fromDate: filtros.desde,
            toDate: filtros.hasta,
            status: filtros.estado,
            channel: filtros.canal,
        });

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
 * Convex writes the sale header, lines and stock movements in one mutation.
 */
export const POST: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const body = await parseBody(context.request, crearVentaSchema);
        const projectId = resolveProjectId(principal, body.proyecto_id);

        return withIdempotency(context, principal, "POST /api/v1/ventas", body, async () => {
            const id = await principal.backend!.createSale({
                projectId,
                date: body.fecha,
                channel: body.canal,
                status: body.estado,
                items: body.items.map((item) => ({
                    productId: item.producto_id,
                    units: item.unidades,
                    unitPrice: item.precio_unitario,
                    vatRate: item.porcentaje_iva,
                })),
            });
            const venta = await principal.backend!.getSale(id);
            return json({ data: serializeVenta(venta) }, 201);
        });
    });
