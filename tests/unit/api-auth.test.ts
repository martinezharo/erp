import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseStub, type QueryOp, type QueryResult } from "../helpers/supabase-stub";

/**
 * `src/lib/api/auth.ts` is what stands in for row-level security on the
 * machine-facing API: an API key has no Supabase user, so it runs under the
 * secret key and these checks are the only thing keeping one project's books
 * away from another's. Everything here is a security test.
 */

const demo = { active: false };

vi.mock("../../src/lib/supabase", () => ({
    get isDemoMode() {
        return demo.active;
    },
}));

const createClient = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: (...args: unknown[]) => createClient(...args) }));

const { ApiError } = await import("../../src/lib/api/errors");
const { assertProjectAccess, requireScope, resolvePrincipal, resolveProjectId } = await import(
    "../../src/lib/api/auth"
);
const { hashApiKey } = await import("../../src/lib/api/keys");

const URL_VAR = "PUBLIC_SUPABASE_URL";
const SECRET_VAR = "SUPABASE_SECRET_KEY";
const PUBLIC_VAR = "PUBLIC_SUPABASE_PUBLISHABLE_KEY";

/** A stored `api_keys` row, with the fields the resolver actually selects. */
interface StoredKey {
    id?: string;
    proyecto_id?: number | null;
    scopes?: string[] | null;
    activa?: boolean;
    expira_en?: string | null;
    ultimo_uso_en?: string | null;
}

function context(headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
    return {
        request: new Request("https://example.test/api/v1/ventas", { headers }),
        locals: {} as App.Locals,
        cookies: {
            get: (name: string) => (cookies[name] ? { value: cookies[name] } : undefined),
        },
    } as never;
}

/** Wires `createClient` to a stub that answers the `api_keys` lookup with `row`. */
function stubWithKey(row: StoredKey | null, overrides: (op: QueryOp) => QueryResult | null = () => null) {
    const stub = createSupabaseStub((op) => {
        const override = overrides(op);
        if (override) return override;
        if (op.table === "api_keys" && op.kind === "select") {
            return { data: row, error: null };
        }
        return { data: null, error: null };
    });
    createClient.mockReturnValue(stub);
    return stub;
}

async function expectApiError(promise: Promise<unknown>, code: string) {
    const error = await promise.then(
        () => null,
        (e: unknown) => e,
    );
    expect(error, `expected an ApiError(${code}) but the call resolved`).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).code).toBe(code);
    return error as InstanceType<typeof ApiError>;
}

beforeEach(() => {
    demo.active = false;
    createClient.mockReset();
    process.env[URL_VAR] = "https://project.supabase.co";
    process.env[SECRET_VAR] = "sb_secret_test";
    process.env[PUBLIC_VAR] = "sb_publishable_test";
});

afterEach(() => {
    delete process.env[URL_VAR];
    delete process.env[SECRET_VAR];
    delete process.env[PUBLIC_VAR];
    vi.useRealTimers();
});

describe("resolvePrincipal — demo mode", () => {
    it("refuses every request, key or not", async () => {
        demo.active = true;
        stubWithKey({ id: "k1", scopes: ["read", "write"], activa: true });

        await expectApiError(
            resolvePrincipal(context({ authorization: "Bearer erp_sk_valid" })),
            "demo_mode",
        );
        await expectApiError(resolvePrincipal(context()), "demo_mode");
    });
});

