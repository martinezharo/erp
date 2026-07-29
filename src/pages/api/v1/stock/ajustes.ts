import type { APIRoute } from "astro";
import { assertProjectAccess } from "../../../../lib/api/auth";
import { ApiError, fromPostgresError } from "../../../../lib/api/errors";
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

        const { data: producto, error: productoError } = await principal.supabase
            .from("productos")
            .select("id, proyecto_id, nombre")
            .eq("id", body.producto_id)
            .maybeSingle();

        if (productoError) throw new ApiError("internal_error", productoError.message);
        if (!producto) {
            throw new ApiError("validation_error", `El producto ${body.producto_id} no existe.`, {
                details: [{ field: "producto_id", message: "No encontrado." }],
                hint: "Consulta GET /api/v1/productos para ver los ids disponibles.",
            });
        }

        assertProjectAccess(principal, producto.proyecto_id);

        return withIdempotency(context, principal, "POST /api/v1/stock/ajustes", body, async () => {
            const { data, error } = await principal.supabase
                .from("movimientos_stock")
                .insert({
                    producto_id: body.producto_id,
                    unidades: body.unidades,
                    tipo_movimiento: "ajuste manual",
                    ...(body.fecha ? { fecha: body.fecha } : {}),
                })
                .select("id, producto_id, unidades, tipo_movimiento, fecha")
                .single();

            if (error) throw fromPostgresError(error);

            return json({ data: { ...data, producto: producto.nombre } }, 201);
        });
    });
