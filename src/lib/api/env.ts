/**
 * Runtime environment access.
 *
 * Secrets behave differently depending on where the app is running. Under the
 * Cloudflare adapter they arrive per-request on `locals.runtime.env`, while
 * `astro dev` and the Node adapter expose them through `import.meta.env` /
 * `process.env`. The API layer needs the service role key at request time, so
 * it reads through this helper rather than any single one of those sources.
 */
export function getEnv(locals: App.Locals | undefined, name: string): string | undefined {
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
