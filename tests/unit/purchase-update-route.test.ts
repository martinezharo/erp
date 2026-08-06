import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    updatePurchase: vi.fn().mockResolvedValue(42),
    sessionBackend: vi.fn(async () => ({
        backend: { updatePurchase: mocks.updatePurchase },
        userId: "user-1",
    })),
}));

vi.mock("../../src/lib/legacy-api", () => ({
    backendError: (error: unknown) => new Response(JSON.stringify({ error }), { status: 500 }),
    demoResponse: () => new Response(null, { status: 403 }),
    jsonResponse: (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
        }),
    parsePositiveInteger: (value: unknown) => {
        const parsed = typeof value === "string" ? Number(value) : value;
        return typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    },
    sessionBackend: mocks.sessionBackend,
    unauthorizedResponse: () => new Response(null, { status: 401 }),
}));
vi.mock("../../src/lib/supabase", () => ({ isDemoMode: false }));

const { PUT } = await import("../../src/pages/api/purchases/update");

describe("PUT /api/purchases/update", () => {
    it("converts the string id emitted by the edit form before calling Convex", async () => {
        const context = {
            request: new Request("https://erp.test/api/purchases/update", {
                method: "PUT",
                body: JSON.stringify({
                    id: "42",
                    projectId: "7",
                    date: "2026-08-05",
                    estado: "recibida",
                    items: [{ productId: 11, units: 1, unitPrice: 6.25, tax: 21 }],
                }),
            }),
        } as never;

        const response = await PUT(context);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, id: 42 });
        expect(mocks.updatePurchase).toHaveBeenCalledWith(42, {
            date: "2026-08-05",
            status: "recibida",
            items: [{ productId: 11, units: 1, unitPrice: 6.25, vatRate: 21 }],
        });
    });
});
