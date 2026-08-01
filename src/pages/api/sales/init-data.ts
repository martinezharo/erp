import type { APIRoute } from "astro";
import { mockStock } from "../../../lib/mock-data";
import { backendError, jsonResponse, sessionBackend, unauthorizedResponse } from "../../../lib/legacy-api";
import { isDemoMode } from "../../../lib/supabase";

export const GET: APIRoute = async (context) => {
    if (isDemoMode) {
        return jsonResponse({
            products: mockStock.map((product) => ({
                id: product.producto_id,
                name: product.nombre_producto,
                price: product.venta_ud,
                stock: product.stock_actual,
            })),
            channels: ["Amazon", "Wallapop", "Web", "MilanUncios"],
        });
    }

    const session = await sessionBackend(context);
    if (!session) return unauthorizedResponse();
    try {
        return jsonResponse(await session.backend.salesInitData());
    } catch (error) {
        return backendError(error);
    }
};