describe("resolvePrincipal — API key path", () => {
    it("looks the key up by hash, never by plaintext", async () => {
        const stub = stubWithKey({ id: "k1", proyecto_id: 7, scopes: ["read"], activa: true });

        await resolvePrincipal(context({ authorization: "Bearer erp_sk_secret" }));

        const [lookup] = stub.opsFor("api_keys", "select");
        expect(lookup.filters).toEqual([["key_hash", await hashApiKey("erp_sk_secret")]]);
        expect(JSON.stringify(stub.ops)).not.toContain("erp_sk_secret");
    });

    it("authenticates under the secret key, not the publishable one", async () => {
        stubWithKey({ id: "k1", scopes: ["read"], activa: true });

        await resolvePrincipal(context({ authorization: "Bearer erp_sk_secret" }));

        expect(createClient).toHaveBeenCalledWith(
            "https://project.supabase.co",
            "sb_secret_test",
            expect.anything(),
        );
    });

    it("builds a principal carrying the key's scopes and project pin", async () => {
        stubWithKey({ id: "k1", proyecto_id: 7, scopes: ["read", "write"], activa: true });

        const principal = await resolvePrincipal(context({ "x-api-key": "erp_sk_secret" }));

        expect(principal.kind).toBe("api_key");
        expect(principal.scopes).toEqual(["read", "write"]);
        expect(principal.projectId).toBe(7);
        expect(principal.apiKeyId).toBe("k1");
    });

    it("treats an unpinned key as project-less rather than all-access-by-default", async () => {
        stubWithKey({ id: "k1", proyecto_id: null, scopes: ["read"], activa: true });

        const principal = await resolvePrincipal(context({ "x-api-key": "erp_sk_secret" }));

        expect(principal.projectId).toBeNull();
    });

    it("treats a key with no scopes as holding none", async () => {
        stubWithKey({ id: "k1", scopes: null, activa: true });

        const principal = await resolvePrincipal(context({ "x-api-key": "erp_sk_secret" }));

        expect(principal.scopes).toEqual([]);
        expect(() => requireScope(principal, "read")).toThrow(ApiError);
    });

    it("gives unknown, revoked and expired keys the same answer", async () => {
        const yesterday = new Date(Date.now() - 86_400_000).toISOString();
        const cases: Array<[string, StoredKey | null]> = [
            ["unknown", null],
            ["revoked", { id: "k1", scopes: ["read"], activa: false }],
            ["expired", { id: "k1", scopes: ["read"], activa: true, expira_en: yesterday }],
        ];

        const seen = new Set<string>();
        for (const [label, row] of cases) {
            stubWithKey(row);
            const error = await expectApiError(
                resolvePrincipal(context({ authorization: "Bearer erp_sk_secret" })),
                "unauthorized",
            );
            seen.add(`${error.status}:${error.message}:${error.hint ?? ""}`);
            expect(error.status, label).toBe(401);
        }

        // One distinct response across all three: anything else tells a caller
        // whether a key ever existed, or whether it is merely expired.
        expect(seen.size).toBe(1);
    });

    it("accepts a key whose expiry is still in the future", async () => {
        const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
        stubWithKey({ id: "k1", scopes: ["read"], activa: true, expira_en: tomorrow });

        await expect(
            resolvePrincipal(context({ authorization: "Bearer erp_sk_secret" })),
        ).resolves.toMatchObject({ kind: "api_key" });
    });

    it("reports a lookup failure as a server error, not as a bad key", async () => {
        stubWithKey(null, (op) =>
            op.table === "api_keys" && op.kind === "select"
                ? { data: null, error: { message: "connection reset" } }
                : null,
        );

        await expectApiError(
            resolvePrincipal(context({ authorization: "Bearer erp_sk_secret" })),
            "internal_error",
        );
    });

    it("fails closed when the secret key is not configured", async () => {
        delete process.env[SECRET_VAR];
        stubWithKey({ id: "k1", scopes: ["read"], activa: true });

        const error = await expectApiError(
            resolvePrincipal(context({ authorization: "Bearer erp_sk_secret" })),
            "not_configured",
        );
        expect(error.status).toBe(503);
    });

    it("records last use at most once a minute", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));

        const fresh = stubWithKey({
            id: "k1",
            scopes: ["read"],
            activa: true,
            ultimo_uso_en: new Date("2026-01-01T11:59:30Z").toISOString(),
        });
        await resolvePrincipal(context({ "x-api-key": "erp_sk_secret" }));
        expect(fresh.opsFor("api_keys", "update")).toHaveLength(0);

        const stale = stubWithKey({
            id: "k1",
            scopes: ["read"],
            activa: true,
            ultimo_uso_en: new Date("2026-01-01T11:00:00Z").toISOString(),
        });
        await resolvePrincipal(context({ "x-api-key": "erp_sk_secret" }));
        const [update] = stale.opsFor("api_keys", "update");
        expect(update.filters).toEqual([["id", "k1"]]);
    });
});

