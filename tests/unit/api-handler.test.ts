import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSupabaseStub, type QueryOp, type QueryResult } from "../helpers/supabase-stub";

/**
 * The idempotency layer is what makes a write safe for an agent to retry. If it
 * gets a case wrong the failure is silent and expensive — a sale booked twice,
 * or a timed-out request that can never be retried — so every branch of the
 * reservation state machine is pinned here.
 */

const resolvePrincipal = vi.fn();
const requireScope = vi.fn();
vi.mock("../../src/lib/api/auth", () => ({
    resolvePrincipal: (...args: unknown[]) => resolvePrincipal(...args),
    requireScope: (...args: unknown[]) => requireScope(...args),
}));

const { ApiError } = await import("../../src/lib/api/errors");
const { apiHandler, json, parseBody, parseQuery, withIdempotency } = await import(
    "../../src/lib/api/handler"
);

const IN_FLIGHT = 0;
const ENDPOINT = "POST /api/v1/ventas";

function context(headers: Record<string, string> = {}) {
    return {
        request: new Request("https://example.test/api/v1/ventas", { method: "POST", headers }),
        locals: {} as App.Locals,
    } as never;
}

function principalWith(
    resolve: (op: QueryOp) => QueryResult | Promise<QueryResult>,
    idempotencyNamespace = "api-key:key-1",
) {
    const supabase = createSupabaseStub(resolve);
    return {
        principal: {
            kind: "api_key" as const,
            scopes: ["write" as const],
            projectId: 7,
            apiKeyId: "key-1",
            idempotencyNamespace,
            supabase: supabase as never,
        },
        supabase,
    };
}

/** Resolver that lets the reservation succeed and answers everything else empty. */
const reservationSucceeds = () => ({ data: null, error: null });

/** Resolver for a key that already exists, with the row a re-read would find. */
function reservationTaken(existing: Record<string, unknown> | null) {
    return (op: QueryOp): QueryResult => {
        if (op.kind === "insert") return { data: null, error: { code: "23505", message: "duplicate" } };
        if (op.kind === "select") return { data: existing, error: null };
        return { data: null, error: null };
    };
}

const ok = async () => json({ id: 42 }, 201);

beforeEach(() => {
    resolvePrincipal.mockReset();
    requireScope.mockReset();
});

describe("withIdempotency — no key supplied", () => {
    it("runs the handler and touches nothing", async () => {
        const { principal, supabase } = principalWith(reservationSucceeds);
        const fn = vi.fn(ok);

        const response = await withIdempotency(context(), principal, ENDPOINT, { a: 1 }, fn);

        expect(response.status).toBe(201);
        expect(fn).toHaveBeenCalledOnce();
        expect(supabase.ops).toHaveLength(0);
    });
});

describe("withIdempotency — first use of a key", () => {
    it("reserves before doing the work, so a racing request cannot also write", async () => {
        const order: string[] = [];
        const { principal, supabase } = principalWith((op) => {
            order.push(`db:${op.kind}`);
            return { data: null, error: null };
        });

        await withIdempotency(context({ "idempotency-key": "k1" }), principal, ENDPOINT, { a: 1 }, async () => {
            order.push("handler");
            return ok();
        });

        expect(order[0]).toBe("db:insert");
        expect(order.indexOf("handler")).toBeGreaterThan(0);
        expect(supabase.opsFor("idempotency_keys", "insert")).toHaveLength(1);
    });

    it("marks the reservation in flight and attributes it to the calling key", async () => {
        const { principal, supabase } = principalWith(reservationSucceeds);

        await withIdempotency(context({ "idempotency-key": "k1" }), principal, ENDPOINT, { a: 1 }, ok);

        const [reservation] = supabase.opsFor("idempotency_keys", "insert");
        expect(reservation.payload).toMatchObject({
            idempotency_key: await scopedKey("api-key:key-1", "k1"),
            api_key_id: "key-1",
            endpoint: ENDPOINT,
            response_status: IN_FLIGHT,
        });
    });

    it("stores the outcome so the next attempt can replay it", async () => {
        const { principal, supabase } = principalWith(reservationSucceeds);

        const response = await withIdempotency(
            context({ "idempotency-key": "k1" }),
            principal,
            ENDPOINT,
            { a: 1 },
            ok,
        );

        const [update] = supabase.opsFor("idempotency_keys", "update");
        expect(update.payload).toEqual({ response_status: 201, response_body: { id: 42 } });
        expect(update.filters).toEqual([
            ["idempotency_key", await scopedKey("api-key:key-1", "k1")],
            ["endpoint", ENDPOINT],
        ]);
        // The caller still gets a readable body: storing it must not consume the
        // stream.
        await expect(response.json()).resolves.toEqual({ id: 42 });
    });

    it("reports a reservation failure that is not a duplicate as a server error", async () => {
        const { principal } = principalWith((op) =>
            op.kind === "insert"
                ? { data: null, error: { code: "08006", message: "connection failure" } }
                : { data: null, error: null },
        );
        const fn = vi.fn(ok);

        await expect(
            withIdempotency(context({ "idempotency-key": "k1" }), principal, ENDPOINT, {}, fn),
        ).rejects.toMatchObject({ code: "internal_error" });
        expect(fn).not.toHaveBeenCalled();
    });
});

