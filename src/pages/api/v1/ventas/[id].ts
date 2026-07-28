import type { APIRoute } from "astro";
import { assertProjectAccess, type Principal } from "../../../../lib/api/auth";
import { ApiError, fromPostgresError } from "../../../../lib/api/errors";
import { apiHandler, json, parseBody } from "../../../../lib/api/handler";
import { actualizarVentaSchema } from "../../../../lib/api/schemas";
import { serializeVenta } from "../../../../lib/api/serializers";
import { VENTA_SELECT } from "../ventas";

function parseId(raw: string | undefined): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError("validation_error", "El id de la venta debe ser un entero positivo.");
    }
    return id;
}

async function fetchVenta(principal: Principal, id: number) {
    const { data, error } = await principal.supabase
        .from("ventas")
        .select(VENTA_SELECT)
        .eq("id", id)
        .maybeSingle();

    if (error) throw new ApiError("internal_error", error.message);
    if (!data) throw new ApiError("not_found", `Venta ${id} no encontrada.`);

    assertProjectAccess(principal, (data as { proyecto_id: number }).proyecto_id);
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

        const { error } = await principal.supabase.rpc("actualizar_venta", {
            p_venta_id: id,
            p_fecha: body.fecha ?? null,
            p_canal: body.canal ?? null,
            p_estado: body.estado ?? null,
            p_items: body.items ?? null,
        });

        if (error) throw fromPostgresError(error);

        return json({ data: serializeVenta(await fetchVenta(principal, id)) });
    });
