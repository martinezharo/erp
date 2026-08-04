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

const PURCHASE_CHANNEL = "Proveedor";
const OTHER_CHANNEL = "Manual";

function optionalAmount(value: string | null): number | undefined {
    if (value === null || value.trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function saleTransaction(row: Record<string, unknown>): NormalizedTransaction {
    const details = (row.venta_detalle as Array<Record<string, unknown>> | undefined) ?? [];
    const names = details
        .map((detail) => (detail.producto as { nombre?: string } | null)?.nombre ?? "Producto desconocido")
        .filter((name, index, all) => all.indexOf(name) === index);
    return {
        id: Number(row.id),
        type: "venta",
        date: String(row.fecha),
        concept: names.join(", "),
        units: details.reduce((sum, detail) => sum + Number(detail.unidades ?? 0), 0),
        amount: details.reduce((sum, detail) => sum + Number(detail.unidades ?? 0) * Number(detail.precio_unitario_venta ?? 0), 0),
        channel: String(row.canal ?? ""),
        status: String(row.estado ?? ""),
    };
}

function purchaseTransaction(row: Record<string, unknown>): NormalizedTransaction {
    const details = (row.compra_detalle as Array<Record<string, unknown>> | undefined) ?? [];
    const names = details
        .map((detail) => (detail.producto as { nombre?: string } | null)?.nombre ?? "Producto desconocido")
        .filter((name, index, all) => all.indexOf(name) === index);
    return {
        id: Number(row.id),
        type: "compra",
        date: String(row.fecha),
        concept: names.join(", "),
        units: details.reduce((sum, detail) => sum + Number(detail.unidades ?? 0), 0),
        amount: -details.reduce((sum, detail) => sum + Number(detail.unidades ?? 0) * Number(detail.precio_unitario_compra ?? 0), 0),
        channel: PURCHASE_CHANNEL,
        status: String(row.estado ?? ""),
    };
}

export const GET: APIRoute = async (context) => {
    if (isDemoMode) return jsonResponse({ items: [], total: 0, page: 1, pageSize: 20 });
    const session = await sessionBackend(context);
    if (!session) return unauthorizedResponse();

    const projectId = Number(context.url.searchParams.get("projectId"));
    if (!Number.isInteger(projectId) || projectId <= 0) return jsonResponse({ error: "Missing projectId" }, 400);

    const type = context.url.searchParams.get("type") || "";
    const search = (context.url.searchParams.get("search") || "").trim().toLowerCase();
    const channel = context.url.searchParams.get("channel") || "";
    const dateFrom = context.url.searchParams.get("dateFrom") || undefined;
    const dateTo = context.url.searchParams.get("dateTo") || undefined;
    const amountMin = optionalAmount(context.url.searchParams.get("amountMin"));
    const amountMax = optionalAmount(context.url.searchParams.get("amountMax"));
    const page = Math.max(1, Number.parseInt(context.url.searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(context.url.searchParams.get("pageSize") || "20", 10)));

    try {
        const sources = await session.backend.transactionSources({ projectId, fromDate: dateFrom, toDate: dateTo ? `${dateTo}T23:59:59` : undefined });
        const wantSales = (type === "" || type === "venta") && (channel === "" || (channel !== PURCHASE_CHANNEL && channel !== OTHER_CHANNEL));
        const wantPurchases = (type === "" || type === "compra") && (channel === "" || channel === PURCHASE_CHANNEL);
        const wantOthers = (type === "" || type === "ingreso" || type === "gasto") && (channel === "" || channel === OTHER_CHANNEL);

        let normalized: NormalizedTransaction[] = [];
        if (wantSales) normalized = normalized.concat(sources.sales.filter((sale) => !channel || String(sale.canal) === channel).map(saleTransaction));
        if (wantPurchases) normalized = normalized.concat(sources.purchases.map(purchaseTransaction));
        if (wantOthers) {
            normalized = normalized.concat(sources.others
                .filter((other) => type !== "ingreso" && type !== "gasto" || String(other.tipo) === type)
                .map((other) => ({
                    id: Number(other.id),
                    type: String(other.tipo),
                    date: String(other.fecha),
                    concept: String(other.concepto),
                    units: 1,
                    amount: String(other.tipo) === "gasto" ? -Math.abs(Number(other.importe)) : Math.abs(Number(other.importe)),
                    channel: OTHER_CHANNEL,
                    status: "completado",
                })));
        }

        let filtered = normalized;
        if (search) filtered = filtered.filter((tx) => tx.concept.toLowerCase().includes(search));
        if (amountMin !== undefined) filtered = filtered.filter((tx) => tx.amount >= amountMin);
        if (amountMax !== undefined) filtered = filtered.filter((tx) => tx.amount <= amountMax);
        filtered.sort((a, b) => a.date !== b.date ? b.date.localeCompare(a.date) : b.id - a.id);

        const total = filtered.length;
        const from = (page - 1) * pageSize;
        return jsonResponse({ items: filtered.slice(from, from + pageSize), total, page, pageSize });
    } catch (error) {
        return backendError(error);
    }
};