describe("withIdempotency — key already used", () => {
    it("replays the stored response without re-running the handler", async () => {
        const { principal } = principalWith(
            reservationTaken({
                request_hash: await hashOf(ENDPOINT, { a: 1 }),
                response_status: 201,
                response_body: { id: 42 },
            }),
        );
        const fn = vi.fn(ok);

        const response = await withIdempotency(
            context({ "idempotency-key": "k1" }),
            principal,
            ENDPOINT,
            { a: 1 },
            fn,
        );

        expect(fn).not.toHaveBeenCalled();
        expect(response.status).toBe(201);
        expect(response.headers.get("Idempotency-Replayed")).toBe("true");
        await expect(response.json()).resolves.toEqual({ id: 42 });
    });

    it("refuses a key reused with a different body", async () => {
        const { principal } = principalWith(
            reservationTaken({
                request_hash: await hashOf(ENDPOINT, { a: 1 }),
                response_status: 201,
                response_body: { id: 42 },
            }),
        );
        const fn = vi.fn(ok);

        await expect(
            withIdempotency(context({ "idempotency-key": "k1" }), principal, ENDPOINT, { a: 2 }, fn),
        ).rejects.toMatchObject({ code: "idempotency_mismatch" });
        expect(fn).not.toHaveBeenCalled();
    });

    it("refuses a second request while the first is still running", async () => {
        const { principal } = principalWith(
            reservationTaken({
                request_hash: await hashOf(ENDPOINT, { a: 1 }),
                response_status: IN_FLIGHT,
                response_body: {},
            }),
        );

        await expect(
            withIdempotency(context({ "idempotency-key": "k1" }), principal, ENDPOINT, { a: 1 }, ok),
        ).rejects.toMatchObject({ code: "conflict" });
    });

    it("asks for a retry when the reservation vanished mid-race", async () => {
        // A concurrent attempt failed and released the key between our insert
        // and this read. Retrying is safe; guessing is not.
        const { principal } = principalWith(reservationTaken(null));

        await expect(
            withIdempotency(context({ "idempotency-key": "k1" }), principal, ENDPOINT, { a: 1 }, ok),
        ).rejects.toMatchObject({ code: "conflict" });
    });
});

describe("withIdempotency — releasing a failed attempt", () => {
    it("releases the key when the handler throws, so the caller can retry", async () => {
        const { principal, supabase } = principalWith(reservationSucceeds);

        await expect(
            withIdempotency(context({ "idempotency-key": "k1" }), principal, ENDPOINT, {}, async () => {
                throw new ApiError("validation_error", "boom");
            }),
        ).rejects.toMatchObject({ code: "validation_error" });

        const [release] = supabase.opsFor("idempotency_keys", "delete");
        expect(release.filters).toEqual([
            ["idempotency_key", await scopedKey("api-key:key-1", "k1")],
            ["endpoint", ENDPOINT],
        ]);
    });

    it("releases the key on an error response and stores nothing", async () => {
        const { principal, supabase } = principalWith(reservationSucceeds);

        const response = await withIdempotency(
            context({ "idempotency-key": "k1" }),
            principal,
            ENDPOINT,
            {},
            async () => json({ error: "nope" }, 400),
        );

        expect(response.status).toBe(400);
        expect(supabase.opsFor("idempotency_keys", "delete")).toHaveLength(1);
        // Replaying a 400 forever would make the key unusable after a typo.
        expect(supabase.opsFor("idempotency_keys", "update")).toHaveLength(0);
    });
});

