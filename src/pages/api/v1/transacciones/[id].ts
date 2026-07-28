import type { APIRoute } from "astro";
import { assertProjectAccess, type Principal } from "../../../../lib/api/auth";
import { ApiError, fromPostgresError } from "../../../../lib/api/errors";
import { apiHandler, json, parseBody } from "../../../../lib/api/handler";
import { actualizarTransaccionSchema } from "../../../../lib/api/schemas";
import { serializeTransaccion } from "../../../../lib/api/serializers";
import { TRANSACCION_SELECT } from "../transacciones";

function parseId(raw: string | undefined): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError("validation_error", "El id debe ser un entero positivo.");
    }
    return id;
}

async function fetchTransaccion(principal: Principal, id: number) {
    const { data, error } = await principal.supabase
        .from("otros_ingresos_gastos")
        .select(TRANSACCION_SELECT)
        .eq("id", id)
        .maybeSingle();

    if (error) throw new ApiError("internal_error", error.message);
    if (!data) throw new ApiError("not_found", `Transaccion ${id} no encontrada.`);

    assertProjectAccess(principal, (data as { proyecto_id: number }).proyecto_id);
    return data;
}

export const GET: APIRoute = (context) =>
    apiHandler(context, "read", async (principal) => {
        const id = parseId(context.params.id);
        return json({ data: serializeTransaccion(await fetchTransaccion(principal, id)) });
    });

export const PATCH: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const id = parseId(context.params.id);
        const body = await parseBody(context.request, actualizarTransaccionSchema);

        await fetchTransaccion(principal, id);

        const { data, error } = await principal.supabase
            .from("otros_ingresos_gastos")
            .update(body)
            .eq("id", id)
            .select(TRANSACCION_SELECT)
            .single();

        if (error) throw fromPostgresError(error);
        return json({ data: serializeTransaccion(data) });
    });

export const DELETE: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const id = parseId(context.params.id);
        await fetchTransaccion(principal, id);

        const { error } = await principal.supabase
            .from("otros_ingresos_gastos")
            .delete()
            .eq("id", id);

        if (error) throw fromPostgresError(error);
        return json({ data: { id, borrada: true } });
    });
