import type { APIRoute } from "astro";
import { requireBackend } from "../../../../lib/api/auth";
import { ApiError } from "../../../../lib/api/errors";
import { apiHandler, json, parseBody, withIdempotency } from "../../../../lib/api/handler";
import { ajustarStockSchema } from "../../../../lib/api/schemas";

/**
 * POST /api/v1/stock/ajustes
 *
 * Records a manual stock correction (breakage, inventory count, a gift).
 * Movements tied to sales and purchases are written by database triggers, so
 * this endpoint only ever produces `ajuste manual` rows — note the space in that
 * enum value, which is a well-known trap when writing SQL against this schema by
 * hand.
 */
export const POST: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const body = await parseBody(context.request, ajustarStockSchema);

        const producto = await requireBackend(principal).getProductGlobal(body.producto_id);
        if (!producto) {
            throw new ApiError("validation_error", `El producto ${body.producto_id} no existe.`, {
                details: [{ field: "producto_id", message: "No encontrado." }],
                hint: "Consulta GET /api/v1/productos para ver los ids disponibles.",
            });
        }

        return withIdempotency(context, principal, "POST /api/v1/stock/ajustes", body, async () => {
            const data = await requireBackend(principal).adjustStock({
                projectId: producto.proyecto_id,
                productId: body.producto_id,
                units: body.unidades,
                date: body.fecha ?? new Date().toISOString(),
            });
            return json({ data: { ...data, producto: producto.nombre } }, 201);
        });
    });
