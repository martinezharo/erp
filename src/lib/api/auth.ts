import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import { createBackend, type BackendClient } from "../convex";
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
 * Convex is now the data and authorization layer. Supabase is kept in this
 * module only as the password/session provider until the existing users have
 * been moved to a JWT provider understood by Convex.
 */
export interface Principal {
    kind: "api_key" | "session";
    scopes: Scope[];
    /** Pinned project, or null when the caller may act on any project. */
    projectId: number | null;
    apiKeyId: string | null;
    backend?: BackendClient;
    /** Compatibility field for the unit-test seam and auth-only fallback. */
    supabase?: SupabaseClient;
}

function hasConvexDeployment(locals: App.Locals): boolean {
    return Boolean(
        getEnv(
            locals,
            "CONVEX_APP_URL",
            "CONVEX_PRODUCTION_URL",
            "CONVEX_URL",
            "PUBLIC_CONVEX_URL",
        ),
    );
}

/**
 * Privileged Supabase client used only by the pre-Convex compatibility path.
 * It remains available for local tests and for a deployment that has not yet
 * received CONVEX_URL; production with CONVEX_URL never uses it for data.
 */
function createSecretClient(locals: App.Locals): SupabaseClient {
    const url = getEnv(locals, ...SUPABASE_URL_VARS);
    const secretKey = getEnv(locals, ...SUPABASE_SECRET_KEY_VARS);

    if (!url || !secretKey) {
        throw new ApiError(
            "not_configured",
            "La autenticacion por API key no esta configurada en este despliegue.",
            {
                hint: "Define CONVEX_URL y CONVEX_BRIDGE_SECRET como secretos del servidor.",
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

const LAST_USED_THROTTLE_MS = 60_000;

async function resolveLegacyApiKey(context: APIContext, rawKey: string): Promise<Principal> {
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

async function resolveConvexApiKey(context: APIContext, rawKey: string): Promise<Principal> {
    const keyHash = await hashApiKey(rawKey);
    const lookup = createBackend(context.locals, { kind: "api_key" });
    const apiKey = await lookup.apiKeyByHash(keyHash);

    // Unknown, revoked and expired keys intentionally share one response.
    if (!apiKey || !apiKey.activa) {
        throw new ApiError("unauthorized", "API key invalida o revocada.");
    }

    if (apiKey.expira_en && new Date(apiKey.expira_en).getTime() < Date.now()) {
        throw new ApiError("unauthorized", "API key invalida o revocada.");
    }

    const lastUsed = apiKey.ultimo_uso_en ? new Date(apiKey.ultimo_uso_en).getTime() : 0;
    if (Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
        await lookup.touchApiKey(apiKey.id, new Date().toISOString());
    }

    return {
        kind: "api_key",
        scopes: apiKey.scopes,
        projectId: apiKey.proyecto_id,
        apiKeyId: apiKey.id,
        backend: createBackend(context.locals, {
            kind: "api_key",
            ...(apiKey.proyecto_id !== null ? { projectLegacyId: apiKey.proyecto_id } : {}),
            apiKeyId: apiKey.id,
        }),
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

    if (hasConvexDeployment(context.locals)) {
        return {
            kind: "session",
            scopes: ["read", "write"],
            projectId: null,
            apiKeyId: null,
            backend: createBackend(context.locals, { kind: "session", userId: user.id }),
        };
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
            hint: "Configura el proveedor de autenticacion y Convex para salir del modo demo.",
        });
    }

    const rawKey = extractApiKey(context.request);
    if (rawKey) {
        return hasConvexDeployment(context.locals)
            ? resolveConvexApiKey(context, rawKey)
            : resolveLegacyApiKey(context, rawKey);
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

/** Convex applies the same check server-side; this remains useful for 404 semantics. */
export function assertProjectAccess(principal: Principal, projectId: number): void {
    if (principal.projectId !== null && principal.projectId !== projectId) {
        throw new ApiError("not_found", "Recurso no encontrado.");
    }
}

export function requireBackend(principal: Principal): BackendClient {
    if (!principal.backend) {
        throw new ApiError("not_configured", "Convex no esta configurado en este despliegue.");
    }
    return principal.backend;
}