describe("withIdempotency — request fingerprint", () => {
    async function hashStoredFor(body: unknown) {
        const { principal, supabase } = principalWith(reservationSucceeds);
        await withIdempotency(context({ "idempotency-key": "k1" }), principal, ENDPOINT, body, ok);
        const [reservation] = supabase.opsFor("idempotency_keys", "insert");
        return (reservation.payload as { request_hash: string }).request_hash;
    }

    it("ignores key order, so a re-serialised retry is not a mismatch", async () => {
        expect(await hashStoredFor({ a: 1, b: 2 })).toBe(await hashStoredFor({ b: 2, a: 1 }));
    });

    it("ignores undefined fields", async () => {
        expect(await hashStoredFor({ a: 1, b: undefined })).toBe(await hashStoredFor({ a: 1 }));
    });

    it("distinguishes different values, nesting and array order", async () => {
        const hashes = await Promise.all([
            hashStoredFor({ a: 1 }),
            hashStoredFor({ a: 2 }),
            hashStoredFor({ a: "1" }),
            hashStoredFor({ a: { b: 1 } }),
            hashStoredFor({ items: [1, 2] }),
            hashStoredFor({ items: [2, 1] }),
        ]);
        expect(new Set(hashes).size).toBe(hashes.length);
    });

    it("separates the same body sent to different endpoints", async () => {
        const { principal, supabase } = principalWith(reservationSucceeds);
        await withIdempotency(context({ "idempotency-key": "k1" }), principal, "POST /a", { a: 1 }, ok);
        await withIdempotency(context({ "idempotency-key": "k1" }), principal, "POST /b", { a: 1 }, ok);

        const [first, second] = supabase.opsFor("idempotency_keys", "insert");
        expect((first.payload as { request_hash: string }).request_hash).not.toBe(
            (second.payload as { request_hash: string }).request_hash,
        );
    });

    it("trims the header, so a stray space is not a different key", async () => {
        const { principal, supabase } = principalWith(reservationSucceeds);
        await withIdempotency(context({ "idempotency-key": "  k1  " }), principal, ENDPOINT, {}, ok);

        const [reservation] = supabase.opsFor("idempotency_keys", "insert");
        expect((reservation.payload as { idempotency_key: string }).idempotency_key).toBe(
            await scopedKey("api-key:key-1", "k1"),
        );
    });

    it("isolates the same caller key between authenticated principals", async () => {
        const first = principalWith(reservationSucceeds, "api-key:first");
        const second = principalWith(reservationSucceeds, "api-key:second");

        await withIdempotency(context({ "idempotency-key": "shared" }), first.principal, ENDPOINT, {}, ok);
        await withIdempotency(context({ "idempotency-key": "shared" }), second.principal, ENDPOINT, {}, ok);

        const firstKey = (first.supabase.opsFor("idempotency_keys", "insert")[0].payload as { idempotency_key: string }).idempotency_key;
        const secondKey = (second.supabase.opsFor("idempotency_keys", "insert")[0].payload as { idempotency_key: string }).idempotency_key;
        expect(firstKey).not.toBe(secondKey);
    });

    it("rejects oversized keys before reserving storage", async () => {
        const { principal, supabase } = principalWith(reservationSucceeds);
        await expect(
            withIdempotency(context({ "idempotency-key": "x".repeat(256) }), principal, ENDPOINT, {}, ok),
        ).rejects.toMatchObject({ code: "validation_error" });
        expect(supabase.ops).toHaveLength(0);
    });
});

