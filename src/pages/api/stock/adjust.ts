import type { APIRoute } from "astro";
import { backendError, demoResponse, jsonResponse, sessionBackend, unauthorizedResponse } from "../../../lib/legacy-api";
import { isDemoMode } from "../../../lib/supabase";

export const POST: APIRoute = async (context) => {
    if (isDemoMode) return demoResponse(context);
    const session = await sessionBackend(context);
    if (!session) return unauthorizedResponse();

    try {
        const body = await context.request.json() as {
            productId?: number;
            units?: number;
            date?: string;
        };
        if (!body.productId || body.units === undefined || !body.date) {
            return jsonResponse({ error: "Missing required fields" }, 400);
        }
        const product = await session.backend.getProductGlobal(body.productId);
        if (!product) return jsonResponse({ error: "Product not found" }, 404);
        const data = await session.backend.adjustStock({
            projectId: product.proyecto_id,
            productId: body.productId,
            units: body.units,
            date: body.date,
        });
        return jsonResponse({ success: true, data });
    } catch (error) {
        return backendError(error);
    }
};
