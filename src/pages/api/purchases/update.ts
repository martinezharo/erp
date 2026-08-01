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
            projectId?: number;
            date?: string;
            estado?: string;
            items?: Array<{ productId: number; units: number; unitPrice: number; tax?: number }>;
        };
        if (!body.id || !body.projectId || !body.date || !body.items?.length) {
            return jsonResponse({ error: "Missing required fields" }, 400);
        }

        await session.backend.updatePurchase(body.id, {
            date: body.date,
            status: body.estado,
            items: body.items.map((item) => ({
                productId: item.productId,
                units: item.units,
                unitPrice: item.unitPrice,
                vatRate: item.tax ?? 21,
            })),
        });
        return jsonResponse({ success: true, id: body.id });
    } catch (error) {
        return backendError(error);
    }
};
