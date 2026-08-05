import type { APIContext } from "astro";
import { createBackend, type BackendClient } from "./convex";
import { fromConvexError, ApiError } from "./api/errors";
import { isDemoMode } from "./supabase";

export function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

/** Accepts the string ids emitted by HTML dataset attributes and JSON ids. */
export function parsePositiveInteger(value: unknown): number | null {
    const parsed =
        typeof value === "number"
            ? value
            : typeof value === "string" && value.trim() !== ""
              ? Number(value)
              : Number.NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function demoResponse(context: APIContext, emptyBody: unknown = null): Response {
    if (emptyBody !== null) return jsonResponse(emptyBody);
    return jsonResponse({ error: context.locals.t("api.demoUnavailable") }, 403);
}

/** Returns the authenticated user's Convex gateway, or null for a 401. */
export async function sessionBackend(
    context: APIContext,
): Promise<{ backend: BackendClient; userId: string } | null> {
    if (isDemoMode) return null;

    const user = context.locals.user;
    if (!user) return null;

    return {
        backend: createBackend(context.locals, { kind: "session", userId: user.id }),
        userId: user.id,
    };
}

export function unauthorizedResponse(): Response {
    return jsonResponse({ error: "Unauthorized" }, 401);
}

export function backendError(error: unknown): Response {
    if (error instanceof ApiError) return error.toResponse();
    const convexError = fromConvexError(error);
    if (convexError) return convexError.toResponse();
    return jsonResponse({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
}
