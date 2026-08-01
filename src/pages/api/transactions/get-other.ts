import type { APIRoute } from "astro";
import { backendError, demoResponse, jsonResponse, sessionBackend, unauthorizedResponse } from "../../../lib/legacy-api";
import { isDemoMode } from "../../../lib/supabase";

export const GET: APIRoute = async (context) => {
    if (isDemoMode) return demoResponse(context);
    const session = await sessionBackend(context);
    if (!session) return unauthorizedResponse();

    const id = Number(context.url.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return jsonResponse({ error: "Missing id" }, 400);

    try {
        const data = await session.backend.getTransaction(id);
        if (!data) return jsonResponse({ error: "Transaction not found" }, 404);
        return jsonResponse(data);
    } catch (error) {
        return backendError(error);
    }
};
