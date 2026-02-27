import type { APIRoute } from "astro";
import { getAuthenticatedSupabase, isDemoMode } from "../../../lib/supabase";
import { mockStock } from "../../../lib/mock-data";

export const GET: APIRoute = async ({ cookies }) => {
    if (isDemoMode) {
        return new Response(
            JSON.stringify({
                products: mockStock.map((p) => ({
                    id: p.producto_id,
                    name: p.nombre_producto,
                    price: p.venta_ud,
                    stock: p.stock_actual,
                })),
                channels: ["Amazon", "Wallapop", "Web", "MilanUncios"],
            }),
            { status: 200 }
        );
    }

    const supabase = getAuthenticatedSupabase(cookies);

    // 1. Fetch Products with their "base price" (selling price) and current stock
    const { data: products, error: productsError } = await supabase
        .from("vista_stock_final")
        .select("producto_id, nombre_producto, venta_ud, stock_actual")
        .order("nombre_producto");

    if (productsError) {
        return new Response(JSON.stringify({ error: productsError.message }), {
            status: 500,
        });
    }

    // 2. Fetch distinct Channels from past sales
    const { data: channels, error: channelsError } = await supabase
        .from("ventas")
        .select("canal")
        .order("canal");

    if (channelsError) {
        console.error("Error fetching channels:", channelsError);
    }

    const uniqueChannels = channels
        ? [...new Set(channels.map((c: { canal: string }) => c.canal))].sort()
        : [];

    return new Response(
        JSON.stringify({
            products: products.map((p: { producto_id: number; nombre_producto: string; venta_ud: number; stock_actual: number }) => ({
                id: p.producto_id,
                name: p.nombre_producto,
                price: p.venta_ud,
                stock: p.stock_actual,
            })),
            channels: uniqueChannels,
        }),
        { status: 200 }
    );
};