describe("resolvePrincipal — session path", () => {
    it("rejects a request with no key and no session", async () => {
        createClient.mockReturnValue({
            auth: { getUser: async () => ({ data: { user: null } }), setSession: vi.fn() },
        });

        const error = await expectApiError(resolvePrincipal(context()), "unauthorized");
        expect(error.hint).toContain("Bearer");
    });

    it("gives a logged-in browser both scopes and no project pin", async () => {
        const setSession = vi.fn();
        createClient.mockReturnValue({
            auth: { getUser: async () => ({ data: { user: { id: "u1" } } }), setSession },
        });

        const principal = await resolvePrincipal(
            context({}, { "sb-access-token": "at", "sb-refresh-token": "rt" }),
        );

        expect(principal.kind).toBe("session");
        expect(principal.scopes).toEqual(["read", "write"]);
        expect(principal.projectId).toBeNull();
        expect(principal.apiKeyId).toBeNull();
        expect(setSession).toHaveBeenCalledWith({ access_token: "at", refresh_token: "rt" });
    });

    it("authenticates the browser under the publishable key, so RLS still applies", async () => {
        createClient.mockReturnValue({
            auth: { getUser: async () => ({ data: { user: { id: "u1" } } }), setSession: vi.fn() },
        });

        await resolvePrincipal(context({}, { "sb-access-token": "at", "sb-refresh-token": "rt" }));

        expect(createClient).toHaveBeenCalledWith(
            "https://project.supabase.co",
            "sb_publishable_test",
            expect.anything(),
        );
    });
});

describe("requireScope", () => {
    const readOnly = { kind: "api_key" as const, scopes: ["read" as const], projectId: 1, apiKeyId: "k", idempotencyNamespace: "api-key:k", supabase: {} as never };

    it("lets a scope through when the key holds it", () => {
        expect(() => requireScope(readOnly, "read")).not.toThrow();
    });

    it("refuses a write from a read-only key", () => {
        try {
            requireScope(readOnly, "write");
            expect.unreachable("a read-only key must not pass a write check");
        } catch (error) {
            expect(error).toBeInstanceOf(ApiError);
            expect((error as InstanceType<typeof ApiError>).code).toBe("forbidden");
            expect((error as InstanceType<typeof ApiError>).status).toBe(403);
        }
    });
});

describe("resolveProjectId", () => {
    const pinned = { kind: "api_key" as const, scopes: ["write" as const], projectId: 7, apiKeyId: "k", idempotencyNamespace: "api-key:k", supabase: {} as never };
    const unpinned = { ...pinned, projectId: null };

    it("supplies the project a pinned key omitted", () => {
        expect(resolveProjectId(pinned, undefined)).toBe(7);
        expect(resolveProjectId(pinned, null)).toBe(7);
    });

    it("accepts a request that names the pinned project", () => {
        expect(resolveProjectId(pinned, 7)).toBe(7);
    });

    it("refuses a pinned key that names another project instead of rewriting it", () => {
        // The dangerous failure mode is silently substituting the pin: an agent
        // working from a stale id would then write to the wrong books and get a
        // 200 back.
        try {
            resolveProjectId(pinned, 8);
            expect.unreachable("a pinned key must not reach another project");
        } catch (error) {
            expect((error as InstanceType<typeof ApiError>).code).toBe("forbidden");
        }
    });

    it("requires an explicit project from an unpinned key", () => {
        try {
            resolveProjectId(unpinned, undefined);
            expect.unreachable("an unpinned key must not default to some project");
        } catch (error) {
            const apiError = error as InstanceType<typeof ApiError>;
            expect(apiError.code).toBe("validation_error");
            expect(apiError.details?.[0].field).toBe("proyecto_id");
        }
    });

    it("passes an explicit project through for an unpinned key", () => {
        expect(resolveProjectId(unpinned, 3)).toBe(3);
    });

    it("does not treat project 0 as absent", () => {
        expect(resolveProjectId(unpinned, 0)).toBe(0);
    });
});

describe("assertProjectAccess", () => {
    const pinned = { kind: "api_key" as const, scopes: ["read" as const], projectId: 7, apiKeyId: "k", idempotencyNamespace: "api-key:k", supabase: {} as never };

    it("allows a read inside the pin", () => {
        expect(() => assertProjectAccess(pinned, 7)).not.toThrow();
    });

    it("allows any project for an unpinned caller", () => {
        expect(() => assertProjectAccess({ ...pinned, projectId: null }, 42)).not.toThrow();
    });

    it("answers 404, not 403, for a resource outside the pin", () => {
        // 403 would confirm the row exists; 404 leaks nothing.
        try {
            assertProjectAccess(pinned, 8);
            expect.unreachable("a cross-project read must not be allowed");
        } catch (error) {
            expect((error as InstanceType<typeof ApiError>).code).toBe("not_found");
            expect((error as InstanceType<typeof ApiError>).status).toBe(404);
        }
    });
});
