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
            projectId?: unknown;
            date?: unknown;
            estado?: unknown;
            items?: Array<{ productId: number; units: number; unitPrice: number; tax?: number }>;
        };
        const id = parsePositiveInteger(body.id);
        const projectId = parsePositiveInteger(body.projectId);
        if (
            id === null ||
            projectId === null ||
            typeof body.date !== "string" ||
            !body.date ||
            !Array.isArray(body.items) ||
            body.items.length === 0
        ) {
            return jsonResponse({ error: "Missing required fields" }, 400);
        }

        await session.backend.updatePurchase(id, {
            date: body.date,
            ...(typeof body.estado === "string" ? { status: body.estado } : {}),
            items: body.items.map((item) => ({
                productId: item.productId,
                units: item.units,
                unitPrice: item.unitPrice,
                vatRate: item.tax ?? 21,
            })),
        });
        return jsonResponse({ success: true, id });
    } catch (error) {
        return backendError(error);
    }
};
