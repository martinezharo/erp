import type { APIRoute } from "astro";
import { backendError, demoResponse, jsonResponse, sessionBackend, unauthorizedResponse } from "../../../lib/legacy-api";
import { isDemoMode } from "../../../lib/supabase";

export const POST: APIRoute = async (context) => {
    if (isDemoMode) return demoResponse(context);

    const session = await sessionBackend(context);
    if (!session) return unauthorizedResponse();

    try {
        const body = await context.request.json() as { projectId?: number; name?: string };
        if (!body.projectId || !body.name?.trim()) {
            return jsonResponse({ error: "Missing required fields" }, 400);
        }
        const data = await session.backend.createProduct(body.projectId, body.name);
        return jsonResponse({ success: true, data });
    } catch (error) {
        return backendError(error);
    }
};
