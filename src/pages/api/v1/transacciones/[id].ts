import type { APIRoute } from "astro";
import { requireBackend, type Principal } from "../../../../lib/api/auth";
import { ApiError } from "../../../../lib/api/errors";
import { apiHandler, json, parseBody } from "../../../../lib/api/handler";
import { actualizarTransaccionSchema } from "../../../../lib/api/schemas";
import { serializeTransaccion } from "../../../../lib/api/serializers";

function parseId(raw: string | undefined): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError("validation_error", "El id debe ser un entero positivo.");
    }
    return id;
}

async function fetchTransaccion(principal: Principal, id: number) {
    const data = await requireBackend(principal).getTransaction(id);
    if (!data) throw new ApiError("not_found", `Transaccion ${id} no encontrada.`);
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

        await requireBackend(principal).updateTransaction(id, {
            type: body.tipo,
            concept: body.concepto,
            description: body.descripcion,
            amount: body.importe,
            vatRate: body.porcentaje_iva,
            date: body.fecha,
        });
        return json({ data: serializeTransaccion(await fetchTransaccion(principal, id)) });
    });

export const DELETE: APIRoute = (context) =>
    apiHandler(context, "write", async (principal) => {
        const id = parseId(context.params.id);
        await fetchTransaccion(principal, id);

        await requireBackend(principal).deleteTransaction(id);
        return json({ data: { id, borrada: true } });
    });
