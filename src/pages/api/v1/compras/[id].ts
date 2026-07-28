import type { APIRoute } from "astro";
import { assertProjectAccess, type Principal } from "../../../../lib/api/auth";
import { ApiError, fromPostgresError } from "../../../../lib/api/errors";
import { apiHandler, json, parseBody } from "../../../../lib/api/handler";
import { actualizarCompraSchema } from "../../../../lib/api/schemas";
import { serializeCompra } from "../../../../lib/api/serializers";
import { COMPRA_SELECT } from "../compras";

function parseId(raw: string | undefined): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError("validation_error", "El id de la compra debe ser un entero positivo.");
    }
    return id;
}

async function fetchCompra(principal: Principal, id: number) {
    const { data, error } = await principal.supabase
        .from("compras")
        .select(COMPRA_SELECT)
        .eq("id", id)
        .maybeSingle();

    if (error) throw new ApiError("internal_error", error.message);
    if (!data) throw new ApiError("not_found", `Compra ${id} no encontrada.`);

    assertProjectAccess(principal, (data as { proyecto_id: number }).proyecto_id);
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

        const { error } = await principal.supabase.rpc("actualizar_compra", {
            p_compra_id: id,
            p_fecha: body.fecha ?? null,
            p_estado: body.estado ?? null,
            p_items: body.items ?? null,
        });

        if (error) throw fromPostgresError(error);

        return json({ data: serializeCompra(await fetchCompra(principal, id)) });
    });
