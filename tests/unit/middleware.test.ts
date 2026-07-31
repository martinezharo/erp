import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The middleware is the only authentication check standing in front of the
 * browser's JSON API: ten of those routes query the database with no check of
 * their own. A regression here is not a broken page, it is an open ledger.
 */

const demo = { active: false };
const getUser = vi.fn();
const getAuthenticatedSupabase = vi.fn(() => ({ auth: { getUser } }));

vi.mock("../../src/lib/supabase", () => ({
    get isDemoMode() {
        return demo.active;
    },
    getAuthenticatedSupabase: (...args: unknown[]) => getAuthenticatedSupabase(...(args as [])),
}));

const { onRequest } = await import("../../src/middleware");

interface Call {
    locals: Record<string, unknown>;
    deleted: Array<[string, unknown]>;
    next: ReturnType<typeof vi.fn>;
    redirect: ReturnType<typeof vi.fn>;
}

const NEXT = new Response("page", { status: 200 });
const REDIRECT = new Response(null, { status: 302, headers: { Location: "/login" } });

async function run(pathname: string, cookieValues: Record<string, string> = {}) {
    const deleted: Array<[string, unknown]> = [];
    const locals: Record<string, unknown> = {};
    const next = vi.fn(async () => NEXT);
    const redirect = vi.fn(() => REDIRECT);

    const response = await onRequest(
        {
            request: new Request(`https://erp.test${pathname}`, {
                headers: { "accept-language": "es-ES" },
            }),
            locals,
            redirect,
            cookies: {
                get: (name: string) =>
                    cookieValues[name] ? { value: cookieValues[name] } : undefined,
                delete: (name: string, options: unknown) => deleted.push([name, options]),
            },
        } as never,
        next as never,
    );

    return { response: response as Response, locals, deleted, next, redirect } as Call & {
        response: Response;
    };
}

const SESSION_COOKIES = { "sb-access-token": "at", "sb-refresh-token": "rt" };
const anonymous = () => getUser.mockResolvedValue({ data: { user: null } });
const signedIn = () => getUser.mockResolvedValue({ data: { user: { id: "u1" } } });

beforeEach(() => {
    demo.active = false;
    getUser.mockReset();
    getAuthenticatedSupabase.mockClear();
});

describe("locale", () => {
    it("is resolved for every request, including unauthenticated ones", async () => {
        anonymous();
        const { locals } = await run("/api/sales/create");
        expect(locals.lang).toBe("es");
        expect(typeof locals.t).toBe("function");
    });
});

describe("demo mode", () => {
    it("skips authentication entirely", async () => {
        demo.active = true;
        const { next, response } = await run("/api/sales/create");
        expect(next).toHaveBeenCalledOnce();
        expect(response.status).toBe(200);
        expect(getUser).not.toHaveBeenCalled();
    });
});

describe("public routes", () => {
    it("let an anonymous visitor through without a session lookup", async () => {
        for (const path of ["/login", "/api/auth/signin"]) {
            const { next } = await run(path);
            expect(next, path).toHaveBeenCalledOnce();
        }
        expect(getUser).not.toHaveBeenCalled();
    });
});

describe("the self-authenticating /api/v1 routes", () => {
    it("are not intercepted, so an API key is not answered with a redirect", async () => {
        const { next } = await run("/api/v1/ventas");
        expect(next).toHaveBeenCalledOnce();
        expect(getUser).not.toHaveBeenCalled();
    });
});

describe("the browser's JSON API", () => {
    it("rejects cookies that merely exist but do not identify anyone", async () => {
        // This is the whole point of the check: presence-only validation let a
        // request through with two cookies of the caller's own invention.
        anonymous();
        const { response, next } = await run("/api/sales/create", {
            "sb-access-token": "forged",
            "sb-refresh-token": "forged",
        });

        expect(next).not.toHaveBeenCalled();
        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/json");
        await expect(response.json()).resolves.toHaveProperty("error");
    });

    it("rejects a request with no cookies at all", async () => {
        anonymous();
        const { response, next } = await run("/api/transactions/delete");
        expect(next).not.toHaveBeenCalled();
        expect(response.status).toBe(401);
    });

    it("answers 401 rather than redirecting, so a fetch cannot read a login page as data", async () => {
        anonymous();
        const { response, redirect } = await run("/api/stats/evolution");
        expect(redirect).not.toHaveBeenCalled();
        expect(response.status).toBe(401);
    });

    it("guards every route that has no check of its own", async () => {
        anonymous();
        for (const path of [
            "/api/sales/init-data",
            "/api/sales/get",
            "/api/sales/update",
            "/api/sales/create",
            "/api/purchases/get",
            "/api/transactions/list",
            "/api/transactions/details",
            "/api/transactions/delete",
            "/api/transactions/get-other",
            "/api/stats/evolution",
        ]) {
            const { response, next } = await run(path, SESSION_COOKIES);
            expect(response.status, path).toBe(401);
            expect(next, path).not.toHaveBeenCalled();
        }
    });

    it("lets a valid session through", async () => {
        signedIn();
        const { response, next } = await run("/api/sales/create", SESSION_COOKIES);
        expect(next).toHaveBeenCalledOnce();
        expect(response.status).toBe(200);
    });
});

describe("pages", () => {
    it("send an anonymous visitor to the login page", async () => {
        anonymous();
        const { redirect, next } = await run("/transacciones");
        expect(next).not.toHaveBeenCalled();
        expect(redirect).toHaveBeenCalledWith("/login");
    });

    it("clear the rejected cookies so a stale session cannot loop on /login", async () => {
        anonymous();
        const { deleted } = await run("/", SESSION_COOKIES);
        expect(deleted).toEqual([
            ["sb-access-token", { path: "/" }],
            ["sb-refresh-token", { path: "/" }],
        ]);
    });

    it("let a valid session through", async () => {
        signedIn();
        const { next, redirect } = await run("/stock", SESSION_COOKIES);
        expect(next).toHaveBeenCalledOnce();
        expect(redirect).not.toHaveBeenCalled();
    });
});

describe("locals handed to the route", () => {
    it("expose the validated user and its client, so nothing re-validates", async () => {
        signedIn();
        const { locals } = await run("/", SESSION_COOKIES);
        expect(locals.user).toEqual({ id: "u1" });
        expect(locals.supabase).toBeDefined();
        expect(getAuthenticatedSupabase).toHaveBeenCalledOnce();
    });

    it("leave the user unset when there is no session, so its presence proves one", async () => {
        anonymous();
        const { locals } = await run("/");
        expect(locals.user).toBeUndefined();
        expect(locals.supabase).toBeUndefined();
    });

    it("leave the user unset on routes the middleware does not authenticate", async () => {
        const { locals } = await run("/api/v1/ventas");
        expect(locals.user).toBeUndefined();
    });
});
