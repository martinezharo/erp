import type { APIRoute } from "astro";
import {
    backendError,
    demoResponse,
    jsonResponse,
    parsePositiveInteger,
    sessionBackend,
    unauthorizedResponse,
} from "../../../lib/legacy-api";
import { isDemoMode } from "../../../lib/supabase";

export const PUT: APIRoute = async (context) => {
    if (isDemoMode) return demoResponse(context);
    const session = await sessionBackend(context);
    if (!session) return unauthorizedResponse();

    try {
        const body = await context.request.json() as {
            id?: unknown;
            date?: unknown;
            channel?: unknown;
            projectId?: unknown;
            items?: Array<{ productId: number; units: number; price: number; tax?: number }>;
        };
        const id = parsePositiveInteger(body.id);
        const projectId = parsePositiveInteger(body.projectId);
        if (
            id === null ||
            projectId === null ||
            typeof body.date !== "string" ||
            !body.date ||
            typeof body.channel !== "string" ||
            !body.channel ||
            !Array.isArray(body.items) ||
            body.items.length === 0
        ) {
            return jsonResponse({ error: "Missing required fields" }, 400);
        }

        await session.backend.updateSale(id, {
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
