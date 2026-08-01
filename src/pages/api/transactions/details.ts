import type { APIRoute } from "astro";
import { backendError, jsonResponse, sessionBackend, unauthorizedResponse } from "../../../lib/legacy-api";
import { isDemoMode } from "../../../lib/supabase";

interface NormalizedTransaction {
    id: number;
    type: string;
    date: string;
    concept: string;
    units: number;
    amount: number;
    channel: string;
    status: string;
}

export const GET: APIRoute = async (context) => {
    if (isDemoMode) return jsonResponse([]);
    const session = await sessionBackend(context);
    if (!session) return unauthorizedResponse();

    const date = context.url.searchParams.get("date");
    const projectId = Number(context.url.searchParams.get("projectId"));
    if (!date || !Number.isInteger(projectId) || projectId <= 0) {
        return jsonResponse({ error: "Missing date or projectId" }, 400);
    }

    try {
        const sources = await session.backend.transactionSources({
            projectId,
            fromDate: date,
            toDate: `${date}T23:59:59`,
        });
        const normalized: NormalizedTransaction[] = [];

        for (const sale of sources.sales) {
            const details = (sale.venta_detalle as Array<Record<string, unknown>> | undefined) ?? [];
            const names = details.map((detail) => (detail.producto as { nombre?: string } | null)?.nombre ?? "Producto desconocido");
            normalized.push({
                id: Number(sale.id), type: "venta", date: String(sale.fecha), concept: [...new Set(names)].join(", "),
                units: details.reduce((sum, detail) => sum + Number(detail.unidades ?? 0), 0),
                amount: details.reduce((sum, detail) => sum + Number(detail.unidades ?? 0) * Number(detail.precio_unitario_venta ?? 0), 0),
                channel: String(sale.canal ?? ""), status: String(sale.estado ?? ""),
            });
        }
        for (const purchase of sources.purchases) {
            const details = (purchase.compra_detalle as Array<Record<string, unknown>> | undefined) ?? [];
            const names = details.map((detail) => (detail.producto as { nombre?: string } | null)?.nombre ?? "Producto desconocido");
            normalized.push({
                id: Number(purchase.id), type: "compra", date: String(purchase.fecha), concept: [...new Set(names)].join(", "),
                units: details.reduce((sum, detail) => sum + Number(detail.unidades ?? 0), 0),
                amount: -details.reduce((sum, detail) => sum + Number(detail.unidades ?? 0) * Number(detail.precio_unitario_compra ?? 0), 0),
                channel: "Proveedor", status: String(purchase.estado ?? ""),
            });
        }
        for (const other of sources.others) {
            normalized.push({
                id: Number(other.id), type: String(other.tipo), date: String(other.fecha), concept: String(other.concepto), units: 1,
                amount: String(other.tipo) === "gasto" ? -Math.abs(Number(other.importe)) : Math.abs(Number(other.importe)),
                channel: "Manual", status: "completado",
            });
        }

        normalized.sort((a, b) => b.id - a.id);
        return jsonResponse(normalized);
    } catch (error) {
        return backendError(error);
    }
};
