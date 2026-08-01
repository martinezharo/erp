import type { APIRoute } from "astro";
import { backendError, demoResponse, jsonResponse, sessionBackend, unauthorizedResponse } from "../../../lib/legacy-api";
import { isDemoMode } from "../../../lib/supabase";

export const PUT: APIRoute = async (context) => {
    if (isDemoMode) return demoResponse(context);
    const session = await sessionBackend(context);
    if (!session) return unauthorizedResponse();

    try {
        const body = await context.request.json() as {
            id?: number;
            date?: string;
            channel?: string;
            projectId?: number;
            items?: Array<{ productId: number; units: number; price: number; tax?: number }>;
        };
        if (!body.id || !body.date || !body.channel || !body.projectId || !body.items?.length) {
            return jsonResponse({ error: "Missing required fields" }, 400);
        }

        await session.backend.updateSale(body.id, {
            date: body.date,
            channel: body.channel,
            items: body.items.map((item) => ({
                productId: item.productId,
                units: item.units,
                unitPrice: item.price,
                vatRate: item.tax ?? 21,
            })),
        });
        return jsonResponse({ success: true });
    } catch (error) {
        return backendError(error);
    }
};
