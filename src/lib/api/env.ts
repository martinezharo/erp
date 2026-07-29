/**
 * Runtime environment access.
 *
 * Secrets behave differently depending on where the app is running. Under the
 * Cloudflare adapter they arrive per-request on `locals.runtime.env`, while
 * `astro dev` and the Node adapter expose them through `import.meta.env` /
 * `process.env`. The API layer needs the service role key at request time, so
 * it reads through this helper rather than any single one of those sources.
 */
function readEnv(locals: App.Locals | undefined, name: string): string | undefined {
    const runtimeEnv = (locals as any)?.runtime?.env;
    if (runtimeEnv && typeof runtimeEnv[name] === "string" && runtimeEnv[name]) {
        return runtimeEnv[name];
    }

    const metaValue = (import.meta.env as Record<string, unknown>)[name];
    if (typeof metaValue === "string" && metaValue) {
        return metaValue;
    }

    if (typeof process !== "undefined" && process.env && process.env[name]) {
        return process.env[name];
    }

    return undefined;
}

/** Reads the first of `names` that is set, so a preferred name can win. */
export function getEnv(locals: App.Locals | undefined, ...names: string[]): string | undefined {
    for (const name of names) {
        const value = readEnv(locals, name);
        if (value) return value;
    }
    return undefined;
}

/**
 * Supabase replaced the JWT-based `anon` and `service_role` keys with
 * publishable (`sb_publishable_...`) and secret (`sb_secret_...`) keys, which
 * can be rotated and revoked one at a time instead of all at once through the
 * project's JWT secret.
 *
 * The new names are preferred and the legacy ones still work, so an existing
 * deployment keeps running untouched while a migrated one picks up the better
 * key automatically. The legacy keys are supported by Supabase until the end of
 * 2026.
 */
export const SUPABASE_URL_VARS = ["PUBLIC_SUPABASE_URL"];

/** Client-side key: safe to ship to the browser, subject to RLS. */
export const SUPABASE_PUBLIC_KEY_VARS = [
    "PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "PUBLIC_SUPABASE_ANON_KEY",
];

/**
 * Server-side key: bypasses RLS, must never reach the browser. Note that a
 * secret key additionally refuses to work from a browser (Supabase matches on
 * the User-Agent), which the old service_role key did not.
 */
export const SUPABASE_SECRET_KEY_VARS = [
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
];
