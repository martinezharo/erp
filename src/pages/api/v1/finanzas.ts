import type { APIRoute } from "astro";
import { z } from "zod";
import { resolveProjectId } from "../../../lib/api/auth";
import { ApiError } from "../../../lib/api/errors";
import { apiHandler, json, parseQuery } from "../../../lib/api/handler";
import { fechaSchema } from "../../../lib/api/schemas";
import { serializeFinanzas } from "../../../lib/api/serializers";

const finanzasQuerySchema = z.object({
    proyecto_id: z.coerce.number().int().positive().optional(),
    desde: fechaSchema.optional(),
    hasta: fechaSchema.optional(),
    /** Daily breakdown is the default; `resumen` returns only the totals. */
    detalle: z.enum(["diario", "resumen"]).default("diario"),
});

const MAX_DIAS = 366;

/**
 * GET /api/v1/finanzas
 *
 * Reads `vista_finanzas_diarias`, which already reconciles sales, purchases and
 * other movements, honouring the states that should not count (a `devuelta` sale
 * contributes nothing). Totals are computed over the requested window so a
 * report or a weekly digest needs a single call.
 */
export const GET: APIRoute = (context) =>
    apiHandler(context, "read", async (principal) => {
        const query = parseQuery(context.url, finanzasQuerySchema);
        const projectId = resolveProjectId(principal, query.proyecto_id);

        let q = principal.supabase
            .from("vista_finanzas_diarias")
            .select("*")
            .eq("proyecto_id", projectId)
            .order("dia", { ascending: true })
            .limit(MAX_DIAS);

        if (query.desde) q = q.gte("dia", query.desde.slice(0, 10));
        if (query.hasta) q = q.lte("dia", query.hasta.slice(0, 10));

        const { data, error } = await q;
        if (error) throw new ApiError("internal_error", error.message);

        const dias = (data ?? []).map(serializeFinanzas);
        const sum = (key: keyof (typeof dias)[number]) =>
            Math.round(dias.reduce((acc, d) => acc + (d[key] as number), 0) * 100) / 100;

        const totales = {
            ingresos: sum("ingresos"),
            gastos: sum("gastos"),
            balance: sum("balance"),
            beneficio_neto: sum("beneficio_neto"),
            iva_soportado: sum("iva_soportado"),
            iva_repercutido: sum("iva_repercutido"),
            saldo_iva: sum("saldo_iva"),
            dias_con_actividad: dias.length,
        };

        return json({
            data: query.detalle === "resumen" ? undefined : dias,
            totales,
            periodo: {
                desde: query.desde?.slice(0, 10) ?? dias[0]?.dia ?? null,
                hasta: query.hasta?.slice(0, 10) ?? dias[dias.length - 1]?.dia ?? null,
            },
        });
    });
