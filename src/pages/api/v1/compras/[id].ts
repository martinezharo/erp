import type { APIRoute } from "astro";
import { requireBackend, type Principal } from "../../../../lib/api/auth";
import { ApiError } from "../../../../lib/api/errors";
import { apiHandler, json, parseBody } from "../../../../lib/api/handler";
import { actualizarCompraSchema } from "../../../../lib/api/schemas";
import { serializeCompra } from "../../../../lib/api/serializers";

function parseId(raw: string | undefined): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError("validation_error", "El id de la compra debe ser un entero positivo.");
    }
    return id;
}

async function fetchCompra(principal: Principal, id: number) {
    const data = await requireBackend(principal).getPurchase(id);
    if (!data) throw new ApiError("not_found", `Compra ${id} no encontrada.`);
    return data;
}

/** GET /api/v1/compras/{id} */
export const GET: APIRoute = (context) =>
    apiHandler(context, "read", async (principal) => {
        const id = parseId(context.params.id);
        return json({ data: serializeCompra(await fetchCompra(principal, id)) });
    });

/** PATCH /api/v1/compras/{id} - typically to mark a purchase as `recibida`. */
export const PATCH: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const id = parseId(context.params.id);
        const body = await parseBody(context.request, actualizarCompraSchema);

        await fetchCompra(principal, id);

        await requireBackend(principal).updatePurchase(id, {
            date: body.fecha,
            status: body.estado,
            items: body.items?.map((item) => ({
                productId: item.producto_id,
                units: item.unidades,
                unitPrice: item.precio_unitario,
                vatRate: item.porcentaje_iva,
            })),
        });

        return json({ data: serializeCompra(await fetchCompra(principal, id)) });
    });
