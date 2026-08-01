import type { APIContext } from "astro";
import type { ZodType } from "zod";
import { resolvePrincipal, requireScope, type Principal } from "./auth";
import { ApiError, fromConvexError, fromZodError } from "./errors";
import type { Scope } from "./keys";

export const OPENAPI_PATH = "/api/v1/openapi.json";

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
    });
}

/**
 * Wraps a route: resolves the caller, checks the scope, and converts anything
 * thrown into the standard error envelope. Handlers can therefore `throw new
 * ApiError(...)` anywhere instead of threading response objects around.
 */
export async function apiHandler(
    context: APIContext,
    scope: Scope,
    fn: (principal: Principal) => Promise<Response>,
): Promise<Response> {
    try {
        const principal = await resolvePrincipal(context);
        requireScope(principal, scope);
        return await fn(principal);
    } catch (error) {
        if (error instanceof ApiError) {
            return error.toResponse();
        }

        const convexError = fromConvexError(error);
        if (convexError) return convexError.toResponse();

        console.error("[api/v1] unhandled error:", error);
        return new ApiError(
            "internal_error",
            error instanceof Error ? error.message : "Error interno.",
        ).toResponse();
    }
}

/** Parses and validates a JSON body, reporting bad JSON as a validation error. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        throw new ApiError("validation_error", "El cuerpo debe ser JSON valido.", {
            hint: "Envia 'Content-Type: application/json' con un objeto JSON en el cuerpo.",
        });
    }

    const result = schema.safeParse(raw);
    if (!result.success) throw fromZodError(result.error);
    return result.data;
}

/** Same, for query strings. */
export function parseQuery<T>(url: URL, schema: ZodType<T>): T {
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
        if (value !== "") params[key] = value;
    });

    const result = schema.safeParse(params);
    if (!result.success) throw fromZodError(result.error);
    return result.data;
}

/** Stable stringify so key order in the request body doesn't change the hash. */
function canonicalize(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(",")}}`;
}

async function hashRequest(endpoint: string, body: unknown): Promise<string> {
    const data = new TextEncoder().encode(`${endpoint}\n${canonicalize(body)}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Marks a reservation row as still in flight; see the state machine below. */
const IN_FLIGHT = 0;

/**
 * Makes a write safe to retry.
 *
 * Without this, an agent whose request times out has no way to know whether the
 * sale was recorded, and retrying risks booking it twice. With an
 * `Idempotency-Key` header the first successful response is stored and replayed
 * for every repeat of that key.
 *
 * The flow reserves the key *before* doing the work, so two requests racing on
 * the same key cannot both write:
 *
 *   - reservation inserted  -> we own it: run the handler, store the result
 *   - key already exists    -> in flight (409), payload differs (422), or replay
 *
 * Failed attempts release the reservation so the same key can be retried.
 */
export async function withIdempotency(
    context: APIContext,
    principal: Principal,
    endpoint: string,
    body: unknown,
    fn: () => Promise<Response>,
): Promise<Response> {
    const idempotencyKey = context.request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey) {
        return fn();
    }

    const requestHash = await hashRequest(endpoint, body);
    if (principal.backend) {
        return withConvexIdempotency(principal, idempotencyKey, endpoint, requestHash, fn);
    }

    const { supabase } = principal;
    if (!supabase) {
        throw new ApiError("not_configured", "No hay un backend de datos configurado.");
    }

    const { error: insertError } = await supabase.from("idempotency_keys").insert({
        idempotency_key: idempotencyKey,
        api_key_id: principal.apiKeyId,
        endpoint,
        request_hash: requestHash,
        response_status: IN_FLIGHT,
        response_body: {},
    });

    if (insertError) {
        if (insertError.code !== "23505") {
            throw new ApiError(
                "internal_error",
                `No se pudo registrar la clave de idempotencia: ${insertError.message}`,
            );
        }

        const { data: existing } = await supabase
            .from("idempotency_keys")
            .select("request_hash, response_status, response_body")
            .eq("idempotency_key", idempotencyKey)
            .eq("endpoint", endpoint)
            .maybeSingle();

        if (!existing) {
            // Deleted between the failed insert and this read (a concurrent
            // attempt failed and released it). Retrying is safe.
            throw new ApiError("conflict", "Conflicto al reservar la clave de idempotencia. Reintenta.");
        }

        if (existing.request_hash !== requestHash) {
            throw new ApiError(
                "idempotency_mismatch",
                "Esta 'Idempotency-Key' ya se uso con un cuerpo distinto.",
                { hint: "Usa una clave nueva para cada operacion distinta." },
            );
        }

        if (existing.response_status === IN_FLIGHT) {
            throw new ApiError(
                "conflict",
                "Ya hay una peticion en curso con esta 'Idempotency-Key'.",
                { hint: "Espera a que termine antes de reintentar." },
            );
        }

        return json(existing.response_body, existing.response_status, {
            "Idempotency-Replayed": "true",
        });
    }

    let response: Response;
    try {
        response = await fn();
    } catch (error) {
        await releaseKey(principal, idempotencyKey, endpoint);
        throw error;
    }

    // Only successful outcomes are worth replaying. Releasing the key on failure
    // lets the caller fix the payload and retry with the same key.
    if (!response.ok) {
        await releaseKey(principal, idempotencyKey, endpoint);
        return response;
    }

    const stored = await response.clone().json().catch(() => ({}));
    await supabase
        .from("idempotency_keys")
        .update({ response_status: response.status, response_body: stored })
        .eq("idempotency_key", idempotencyKey)
        .eq("endpoint", endpoint);

    return response;
}

async function releaseKey(principal: Principal, key: string, endpoint: string): Promise<void> {
    if (principal.backend) {
        await principal.backend.releaseIdempotency(key, endpoint);
        return;
    }

    if (principal.supabase) {
        await principal.supabase
            .from("idempotency_keys")
            .delete()
            .eq("idempotency_key", key)
            .eq("endpoint", endpoint);
    }
}

async function withConvexIdempotency(
    principal: Principal,
    key: string,
    endpoint: string,
    requestHash: string,
    fn: () => Promise<Response>,
): Promise<Response> {
    const backend = principal.backend!;
    const reservation = await backend.reserveIdempotency(key, endpoint, requestHash);

    if (reservation.status === "mismatch") {
        throw new ApiError(
            "idempotency_mismatch",
            "Esta 'Idempotency-Key' ya se uso con un cuerpo distinto.",
            { hint: "Usa una clave nueva para cada operacion distinta." },
        );
    }

    if (reservation.status === "in_flight") {
        throw new ApiError(
            "conflict",
            "Ya hay una peticion en curso con esta 'Idempotency-Key'.",
            { hint: "Espera a que termine antes de reintentar." },
        );
    }

    if (reservation.status === "replay") {
        return json(reservation.responseBody, reservation.responseStatus, {
            "Idempotency-Replayed": "true",
        });
    }

    let response: Response;
    try {
        response = await fn();
    } catch (error) {
        await releaseKey(principal, key, endpoint);
        throw error;
    }

    if (!response.ok) {
        await releaseKey(principal, key, endpoint);
        return response;
    }

    const stored = await response.clone().json().catch(() => ({}));
    await backend.completeIdempotency(key, endpoint, response.status, stored);
    return response;
}
