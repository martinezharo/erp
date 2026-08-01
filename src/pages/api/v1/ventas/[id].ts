import type { APIRoute } from "astro";
import { requireBackend, type Principal } from "../../../../lib/api/auth";
import { ApiError } from "../../../../lib/api/errors";
import { apiHandler, json, parseBody } from "../../../../lib/api/handler";
import { actualizarVentaSchema } from "../../../../lib/api/schemas";
import { serializeVenta } from "../../../../lib/api/serializers";

function parseId(raw: string | undefined): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError("validation_error", "El id de la venta debe ser un entero positivo.");
    }
    return id;
}

async function fetchVenta(principal: Principal, id: number) {
    const data = await requireBackend(principal).getSale(id);
    if (!data) throw new ApiError("not_found", `Venta ${id} no encontrada.`);
    return data;
}

/** GET /api/v1/ventas/{id} */
export const GET: APIRoute = (context) =>
    apiHandler(context, "read", async (principal) => {
        const id = parseId(context.params.id);
        return json({ data: serializeVenta(await fetchVenta(principal, id)) });
    });

/**
 * PATCH /api/v1/ventas/{id}
 *
 * Omitting `items` edits only the header, which is the common case for a status
 * change (e.g. `enviada` -> `devuelta`). Passing `items` replaces every line and
 * its stock movements atomically.
 */
export const PATCH: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const id = parseId(context.params.id);
        const body = await parseBody(context.request, actualizarVentaSchema);

        // Resolve first so a key pinned elsewhere gets 404 before anything runs.
        await fetchVenta(principal, id);

        await requireBackend(principal).updateSale(id, {
            date: body.fecha,
            channel: body.canal,
            status: body.estado,
            items: body.items?.map((item) => ({
                productId: item.producto_id,
                units: item.unidades,
                unitPrice: item.precio_unitario,
                vatRate: item.porcentaje_iva,
            })),
        });

        return json({ data: serializeVenta(await fetchVenta(principal, id)) });
    });
