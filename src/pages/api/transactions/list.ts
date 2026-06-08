import type { APIRoute } from "astro";
import { getAuthenticatedSupabase, isDemoMode } from "../../../lib/supabase";

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

export const GET: APIRoute = async ({ request, cookies }) => {
    if (isDemoMode) {
        // The detailed/individual transactions are not available in demo mode
        // (see api/transactions/details.ts), so the list is empty here too.
        return new Response(
            JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }),
            { status: 200 },
        );
    }

    const supabase = getAuthenticatedSupabase(cookies);
    const url = new URL(request.url);

    const projectId = url.searchParams.get("projectId");
    const type = url.searchParams.get("type") || ""; // venta | compra | ingreso | gasto | ""
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const channel = url.searchParams.get("channel") || "";
    const dateFrom = url.searchParams.get("dateFrom") || "";
    const dateTo = url.searchParams.get("dateTo") || "";
    const amountMinRaw = url.searchParams.get("amountMin");
    const amountMaxRaw = url.searchParams.get("amountMax");
    const amountMin = amountMinRaw !== null && amountMinRaw !== "" ? parseFloat(amountMinRaw) : null;
    const amountMax = amountMaxRaw !== null && amountMaxRaw !== "" ? parseFloat(amountMaxRaw) : null;

    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20")));

    if (!projectId) {
        return new Response(JSON.stringify({ error: "Missing projectId" }), {
            status: 400,
        });
    }

    // A non-empty channel that isn't the sales channels excludes that source.
    const wantSales = (type === "" || type === "venta") &&
        (channel === "" || (channel !== PURCHASE_CHANNEL && channel !== OTHER_CHANNEL));
    const wantPurchases = (type === "" || type === "compra") &&
        (channel === "" || channel === PURCHASE_CHANNEL);
    const wantOthers = (type === "" || type === "ingreso" || type === "gasto") &&
        (channel === "" || channel === OTHER_CHANNEL);

    const normalized: NormalizedTransaction[] = [];

    // 1. Sales (Ventas)
    if (wantSales) {
        let q = supabase
            .from("ventas")
            .select(`
                id,
                fecha,
                canal,
                estado,
                venta_detalle (
                    unidades,
                    precio_unitario_venta,
                    producto:vista_stock_final(nombre_producto)
                )
            `)
            .eq("proyecto_id", projectId);

        if (dateFrom) q = q.gte("fecha", dateFrom);
        if (dateTo) q = q.lte("fecha", dateTo);
        if (channel) q = q.eq("canal", channel);

        const { data: ventas, error } = await q;
        if (error) {
            console.error(error);
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }

        ventas?.forEach((v: any) => {
            let totalUnits = 0;
            let totalAmount = 0;
            const productNames: string[] = [];
            v.venta_detalle.forEach((d: any) => {
                totalUnits += d.unidades;
                totalAmount += d.unidades * d.precio_unitario_venta;
                const pName = d.producto?.nombre_producto || d.producto?.nombre || "Producto desconocido";
                if (!productNames.includes(pName)) productNames.push(pName);
            });
            normalized.push({
                id: v.id,
                type: "venta",
                date: v.fecha,
                concept: productNames.join(", "),
                units: totalUnits,
                amount: totalAmount,
                channel: v.canal,
                status: v.estado,
            });
        });
    }

    // 2. Purchases (Compras)
    if (wantPurchases) {
        let q = supabase
            .from("compras")
            .select(`
                id,
                fecha,
                estado,
                compra_detalle (
                    unidades,
                    precio_unitario_compra,
                    producto:productos(nombre)
                )
            `)
            .eq("proyecto_id", projectId);

        if (dateFrom) q = q.gte("fecha", dateFrom);
        if (dateTo) q = q.lte("fecha", dateTo);

        const { data: compras, error } = await q;
        if (error) {
            console.error(error);
        } else {
            compras?.forEach((c: any) => {
                let totalUnits = 0;
                let totalAmount = 0;
                const productNames: string[] = [];
                c.compra_detalle.forEach((d: any) => {
                    totalUnits += d.unidades;
                    totalAmount += d.unidades * d.precio_unitario_compra;
                    const pName = d.producto?.nombre || "Producto desconocido";
                    if (!productNames.includes(pName)) productNames.push(pName);
                });
                normalized.push({
                    id: c.id,
                    type: "compra",
                    date: c.fecha,
                    concept: productNames.join(", "),
                    units: totalUnits,
                    amount: totalAmount * -1,
                    channel: PURCHASE_CHANNEL,
                    status: c.estado,
                });
            });
        }
    }

    // 3. Other income / expenses
    if (wantOthers) {
        let q = supabase
            .from("otros_ingresos_gastos")
            .select("*")
            .eq("proyecto_id", projectId);

        if (dateFrom) q = q.gte("fecha", dateFrom);
        if (dateTo) q = q.lte("fecha", dateTo);
        if (type === "ingreso" || type === "gasto") q = q.eq("tipo", type);

        const { data: otros, error } = await q;
        if (error) {
            console.error(error);
        } else {
            otros?.forEach((o: any) => {
                normalized.push({
                    id: o.id,
                    type: o.tipo === "gasto" ? "gasto" : "ingreso",
                    date: o.fecha,
                    concept: o.concepto,
                    units: 1,
                    amount: o.tipo === "gasto" ? -Math.abs(o.importe) : Math.abs(o.importe),
                    channel: OTHER_CHANNEL,
                    status: "completado",
                });
            });
        }
    }

    // In-memory filtering for derived fields (concept text + signed amount).
    let filtered = normalized;
    if (search) {
        filtered = filtered.filter((tx) => tx.concept.toLowerCase().includes(search));
    }
    if (amountMin !== null && !Number.isNaN(amountMin)) {
        filtered = filtered.filter((tx) => tx.amount >= amountMin);
    }
    if (amountMax !== null && !Number.isNaN(amountMax)) {
        filtered = filtered.filter((tx) => tx.amount <= amountMax);
    }

    // Sort by date desc, then id desc (stable, matches the daily-view ordering).
    filtered.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return b.id - a.id;
    });

    const total = filtered.length;
    const from = (page - 1) * pageSize;
    const items = filtered.slice(from, from + pageSize);

    return new Response(
        JSON.stringify({ items, total, page, pageSize }),
        { status: 200 },
    );
};
