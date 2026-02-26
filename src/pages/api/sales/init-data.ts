import type { APIRoute } from "astro";
import { getAuthenticatedSupabase } from "../../../lib/supabase";

export const GET: APIRoute = async ({ cookies }) => {
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
    // Supabase doesn't have a distinct() modifier easily on select(), so we fetch all channels 
    // and dedup in JS, or use a view if available. For now, fetch distinct via a trick or just fetch a sample.
    // Better approach: fetch from 'ventas' select 'canal'. This might be heavy if many sales.
    // Alternative: create a view for unique channels or use rpc.
    // Given constraints, I'll fetch unique channels via a specialized query if possible, or just raw.
    // Actually, let's just fetch all and dedup for now, assuming volume isn't huge yet.
    const { data: channels, error: channelsError } = await supabase
        .from("ventas")
        .select("canal")
        .order("canal");

    if (channelsError) {
        // Non-fatal, just return empty list
        console.error("Error fetching channels:", channelsError);
    }

    const uniqueChannels = channels
        ? [...new Set(channels.map((c) => c.canal))].sort()
        : [];

    return new Response(
        JSON.stringify({
            products: products.map((p) => ({
                id: p.producto_id,
                name: p.nombre_producto,
                price: p.venta_ud, // Use the last calculated unit selling price as default
                stock: p.stock_actual,
            })),
            channels: uniqueChannels,
        }),
        { status: 200 }
    );
};
