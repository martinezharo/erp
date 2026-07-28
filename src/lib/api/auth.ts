import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import { isDemoMode } from "../supabase";
import {
    getEnv,
    SUPABASE_PUBLIC_KEY_VARS,
    SUPABASE_SECRET_KEY_VARS,
    SUPABASE_URL_VARS,
} from "./env";
import { ApiError } from "./errors";
import { extractApiKey, hashApiKey, type Scope } from "./keys";

/**
 * Who is making the request.
 *
 * Two kinds of caller reach the v1 API. A browser session (the ERP's own UI,
 * authenticated by the Supabase cookies the middleware already handles) has
 * access to every project. An API key is the machine path: it carries explicit
 * scopes and is usually pinned to one project, so an agent given a key for
 * "Proyecto A" cannot touch "Proyecto B" even if it asks.
 */
export interface Principal {
    kind: "api_key" | "session";
    scopes: Scope[];
    /** Pinned project, or null when the caller may act on any project. */
    projectId: number | null;
    apiKeyId: string | null;
    supabase: SupabaseClient;
}

/**
 * Privileged client, used only for API-key requests. Those callers have no
 * Supabase user, so there is no session to act under; the scope and project
 * checks in this module are what stands in for row-level security.
 */
function createSecretClient(locals: App.Locals): SupabaseClient {
    const url = getEnv(locals, ...SUPABASE_URL_VARS);
    const secretKey = getEnv(locals, ...SUPABASE_SECRET_KEY_VARS);

    if (!url || !secretKey) {
        throw new ApiError(
            "not_configured",
            "La autenticacion por API key no esta configurada en este despliegue.",
            {
                hint: "Define SUPABASE_SECRET_KEY (sb_secret_...) como secreto del servidor, nunca con prefijo PUBLIC_.",
            },
        );
    }

    return createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

function sessionClient(context: APIContext): SupabaseClient {
    const url = getEnv(context.locals, ...SUPABASE_URL_VARS);
    const publicKey = getEnv(context.locals, ...SUPABASE_PUBLIC_KEY_VARS);

    if (!url || !publicKey) {
        throw new ApiError("not_configured", "Supabase no esta configurado en este despliegue.");
    }

    const client = createClient(url, publicKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    const accessToken = context.cookies.get("sb-access-token")?.value;
    const refreshToken = context.cookies.get("sb-refresh-token")?.value;

    if (accessToken && refreshToken) {
        client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    }

    return client;
}

/** Only touch the database for last-used bookkeeping once a minute per key. */
const LAST_USED_THROTTLE_MS = 60_000;

async function resolveApiKey(context: APIContext, rawKey: string): Promise<Principal> {
    const supabase = createSecretClient(context.locals);
    const keyHash = await hashApiKey(rawKey);

    const { data: apiKey, error } = await supabase
        .from("api_keys")
        .select("id, proyecto_id, scopes, activa, expira_en, ultimo_uso_en")
        .eq("key_hash", keyHash)
        .maybeSingle();

    if (error) {
        throw new ApiError("internal_error", `No se pudo validar la API key: ${error.message}`);
    }

    // Unknown, revoked and expired keys all get the same answer on purpose:
    // telling a caller which one it is leaks whether a key ever existed.
    if (!apiKey || !apiKey.activa) {
        throw new ApiError("unauthorized", "API key invalida o revocada.");
    }

    if (apiKey.expira_en && new Date(apiKey.expira_en).getTime() < Date.now()) {
        throw new ApiError("unauthorized", "API key invalida o revocada.");
    }

    const lastUsed = apiKey.ultimo_uso_en ? new Date(apiKey.ultimo_uso_en).getTime() : 0;
    if (Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
        await supabase
            .from("api_keys")
            .update({ ultimo_uso_en: new Date().toISOString() })
            .eq("id", apiKey.id);
    }

    return {
        kind: "api_key",
        scopes: (apiKey.scopes ?? []) as Scope[],
        projectId: apiKey.proyecto_id ?? null,
        apiKeyId: apiKey.id,
        supabase,
    };
}

async function resolveSession(context: APIContext): Promise<Principal> {
    const supabase = sessionClient(context);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        throw new ApiError("unauthorized", "Se requiere autenticacion.", {
            hint: "Envia 'Authorization: Bearer erp_sk_...' o inicia sesion en la interfaz web.",
        });
    }

    return {
        kind: "session",
        scopes: ["read", "write"],
        projectId: null,
        apiKeyId: null,
        supabase,
    };
}

export async function resolvePrincipal(context: APIContext): Promise<Principal> {
    if (isDemoMode) {
        throw new ApiError("demo_mode", "La API no esta disponible en modo demo.", {
            hint: "Configura PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_PUBLISHABLE_KEY para salir del modo demo.",
        });
    }

    const rawKey = extractApiKey(context.request);
    if (rawKey) {
        return resolveApiKey(context, rawKey);
    }

    return resolveSession(context);
}

export function requireScope(principal: Principal, scope: Scope): void {
    if (!principal.scopes.includes(scope)) {
        throw new ApiError("forbidden", `Esta API key no tiene el permiso '${scope}'.`, {
            hint: `Permisos de la key: ${principal.scopes.join(", ") || "(ninguno)"}.`,
        });
    }
}

/**
 * Reconciles the project the caller asked for with the one its key allows.
 *
 * A pinned key may omit `proyecto_id` entirely — the pin supplies it — but if it
 * names a different project the request is refused rather than silently
 * rewritten, so an agent working from a stale id gets told instead of writing
 * to the wrong books.
 */
export function resolveProjectId(principal: Principal, requested: number | null | undefined): number {
    if (principal.projectId !== null) {
        if (requested != null && requested !== principal.projectId) {
            throw new ApiError(
                "forbidden",
                `Esta API key solo puede operar sobre el proyecto ${principal.projectId}.`,
            );
        }
        return principal.projectId;
    }

    if (requested == null) {
        throw new ApiError("validation_error", "Falta 'proyecto_id'.", {
            details: [{ field: "proyecto_id", message: "Requerido para esta API key (no esta fijada a un proyecto)." }],
            hint: "Lista los proyectos disponibles con GET /api/v1/proyectos",
        });
    }

    return requested;
}

/** Refuses a read of a resource that belongs to a project outside the key's pin. */
export function assertProjectAccess(principal: Principal, projectId: number): void {
    if (principal.projectId !== null && principal.projectId !== projectId) {
        throw new ApiError("not_found", "Recurso no encontrado.");
    }
}
