/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "wallapop-test-secret";
const actor = {
  kind: "api_key" as const,
  projectLegacyId: 7,
  apiKeyId: "key-1",
};

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      legacyId: 7,
      name: "Test project",
      active: true,
    });
    const productId = await ctx.db.insert("products", {
      legacyId: 11,
      projectId,
      projectLegacyId: 7,
      name: "Xiaomi XMRM-006",
      wallapopTitle: "Mando Xiaomi XMRM-006 a Estrenar",
    });
    return { projectId, productId };
  });
}

function importArgs(overrides: Record<string, unknown> = {}) {
  return {
    bridgeSecret: SECRET,
    actor,
    projectLegacyId: 7,
    originId: "gmail-message-1",
    date: "2026-08-03T00:00:00",
    customerName: "Antonio R.",
    wallapopTitle: "Mando Xiaomi XMRM-006 a Estrenar",
    totalAmount: 3.49,
    units: 1,
    vatRate: 21,
    status: "pendiente" as const,
    ...overrides,
  };
}

describe("importWallapopSale", () => {
  beforeEach(() => {
    process.env.CONVEX_BRIDGE_SECRET = SECRET;
  });

  it("creates the customer, sale line and stock movement atomically", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const created = await t.mutation(
      api.domain.importWallapopSale,
      importArgs(),
    );
    expect(created).toMatchObject({
      id: 1,
      created: true,
      customerId: 1,
      productId: 11,
    });

    const replay = await t.mutation(
      api.domain.importWallapopSale,
      importArgs(),
    );
    expect(replay).toEqual({ id: 1, created: false });

    const secondSale = await t.mutation(
      api.domain.importWallapopSale,
      importArgs({ originId: "gmail-message-2", totalAmount: 4.99 }),
    );
    expect(secondSale).toMatchObject({
      id: 2,
      created: true,
      customerId: 1,
      productId: 11,
    });

    const sale = await t.query(api.domain.getSale, {
      bridgeSecret: SECRET,
      actor,
      legacyId: 1,
    });
    expect(sale).toMatchObject({
      id: 1,
      canal: "Wallapop",
      estado: "pendiente",
      cliente: { id: 1, nombre: "Antonio R." },
      origen: "Wallapop",
      origen_id: "gmail-message-1",
    });
    expect(sale?.venta_detalle).toHaveLength(1);

    const customers = await t.query(api.domain.listCustomers, {
      bridgeSecret: SECRET,
      actor,
      projectLegacyId: 7,
      page: 1,
      pageSize: 20,
      search: "antonio",
    });
    expect(customers).toMatchObject({
      count: 1,
      data: [{ id: 1, nombre: "Antonio R." }],
    });

    const counts = await t.run(async (ctx) => ({
      sales: await ctx.db.query("sales").collect(),
      customers: await ctx.db.query("customers").collect(),
      lines: await ctx.db.query("saleLines").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
    }));
    expect(counts.sales).toHaveLength(2);
    expect(counts.customers).toHaveLength(1);
    expect(counts.lines).toHaveLength(2);
    expect(counts.movements).toHaveLength(2);
    expect(counts.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ units: -1, type: "venta" }),
      ]),
    );
  });

  it("rejects an unmapped title without creating customer or sale data", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await expect(
      t.mutation(
        api.domain.importWallapopSale,
        importArgs({ wallapopTitle: "Unknown listing" }),
      ),
    ).rejects.toThrow("No product is mapped to the Wallapop title");

    const counts = await t.run(async (ctx) => ({
      sales: await ctx.db.query("sales").collect(),
      customers: await ctx.db.query("customers").collect(),
    }));
    expect(counts.sales).toHaveLength(0);
    expect(counts.customers).toHaveLength(0);
  });
});

describe("updatePurchase", () => {
  beforeEach(() => {
    process.env.CONVEX_BRIDGE_SECRET = SECRET;
  });

  it("replaces the edited price and keeps stock movement linked", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const purchaseId = await t.mutation(api.domain.createPurchase, {
      bridgeSecret: SECRET,
      actor,
      projectLegacyId: 7,
      date: "2026-08-04T00:00:00",
      status: "recibida",
      items: [{ productId: 11, units: 2, unitPrice: 4.5, vatRate: 21 }],
    });

    await expect(
      t.mutation(api.domain.updatePurchase, {
        bridgeSecret: SECRET,
        actor,
        legacyId: purchaseId,
        date: "2026-08-04T00:00:00",
        status: "recibida",
        items: [{ productId: 11, units: 2, unitPrice: 6.25, vatRate: 21 }],
      }),
    ).resolves.toBe(purchaseId);

    const purchase = await t.query(api.domain.getPurchase, {
      bridgeSecret: SECRET,
      actor,
      legacyId: purchaseId,
    });
    expect(purchase?.compra_detalle).toMatchObject([
      { producto_id: 11, unidades: 2, precio_unitario_compra: 6.25 },
    ]);

    const movements = await t.run(
      async (ctx) => await ctx.db.query("stockMovements").collect(),
    );
    expect(movements).toEqual([
      expect.objectContaining({
        productLegacyId: 11,
        units: 2,
        type: "compra",
      }),
    ]);
  });
});
