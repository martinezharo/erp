import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();

vi.mock("../../src/lib/supabase", () => ({
    isDemoMode: false,
    supabase: { auth: { signInWithPassword } },
}));

const { POST: signIn } = await import("../../src/pages/api/auth/signin");
const { POST: signOut } = await import("../../src/pages/api/auth/signout");

function cookieJar() {
    return {
        set: vi.fn(),
        delete: vi.fn(),
    };
}

beforeEach(() => {
    signInWithPassword.mockReset();
});

describe("authentication endpoints", () => {
    it("stores session tokens in protected cookies", async () => {
        signInWithPassword.mockResolvedValue({
            data: { session: { access_token: "access", refresh_token: "refresh" } },
            error: null,
        });
        const cookies = cookieJar();
        const request = new Request("https://erp.test/api/auth/signin", {
            method: "POST",
            body: new URLSearchParams({ email: "user@example.test", password: "secret" }),
        });

        const response = await signIn({
            request,
            cookies,
            redirect: (location: string) => new Response(null, { status: 302, headers: { location } }),
        } as never);

        expect(response.status).toBe(302);
        const options = { path: "/", httpOnly: true, sameSite: "lax", secure: true };
        expect(cookies.set).toHaveBeenNthCalledWith(1, "sb-access-token", "access", options);
        expect(cookies.set).toHaveBeenNthCalledWith(2, "sb-refresh-token", "refresh", options);
    });

    it("supports the POST method used by the sign-out form", async () => {
        const cookies = cookieJar();
        const response = await signOut({
            cookies,
            redirect: (location: string) => new Response(null, { status: 302, headers: { location } }),
        } as never);

        expect(response.status).toBe(302);
        expect(cookies.delete).toHaveBeenCalledTimes(2);
    });
});
