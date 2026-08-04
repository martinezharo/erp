import { beforeEach, describe, expect, it, vi } from "vitest";

const transactionSources = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/supabase", () => ({
    isDemoMode: false,
}));

vi.mock("../../src/lib/legacy-api", () => ({
    backendError: (error: unknown) =>
        new Response(JSON.stringify({ error: error instanceof Error ? error.message : "error" }), { status: 500 }),
    jsonResponse: (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    sessionBackend: vi.fn(async () => ({ backend: { transactionSources } })),
    unauthorizedResponse: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
}));

const { GET } = await import("../../src/pages/api/transactions/list");

const sources = {
    sales: [
        {
            id: 1,
            fecha: "2026-08-03",
            canal: "Online",
            estado: "enviada",
            venta_detalle: [{ producto: { nombre: "Producto" }, unidades: 1, precio_unitario_venta: 10 }],
        },
    ],
    purchases: [
        {
            id: 2,
            fecha: "2026-08-02",
            estado: "recibida",
            compra_detalle: [{ producto: { nombre: "Producto" }, unidades: 1, precio_unitario_compra: 5 }],
        },
    ],
    others: [
        {
            id: 3,
            fecha: "2026-08-01",
            tipo: "gasto",
            concepto: "Comisión",
            importe: 3,
        },
    ],
};

function request(query = "") {
    return { url: new URL(`https://example.test/api/transactions/list?projectId=1${query}`) } as never;
}

beforeEach(() => {
    transactionSources.mockReset();
    transactionSources.mockResolvedValue(sources);
});

describe("GET /api/transactions/list", () => {
    it("does not apply amount bounds when they were not supplied", async () => {
        const response = await GET(request());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            total: 3,
            items: expect.arrayContaining([
                expect.objectContaining({ type: "venta", amount: 10 }),
                expect.objectContaining({ type: "compra", amount: -5 }),
                expect.objectContaining({ type: "gasto", amount: -3 }),
            ]),
        });
    });

    it("still applies an explicit zero amount bound", async () => {
        const response = await GET(request("&amountMin=0"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            total: 1,
            items: [expect.objectContaining({ type: "venta", amount: 10 })],
        });
    });
});