describe("apiHandler", () => {
    const principal = { kind: "api_key", scopes: ["read"], projectId: 7, apiKeyId: "k", idempotencyNamespace: "api-key:k", supabase: {} };

    it("resolves the caller and checks the scope before running the route", async () => {
        resolvePrincipal.mockResolvedValue(principal);
        const fn = vi.fn(async () => json({ ok: true }));

        const response = await apiHandler(context(), "read", fn);

        expect(requireScope).toHaveBeenCalledWith(principal, "read");
        expect(fn).toHaveBeenCalledWith(principal);
        expect(response.status).toBe(200);
    });

    it("does not run the route when authentication fails", async () => {
        resolvePrincipal.mockRejectedValue(new ApiError("unauthorized", "no"));
        const fn = vi.fn(async () => json({ ok: true }));

        const response = await apiHandler(context(), "read", fn);

        expect(fn).not.toHaveBeenCalled();
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
    });

    it("does not run the route when the scope check fails", async () => {
        resolvePrincipal.mockResolvedValue(principal);
        requireScope.mockImplementation(() => {
            throw new ApiError("forbidden", "no write");
        });
        const fn = vi.fn(async () => json({ ok: true }));

        const response = await apiHandler(context(), "write", fn);

        expect(fn).not.toHaveBeenCalled();
        expect(response.status).toBe(403);
    });

    it("turns an unexpected throw into the standard 500 envelope", async () => {
        resolvePrincipal.mockResolvedValue(principal);
        vi.spyOn(console, "error").mockImplementation(() => {});

        const response = await apiHandler(context(), "read", async () => {
            throw new TypeError("undefined is not a function");
        });

        expect(response.status).toBe(500);
        expect(response.headers.get("Content-Type")).toBe("application/json");
        await expect(response.json()).resolves.toEqual({
            error: {
                code: "internal_error",
                message: "Se produjo un error interno.",
            },
        });
    });
});

describe("parseBody", () => {
    const schema = z.object({ unidades: z.number().int().positive() });

    it("returns the parsed value", async () => {
        const request = new Request("https://example.test", {
            method: "POST",
            body: JSON.stringify({ unidades: 3 }),
        });
        await expect(parseBody(request, schema)).resolves.toEqual({ unidades: 3 });
    });

    it("reports malformed JSON as a validation error, not a 500", async () => {
        const request = new Request("https://example.test", { method: "POST", body: "{not json" });
        await expect(parseBody(request, schema)).rejects.toMatchObject({ code: "validation_error" });
    });

    it("names the offending field so an agent can fix its call", async () => {
        const request = new Request("https://example.test", {
            method: "POST",
            body: JSON.stringify({ unidades: -1 }),
        });
        const error = await parseBody(request, schema).catch((e) => e);
        expect(error.details[0].field).toBe("unidades");
    });
});

describe("parseQuery", () => {
    const schema = z.object({ proyecto_id: z.coerce.number().optional() });

    it("parses present parameters", () => {
        const url = new URL("https://example.test/?proyecto_id=7");
        expect(parseQuery(url, schema)).toEqual({ proyecto_id: 7 });
    });

    it("treats an empty parameter as absent rather than as an empty string", () => {
        const url = new URL("https://example.test/?proyecto_id=");
        expect(parseQuery(url, schema)).toEqual({});
    });

    it("rejects a parameter that cannot be coerced", () => {
        const url = new URL("https://example.test/?proyecto_id=siete");
        expect(() => parseQuery(url, schema)).toThrow(ApiError);
    });
});

describe("json", () => {
    it("defaults to 200 with a JSON content type", async () => {
        const response = json({ a: 1 });
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("application/json");
        await expect(response.json()).resolves.toEqual({ a: 1 });
    });

    it("carries extra headers through", () => {
        expect(json({}, 201, { "X-Test": "1" }).headers.get("X-Test")).toBe("1");
    });
});

/** Mirrors the module-private canonical hash, so replay tests can build a match. */
async function hashOf(endpoint: string, body: unknown): Promise<string> {
    const canonicalize = (value: unknown): string => {
        if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
        if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
        return `{${entries.join(",")}}`;
    };
    const data = new TextEncoder().encode(`${endpoint}\n${canonicalize(body)}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function scopedKey(namespace: string, key: string): Promise<string> {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${namespace}\n${key.trim()}`),
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
