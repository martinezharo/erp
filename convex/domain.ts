import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  assertBridgeSecret,
  bridgeArgs,
  cents,
  euros,
  fail,
  nextLegacyId,
  productByLegacyId,
  projectByLegacyId,
  requireProduct,
  requireProject,
  saleByLegacyId,
  purchaseByLegacyId,
  transactionByLegacyId,
  vatPart,
  type Actor,
} from "./lib/bridge";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const itemValidator = v.object({
  productId: v.number(),
  units: v.number(),
  unitPrice: v.number(),
  vatRate: v.number(),
});

const saleStatus = v.union(
  v.literal("pendiente"),
  v.literal("enviada"),
  v.literal("devuelta"),
  v.literal("reembolsada"),
);
const purchaseStatus = v.union(
  v.literal("pendiente"),
  v.literal("recibida"),
  v.literal("cancelada"),
);
const transactionType = v.union(v.literal("ingreso"), v.literal("gasto"));
function check(args: { bridgeSecret: string }): void {
  assertBridgeSecret(args.bridgeSecret);
}

function legacyProject(project: Doc<"projects">) {
  return {
    id: project.legacyId,
    nombre: project.name,
    activo: project.active,
  };
}

async function productsForProject(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">) {
  return await ctx.db
    .query("products")
    .withIndex("by_project_name", (q) => q.eq("projectId", projectId))
    .collect();
}

async function salesForProject(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">) {
  return await ctx.db
    .query("sales")
    .withIndex("by_project_date", (q) => q.eq("projectId", projectId))
    .order("desc")
    .collect();
}

async function purchasesForProject(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">) {
  return await ctx.db
    .query("purchases")
    .withIndex("by_project_date", (q) => q.eq("projectId", projectId))
    .order("desc")
    .collect();
}

async function otherTransactionsForProject(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
) {
  return await ctx.db
    .query("otherTransactions")
    .withIndex("by_project_date", (q) => q.eq("projectId", projectId))
    .order("desc")
    .collect();
}

function normalizeCustomerName(name: string): string {
  return name.trim().toLowerCase();
}

async function customerCountForProject(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
): Promise<number> {
  const counter = await ctx.db
    .query("customerCounts")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
  return counter?.count ?? 0;
}

async function saleByOrigin(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  origin: string,
  originId: string,
) {
  return await ctx.db
    .query("sales")
    .withIndex("by_project_origin", (q) =>
      q.eq("projectId", projectId).eq("origin", origin),
    )
    .filter((q) => q.eq(q.field("originId"), originId))
    .first();
}

async function saleRow(ctx: QueryCtx | MutationCtx, sale: Doc<"sales">) {
  const customer = sale.customerId ? await ctx.db.get(sale.customerId) : null;
  const lines = await ctx.db
    .query("saleLines")
    .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
    .collect();

  const details = await Promise.all(
    lines.map(async (line) => {
      const product = await ctx.db.get(line.productId);
      return {
        id: line.legacyId,
        producto_id: line.productLegacyId,
        unidades: line.units,
        precio_unitario_venta: euros(line.unitPriceCents),
        porcentaje_iva: line.vatRate,
        producto: product ? { nombre: product.name } : null,
      };
    }),
  );

  return {
    id: sale.legacyId,
    proyecto_id: sale.projectLegacyId,
    fecha: sale.date,
    canal: sale.channel,
    estado: sale.status,
    cliente_id: customer?.legacyId ?? null,
    cliente: customer ? { id: customer.legacyId, nombre: customer.name } : null,
    origen: sale.origin ?? "manual",
    origen_id: sale.originId ?? null,
    venta_detalle: details,
  };
}

async function purchaseRow(ctx: QueryCtx | MutationCtx, purchase: Doc<"purchases">) {
  const lines = await ctx.db
    .query("purchaseLines")
    .withIndex("by_purchase", (q) => q.eq("purchaseId", purchase._id))
    .collect();

  const details = await Promise.all(
    lines.map(async (line) => {
      const product = await ctx.db.get(line.productId);
      return {
        id: line.legacyId,
        producto_id: line.productLegacyId,
        unidades: line.units,
        precio_unitario_compra: euros(line.unitPriceCents),
        porcentaje_iva: line.vatRate,
        producto: product ? { nombre: product.name } : null,
      };
    }),
  );

  return {
    id: purchase.legacyId,
    proyecto_id: purchase.projectLegacyId,
    fecha: purchase.date,
    estado: purchase.status,
    compra_detalle: details,
  };
}

export const listProjects = query({
  args: bridgeArgs,
  handler: async (ctx, args) => {
    check(args);
    let projects: Doc<"projects">[];

    if (args.actor.kind === "api_key" && args.actor.projectLegacyId !== undefined) {
      const project = await projectByLegacyId(ctx, args.actor.projectLegacyId);
      projects = project ? [project] : [];
    } else if (args.actor.kind === "api_key") {
      projects = await ctx.db.query("projects").withIndex("by_name").collect();
    } else {
      if (!args.actor.userId) fail("unauthorized", "A user session is required.");
      const memberships = await ctx.db
        .query("projectMembers")
        .withIndex("by_user", (q) => q.eq("userId", args.actor.userId!))
        .collect();
      projects = (
        await Promise.all(memberships.map((membership) => ctx.db.get(membership.projectId)))
      ).filter((project): project is Doc<"projects"> => project !== null);
    }

    // Keep the legacy Supabase ordering so the first project remains the
    // default selected project throughout the Astro UI.
    return projects.sort((a, b) => a.legacyId - b.legacyId).map(legacyProject);
  },
});

export const listProducts = query({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    page: v.number(),
    pageSize: v.number(),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    const search = args.search?.toLowerCase();
    const all = (await productsForProject(ctx, project._id)).filter(
      (product) => !search || product.name.toLowerCase().includes(search),
    );
    const from = Math.max(0, (args.page - 1) * args.pageSize);
    return {
      data: all.slice(from, from + args.pageSize).map((product) => ({
        id: product.legacyId,
        proyecto_id: product.projectLegacyId,
        nombre: product.name,
        titulo_wallapop: product.wallapopTitle ?? null,
      })),
      count: all.length,
    };
  },
});

export const createProduct = mutation({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    name: v.string(),
    wallapopTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    const name = args.name.trim();
    if (!name) fail("validation_error", "Product name cannot be empty.");
    const wallapopTitle = args.wallapopTitle?.trim() || undefined;
    if (wallapopTitle) {
      const mapped = await ctx.db
        .query("products")
        .withIndex("by_project_wallapop_title", (q) =>
          q.eq("projectId", project._id).eq("wallapopTitle", wallapopTitle),
        )
        .first();
      if (mapped) fail("conflict", "That Wallapop title is already mapped to a product.");
    }
    const legacyId = await nextLegacyId(ctx, "products");
    const id = await ctx.db.insert("products", {
      legacyId,
      projectId: project._id,
      projectLegacyId: project.legacyId,
      name,
      ...(wallapopTitle ? { wallapopTitle } : {}),
    });
    return {
      id: legacyId,
      proyecto_id: project.legacyId,
      nombre: name,
      titulo_wallapop: wallapopTitle ?? null,
      _id: id,
    };
  },
});

export const updateProductWallapopTitle = mutation({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    productLegacyId: v.number(),
    wallapopTitle: v.string(),
  },
  handler: async (ctx, args) => {
    check(args);
    const product = await requireProduct(
      ctx,
      args.actor,
      args.projectLegacyId,
      args.productLegacyId,
    );
    const wallapopTitle = args.wallapopTitle.trim();
    if (!wallapopTitle) fail("validation_error", "Wallapop title cannot be empty.");

    const mapped = await ctx.db
      .query("products")
      .withIndex("by_project_wallapop_title", (q) =>
        q.eq("projectId", product.projectId).eq("wallapopTitle", wallapopTitle),
      )
      .first();
    if (mapped && mapped._id !== product._id) {
      fail("conflict", "That Wallapop title is already mapped to a product.");
    }

    await ctx.db.patch(product._id, { wallapopTitle });
    return {
      id: product.legacyId,
      proyecto_id: product.projectLegacyId,
      nombre: product.name,
      titulo_wallapop: wallapopTitle,
    };
  },
});

export const listCustomers = query({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    page: v.number(),
    pageSize: v.number(),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    const search = args.search?.trim().toLowerCase();
    const from = Math.max(0, (args.page - 1) * args.pageSize);
    const scanLimit = search
      ? 10_000
      : Math.min(Math.max(from + args.pageSize + 1, args.pageSize * 10), 10_000);
    const candidates = await ctx.db
      .query("customers")
      .withIndex("by_project_name", (q) => q.eq("projectId", project._id))
      .take(scanLimit);
    const rows = search
      ? candidates.filter((customer) => customer.normalizedName.includes(search))
      : candidates;
    const count = search ? rows.length : await customerCountForProject(ctx, project._id);

    return {
      data: rows.slice(from, from + args.pageSize).map((customer) => ({
        id: customer.legacyId,
        proyecto_id: customer.projectLegacyId,
        nombre: customer.name,
        creado_en: customer.createdAt,
        actualizado_en: customer.updatedAt,
      })),
      count,
    };
  },
});

export const getProduct = query({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    productLegacyId: v.number(),
  },
  handler: async (ctx, args) => {
    check(args);
    const product = await requireProduct(
      ctx,
      args.actor,
      args.projectLegacyId,
      args.productLegacyId,
    );
    return {
      id: product.legacyId,
      proyecto_id: product.projectLegacyId,
      nombre: product.name,
      titulo_wallapop: product.wallapopTitle ?? null,
    };
  },
});

export const getProductGlobal = query({
  args: { ...bridgeArgs, productLegacyId: v.number() },
  handler: async (ctx, args) => {
    check(args);
    const product = await ctx.db
      .query("products")
      .withIndex("by_legacy_id", (q) => q.eq("legacyId", args.productLegacyId))
      .unique();
    if (!product) return null;
    await requireProject(ctx, args.actor, product.projectLegacyId);
    return {
      id: product.legacyId,
      proyecto_id: product.projectLegacyId,
      nombre: product.name,
      titulo_wallapop: product.wallapopTitle ?? null,
    };
  },
});

export const listSales = query({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    page: v.number(),
    pageSize: v.number(),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    status: v.optional(saleStatus),
    channel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    const rows = (await salesForProject(ctx, project._id)).filter((sale) => {
      if (args.fromDate && sale.date < args.fromDate) return false;
      if (args.toDate && sale.date > args.toDate) return false;
      if (args.status && sale.status !== args.status) return false;
      if (args.channel && sale.channel !== args.channel) return false;
      return true;
    });
    const from = Math.max(0, (args.page - 1) * args.pageSize);
    return {
      data: await Promise.all(rows.slice(from, from + args.pageSize).map((sale) => saleRow(ctx, sale))),
      count: rows.length,
    };
  },
});

export const getSale = query({
  args: { ...bridgeArgs, legacyId: v.number() },
  handler: async (ctx, args) => {
    check(args);
    const sale = await saleByLegacyId(ctx, args.legacyId);
    if (!sale) return null;
    await requireProject(ctx, args.actor, sale.projectLegacyId);
    return await saleRow(ctx, sale);
  },
});

async function insertSaleLines(
  ctx: MutationCtx,
  sale: Doc<"sales">,
  items: Array<{ productId: number; units: number; unitPrice: number; vatRate: number }>,
) {
  if (items.length === 0) fail("validation_error", "A sale needs at least one line.");
  let lineLegacyId = await nextLegacyId(ctx, "saleLines");
  let movementLegacyId = await nextLegacyId(ctx, "stockMovements");

  for (const item of items) {
    const product = await productByLegacyId(ctx, sale.projectLegacyId, item.productId);
    if (!product) {
      fail(
        "validation_error",
        `Product ${item.productId} does not belong to project ${sale.projectLegacyId}.`,
      );
    }
    if (!Number.isInteger(item.units) || item.units <= 0) {
      fail("validation_error", "Sale units must be positive integers.");
    }
    const lineId = await ctx.db.insert("saleLines", {
      legacyId: lineLegacyId++,
      saleId: sale._id,
      projectId: sale.projectId,
      projectLegacyId: sale.projectLegacyId,
      productId: product._id,
      productLegacyId: product.legacyId,
      units: item.units,
      unitPriceCents: cents(item.unitPrice),
      vatRate: item.vatRate,
    });
    await ctx.db.insert("stockMovements", {
      legacyId: movementLegacyId++,
      productId: product._id,
      productLegacyId: product.legacyId,
      projectId: sale.projectId,
      projectLegacyId: sale.projectLegacyId,
      units: -item.units,
      type: "venta",
      saleLineId: lineId,
      date: sale.date,
    });
  }
}

export const createSale = mutation({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    date: v.string(),
    channel: v.string(),
    status: saleStatus,
    items: v.array(itemValidator),
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    if (!args.channel.trim()) fail("validation_error", "Sale channel cannot be empty.");
    const legacyId = await nextLegacyId(ctx, "sales");
    const saleId = await ctx.db.insert("sales", {
      legacyId,
      projectId: project._id,
      projectLegacyId: project.legacyId,
      date: args.date,
      channel: args.channel,
      status: args.status,
    });
    const sale = (await ctx.db.get(saleId))!;
    await insertSaleLines(ctx, sale, args.items);
    return legacyId;
  },
});

export const importWallapopSale = mutation({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    originId: v.string(),
    date: v.string(),
    customerName: v.string(),
    wallapopTitle: v.string(),
    totalAmount: v.number(),
    units: v.number(),
    vatRate: v.number(),
    status: saleStatus,
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    const originId = args.originId.trim();
    const customerName = args.customerName.trim();
    const wallapopTitle = args.wallapopTitle.trim();

    if (!originId || !customerName || !wallapopTitle) {
      fail("validation_error", "Origin id, customer name and Wallapop title are required.");
    }
    if (!Number.isFinite(args.totalAmount) || args.totalAmount <= 0) {
      fail("validation_error", "The total amount must be greater than zero.");
    }
    if (!Number.isInteger(args.units) || args.units <= 0) {
      fail("validation_error", "Sale units must be positive integers.");
    }

    const existing = await saleByOrigin(ctx, project._id, "Wallapop", originId);
    if (existing) return { id: existing.legacyId, created: false };

    const product = await ctx.db
      .query("products")
      .withIndex("by_project_wallapop_title", (q) =>
        q.eq("projectId", project._id).eq("wallapopTitle", wallapopTitle),
      )
      .first();
    if (!product) {
      fail("not_found", `No product is mapped to the Wallapop title: ${wallapopTitle}`);
    }

    const normalizedName = normalizeCustomerName(customerName);
    let customer = await ctx.db
      .query("customers")
      .withIndex("by_project_normalized_name", (q) =>
        q.eq("projectId", project._id).eq("normalizedName", normalizedName),
      )
      .first();
    const isNewCustomer = !customer;
    const now = new Date().toISOString();

    if (customer) {
      await ctx.db.patch(customer._id, { name: customerName, updatedAt: now });
    } else {
      const legacyId = await nextLegacyId(ctx, "customers");
      const customerId = await ctx.db.insert("customers", {
        legacyId,
        projectId: project._id,
        projectLegacyId: project.legacyId,
        name: customerName,
        normalizedName,
        createdAt: now,
        updatedAt: now,
      });
      customer = (await ctx.db.get(customerId))!;
    }

    const counter = await ctx.db
      .query("customerCounts")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .unique();
    if (counter) {
      if (counter.count < 1) {
        await ctx.db.patch(counter._id, { count: 1 });
      } else if (isNewCustomer) {
        await ctx.db.patch(counter._id, { count: counter.count + 1 });
      }
    } else {
      await ctx.db.insert("customerCounts", {
        projectId: project._id,
        projectLegacyId: project.legacyId,
        count: 1,
      });
    }

    const legacyId = await nextLegacyId(ctx, "sales");
    const saleId = await ctx.db.insert("sales", {
      legacyId,
      projectId: project._id,
      projectLegacyId: project.legacyId,
      date: args.date,
      channel: "Wallapop",
      status: args.status,
      customerId: customer._id,
      origin: "Wallapop",
      originId,
    });
    const sale = (await ctx.db.get(saleId))!;
    await insertSaleLines(ctx, sale, [
      {
        productId: product.legacyId,
        units: args.units,
        unitPrice: args.totalAmount / args.units,
        vatRate: args.vatRate,
      },
    ]);

    return {
      id: legacyId,
      created: true,
      customerId: customer.legacyId,
      productId: product.legacyId,
    };
  },
});

export const updateSale = mutation({
  args: {
    ...bridgeArgs,
    legacyId: v.number(),
    date: v.optional(v.string()),
    channel: v.optional(v.string()),
    status: v.optional(saleStatus),
    items: v.optional(v.array(itemValidator)),
  },
  handler: async (ctx, args) => {
    check(args);
    const existing = await saleByLegacyId(ctx, args.legacyId);
    if (!existing) fail("not_found", `Sale ${args.legacyId} not found.`);
    await requireProject(ctx, args.actor, existing.projectLegacyId);

    const nextDate = args.date ?? existing.date;
    const nextChannel = args.channel ?? existing.channel;
    if (!nextChannel.trim()) fail("validation_error", "Sale channel cannot be empty.");
    await ctx.db.patch(existing._id, {
      date: nextDate,
      channel: nextChannel,
      ...(args.status ? { status: args.status } : {}),
    });

    if (args.items !== undefined) {
      if (args.items.length === 0) fail("validation_error", "A sale needs at least one line.");
      const lines = await ctx.db
        .query("saleLines")
        .withIndex("by_sale", (q) => q.eq("saleId", existing._id))
        .collect();
      for (const line of lines) {
        const movements = await ctx.db
          .query("stockMovements")
          .withIndex("by_sale_line", (q) => q.eq("saleLineId", line._id))
          .collect();
        for (const movement of movements) await ctx.db.delete(movement._id);
        await ctx.db.delete(line._id);
      }
      const updated = (await ctx.db.get(existing._id))!;
      await insertSaleLines(ctx, updated, args.items);
    }

    return args.legacyId;
  },
});

export const deleteSale = mutation({
  args: { ...bridgeArgs, legacyId: v.number() },
  handler: async (ctx, args) => {
    check(args);
    const sale = await saleByLegacyId(ctx, args.legacyId);
    if (!sale) return false;
    await requireProject(ctx, args.actor, sale.projectLegacyId);
    const lines = await ctx.db
      .query("saleLines")
      .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
      .collect();
    for (const line of lines) {
      const movements = await ctx.db
        .query("stockMovements")
        .withIndex("by_sale_line", (q) => q.eq("saleLineId", line._id))
        .collect();
      for (const movement of movements) await ctx.db.delete(movement._id);
      await ctx.db.delete(line._id);
    }
    await ctx.db.delete(sale._id);
    return true;
  },
});

export const listPurchases = query({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    page: v.number(),
    pageSize: v.number(),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    status: v.optional(purchaseStatus),
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    const rows = (await purchasesForProject(ctx, project._id)).filter((purchase) => {
      if (args.fromDate && purchase.date < args.fromDate) return false;
      if (args.toDate && purchase.date > args.toDate) return false;
      if (args.status && purchase.status !== args.status) return false;
      return true;
    });
    const from = Math.max(0, (args.page - 1) * args.pageSize);
    return {
      data: await Promise.all(
        rows.slice(from, from + args.pageSize).map((purchase) => purchaseRow(ctx, purchase)),
      ),
      count: rows.length,
    };
  },
});

export const getPurchase = query({
  args: { ...bridgeArgs, legacyId: v.number() },
  handler: async (ctx, args) => {
    check(args);
    const purchase = await purchaseByLegacyId(ctx, args.legacyId);
    if (!purchase) return null;
    await requireProject(ctx, args.actor, purchase.projectLegacyId);
    return await purchaseRow(ctx, purchase);
  },
});

async function insertPurchaseLines(
  ctx: MutationCtx,
  purchase: Doc<"purchases">,
  items: Array<{ productId: number; units: number; unitPrice: number; vatRate: number }>,
) {
  if (items.length === 0) fail("validation_error", "A purchase needs at least one line.");
  let lineLegacyId = await nextLegacyId(ctx, "purchaseLines");
  let movementLegacyId = await nextLegacyId(ctx, "stockMovements");

  for (const item of items) {
    const product = await productByLegacyId(ctx, purchase.projectLegacyId, item.productId);
    if (!product) {
      fail(
        "validation_error",
        `Product ${item.productId} does not belong to project ${purchase.projectLegacyId}.`,
      );
    }
    if (!Number.isInteger(item.units) || item.units <= 0) {
      fail("validation_error", "Purchase units must be positive integers.");
    }
    const lineId = await ctx.db.insert("purchaseLines", {
      legacyId: lineLegacyId++,
      purchaseId: purchase._id,
      projectId: purchase.projectId,
      projectLegacyId: purchase.projectLegacyId,
      productId: product._id,
      productLegacyId: product.legacyId,
      units: item.units,
      unitPriceCents: cents(item.unitPrice),
      vatRate: item.vatRate,
    });
    await ctx.db.insert("stockMovements", {
      legacyId: movementLegacyId++,
      productId: product._id,
      productLegacyId: product.legacyId,
      projectId: purchase.projectId,
      projectLegacyId: purchase.projectLegacyId,
      units: item.units,
      type: "compra",
      purchaseLineId: lineId,
      date: purchase.date,
    });
  }
}

export const createPurchase = mutation({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    date: v.string(),
    status: purchaseStatus,
    items: v.array(itemValidator),
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    const legacyId = await nextLegacyId(ctx, "purchases");
    const purchaseId = await ctx.db.insert("purchases", {
      legacyId,
      projectId: project._id,
      projectLegacyId: project.legacyId,
      date: args.date,
      status: args.status,
    });
    const purchase = (await ctx.db.get(purchaseId))!;
    await insertPurchaseLines(ctx, purchase, args.items);
    return legacyId;
  },
});

export const updatePurchase = mutation({
  args: {
    ...bridgeArgs,
    legacyId: v.number(),
    date: v.optional(v.string()),
    status: v.optional(purchaseStatus),
    items: v.optional(v.array(itemValidator)),
  },
  handler: async (ctx, args) => {
    check(args);
    const existing = await purchaseByLegacyId(ctx, args.legacyId);
    if (!existing) fail("not_found", `Purchase ${args.legacyId} not found.`);
    await requireProject(ctx, args.actor, existing.projectLegacyId);
    await ctx.db.patch(existing._id, {
      date: args.date ?? existing.date,
      ...(args.status ? { status: args.status } : {}),
    });

    if (args.items !== undefined) {
      if (args.items.length === 0) fail("validation_error", "A purchase needs at least one line.");
      const lines = await ctx.db
        .query("purchaseLines")
        .withIndex("by_purchase", (q) => q.eq("purchaseId", existing._id))
        .collect();
      for (const line of lines) {
        const movements = await ctx.db
          .query("stockMovements")
          .withIndex("by_purchase_line", (q) => q.eq("purchaseLineId", line._id))
          .collect();
        for (const movement of movements) await ctx.db.delete(movement._id);
        await ctx.db.delete(line._id);
      }
      const updated = (await ctx.db.get(existing._id))!;
      await insertPurchaseLines(ctx, updated, args.items);
    }
    return args.legacyId;
  },
});

export const deletePurchase = mutation({
  args: { ...bridgeArgs, legacyId: v.number() },
  handler: async (ctx, args) => {
    check(args);
    const purchase = await purchaseByLegacyId(ctx, args.legacyId);
    if (!purchase) return false;
    await requireProject(ctx, args.actor, purchase.projectLegacyId);
    const lines = await ctx.db
      .query("purchaseLines")
      .withIndex("by_purchase", (q) => q.eq("purchaseId", purchase._id))
      .collect();
    for (const line of lines) {
      const movements = await ctx.db
        .query("stockMovements")
        .withIndex("by_purchase_line", (q) => q.eq("purchaseLineId", line._id))
        .collect();
      for (const movement of movements) await ctx.db.delete(movement._id);
      await ctx.db.delete(line._id);
    }
    await ctx.db.delete(purchase._id);
    return true;
  },
});

export const listOtherTransactions = query({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    page: v.number(),
    pageSize: v.number(),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    type: v.optional(transactionType),
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    const rows = (await otherTransactionsForProject(ctx, project._id)).filter((row) => {
      if (args.fromDate && row.date < args.fromDate) return false;
      if (args.toDate && row.date > args.toDate) return false;
      if (args.type && row.type !== args.type) return false;
      return true;
    });
    const from = Math.max(0, (args.page - 1) * args.pageSize);
    return {
      data: rows.slice(from, from + args.pageSize).map((row) => ({
        id: row.legacyId,
        proyecto_id: row.projectLegacyId,
        tipo: row.type,
        concepto: row.concept,
        descripcion: row.description ?? null,
        importe: euros(row.amountCents),
        porcentaje_iva: row.vatRate,
        fecha: row.date,
      })),
      count: rows.length,
    };
  },
});

export const getOtherTransaction = query({
  args: { ...bridgeArgs, legacyId: v.number() },
  handler: async (ctx, args) => {
    check(args);
    const row = await transactionByLegacyId(ctx, args.legacyId);
    if (!row) return null;
    await requireProject(ctx, args.actor, row.projectLegacyId);
    return {
      id: row.legacyId,
      proyecto_id: row.projectLegacyId,
      tipo: row.type,
      concepto: row.concept,
      descripcion: row.description ?? null,
      importe: euros(row.amountCents),
      porcentaje_iva: row.vatRate,
      fecha: row.date,
    };
  },
});

export const createOtherTransaction = mutation({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    type: transactionType,
    concept: v.string(),
    description: v.optional(v.string()),
    amount: v.number(),
    vatRate: v.number(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    if (!args.concept.trim() || args.amount <= 0) {
      fail("validation_error", "Transaction concept and amount are required.");
    }
    const legacyId = await nextLegacyId(ctx, "otherTransactions");
    await ctx.db.insert("otherTransactions", {
      legacyId,
      projectId: project._id,
      projectLegacyId: project.legacyId,
      type: args.type,
      concept: args.concept.trim(),
      ...(args.description ? { description: args.description } : {}),
      amountCents: cents(args.amount),
      vatRate: args.vatRate,
      date: args.date,
    });
    return legacyId;
  },
});

export const updateOtherTransaction = mutation({
  args: {
    ...bridgeArgs,
    legacyId: v.number(),
    type: v.optional(transactionType),
    concept: v.optional(v.string()),
    description: v.optional(v.string()),
    amount: v.optional(v.number()),
    vatRate: v.optional(v.number()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    check(args);
    const row = await transactionByLegacyId(ctx, args.legacyId);
    if (!row) fail("not_found", `Transaction ${args.legacyId} not found.`);
    await requireProject(ctx, args.actor, row.projectLegacyId);
    if (args.concept !== undefined && !args.concept.trim()) {
      fail("validation_error", "Transaction concept cannot be empty.");
    }
    if (args.amount !== undefined && args.amount <= 0) {
      fail("validation_error", "Transaction amount must be positive.");
    }
    await ctx.db.patch(row._id, {
      ...(args.type ? { type: args.type } : {}),
      ...(args.concept !== undefined ? { concept: args.concept.trim() } : {}),
      ...(args.description !== undefined
        ? args.description
          ? { description: args.description }
          : { description: undefined }
        : {}),
      ...(args.amount !== undefined ? { amountCents: cents(args.amount) } : {}),
      ...(args.vatRate !== undefined ? { vatRate: args.vatRate } : {}),
      ...(args.date ? { date: args.date } : {}),
    });
    return args.legacyId;
  },
});

export const deleteOtherTransaction = mutation({
  args: { ...bridgeArgs, legacyId: v.number() },
  handler: async (ctx, args) => {
    check(args);
    const row = await transactionByLegacyId(ctx, args.legacyId);
    if (!row) return false;
    await requireProject(ctx, args.actor, row.projectLegacyId);
    await ctx.db.delete(row._id);
    return true;
  },
});

type StockRow = {
  proyecto_id: number;
  nombre_proyecto: string;
  producto_id: number;
  nombre_producto: string;
  stock_actual: number;
  coste_ud: number;
  venta_ud: number;
  num_ventas_30d: number;
  beneficio_ud: number;
  beneficio_total_30d: number;
  valor_stock: number;
  venta_diaria_promedio: number;
  dias_stock_restante: number;
};

function dateMillis(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function stockRowsForProject(
  ctx: QueryCtx | MutationCtx,
  project: Doc<"projects">,
): Promise<StockRow[]> {
  const products = await productsForProject(ctx, project._id);
  const movements = await ctx.db
    .query("stockMovements")
    .withIndex("by_project_date", (q) => q.eq("projectId", project._id))
    .collect();
  const saleLines = await ctx.db
    .query("saleLines")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  const purchaseLines = await ctx.db
    .query("purchaseLines")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  const sales = await salesForProject(ctx, project._id);
  const purchases = await purchasesForProject(ctx, project._id);
  const salesById = new Map(sales.map((sale) => [sale._id, sale]));
  const purchasesById = new Map(purchases.map((purchase) => [purchase._id, purchase]));
  const now = Date.now();
  const cutoff30 = now - 30 * 24 * 60 * 60 * 1000;
  const cutoff60 = now - 60 * 24 * 60 * 60 * 1000;

  return products.map((product) => {
    const productMovements = movements.filter((movement) => movement.productId === product._id);
    const productSaleLines = saleLines.filter((line) => line.productId === product._id);
    const productPurchaseLines = purchaseLines.filter((line) => line.productId === product._id);
    const stock = productMovements.reduce((sum, movement) => sum + movement.units, 0);
    const recentPurchases = productPurchaseLines.filter(
      (line) => dateMillis(purchasesById.get(line.purchaseId)?.date ?? "") >= cutoff60,
    );
    const purchasePrices = (recentPurchases.length ? recentPurchases : productPurchaseLines).map(
      (line) => line.unitPriceCents,
    );
    const cost = purchasePrices.length
      ? purchasePrices.reduce((sum, value) => sum + value, 0) / purchasePrices.length
      : 0;
    const recentSales = productSaleLines.filter(
      (line) => dateMillis(salesById.get(line.saleId)?.date ?? "") >= cutoff30,
    );
    const salePriceLines = recentSales.length ? recentSales : productSaleLines;
    const salePrice = salePriceLines.length
      ? salePriceLines.reduce((sum, line) => sum + line.unitPriceCents, 0) / salePriceLines.length
      : 0;
    const sales30 = recentSales.reduce((sum, line) => sum + line.units, 0);
    const daily = sales30 / 30;
    const days = daily > 0 ? stock / daily : 999;
    const costEuros = euros(cost);
    const saleEuros = euros(salePrice);
    const profit = saleEuros - costEuros;
    return {
      proyecto_id: project.legacyId,
      nombre_proyecto: project.name,
      producto_id: product.legacyId,
      nombre_producto: product.name,
      stock_actual: stock,
      coste_ud: costEuros,
      venta_ud: saleEuros,
      num_ventas_30d: sales30,
      beneficio_ud: profit,
      beneficio_total_30d: profit * sales30,
      valor_stock: stock * saleEuros,
      venta_diaria_promedio: daily,
      dias_stock_restante: days,
    };
  });
}

export const listStock = query({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    page: v.number(),
    pageSize: v.number(),
    maxDays: v.optional(v.number()),
    maxUnits: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    const rows = (await stockRowsForProject(ctx, project)).filter((row) =>
      (args.maxDays === undefined || row.dias_stock_restante <= args.maxDays) &&
      (args.maxUnits === undefined || row.stock_actual <= args.maxUnits),
    ).sort((a, b) => a.dias_stock_restante - b.dias_stock_restante);
    const from = Math.max(0, (args.page - 1) * args.pageSize);
    return { data: rows.slice(from, from + args.pageSize), count: rows.length };
  },
});

export const getStockForProduct = query({
  args: { ...bridgeArgs, projectLegacyId: v.number(), productLegacyId: v.number() },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    const row = (await stockRowsForProject(ctx, project)).find(
      (item) => item.producto_id === args.productLegacyId,
    );
    return row ?? null;
  },
});

export const listStockMovements = query({
  args: { ...bridgeArgs, projectLegacyId: v.number(), productLegacyId: v.number() },
  handler: async (ctx, args) => {
    check(args);
    const product = await requireProduct(
      ctx,
      args.actor,
      args.projectLegacyId,
      args.productLegacyId,
    );
    const movements = await ctx.db
      .query("stockMovements")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .collect();
    const rows = await Promise.all(
      movements.map(async (movement) => {
        let date = movement.date;
        let price: number | null = null;
        let channel = "-";

        if (movement.purchaseLineId) {
          const line = await ctx.db.get(movement.purchaseLineId);
          if (line) {
            const purchase = await ctx.db.get(line.purchaseId);
            if (purchase) {
              date = purchase.date;
              price = euros(line.unitPriceCents);
              channel = "Proveedor";
            }
          }
        } else if (movement.saleLineId) {
          const line = await ctx.db.get(movement.saleLineId);
          if (line) {
            const sale = await ctx.db.get(line.saleId);
            if (sale) {
              date = sale.date;
              price = euros(line.unitPriceCents);
              channel = sale.channel || "Directo";
            }
          }
        } else if (movement.type === "ajuste manual") {
          channel = "Manual";
        }

        return {
          id: movement.legacyId,
          fecha: date,
          tipo: movement.type,
          unidades: movement.units,
          precio: price,
          canal: channel,
        };
      }),
    );
    return rows.sort((a, b) => dateMillis(b.fecha) - dateMillis(a.fecha));
  },
});

export const adjustStock = mutation({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    productLegacyId: v.number(),
    units: v.number(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    check(args);
    const product = await requireProduct(
      ctx,
      args.actor,
      args.projectLegacyId,
      args.productLegacyId,
    );
    if (!Number.isInteger(args.units) || args.units === 0) {
      fail("validation_error", "Stock adjustment must be a non-zero integer.");
    }
    const legacyId = await nextLegacyId(ctx, "stockMovements");
    await ctx.db.insert("stockMovements", {
      legacyId,
      productId: product._id,
      productLegacyId: product.legacyId,
      projectId: product.projectId,
      projectLegacyId: product.projectLegacyId,
      units: args.units,
      type: "ajuste manual",
      date: args.date,
    });
    return {
      id: legacyId,
      producto_id: product.legacyId,
      unidades: args.units,
      tipo_movimiento: "ajuste manual" as const,
      fecha: args.date,
    };
  },
});

type FinanceRow = {
  dia: string;
  proyecto_id: number;
  nombre_proyecto: string;
  ingresos: number;
  gastos: number;
  balance: number;
  urp: number;
  iva_soportado: number;
  iva_repercutido: number;
  saldo_iva: number;
};

function dayOf(value: string): string {
  return value.slice(0, 10);
}

type DailyFinanceArgs = {
  bridgeSecret: string;
  actor: Actor;
  projectLegacyId: number;
  fromDate?: string;
  toDate?: string;
};

async function computeDailyFinances(ctx: QueryCtx, args: DailyFinanceArgs) {
  check(args);
  const project = await requireProject(ctx, args.actor, args.projectLegacyId);
  const sales = await salesForProject(ctx, project._id);
  const purchases = await purchasesForProject(ctx, project._id);
  const others = await otherTransactionsForProject(ctx, project._id);
  const saleLines = await ctx.db
    .query("saleLines")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  const purchaseLines = await ctx.db
    .query("purchaseLines")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  const salesById = new Map(sales.map((sale) => [sale._id, sale]));
  const purchasesById = new Map(purchases.map((purchase) => [purchase._id, purchase]));
  const latestByProduct = new Map<Id<"products">, { date: number; cost: number }>();
  for (const line of purchaseLines) {
    const purchase = purchasesById.get(line.purchaseId);
    if (!purchase) continue;
    const date = dateMillis(purchase.date);
    const previous = latestByProduct.get(line.productId);
    if (!previous || date >= previous.date) {
      latestByProduct.set(line.productId, { date, cost: line.unitPriceCents });
    }
  }
  const grouped = new Map<string, FinanceRow>();
  const get = (day: string) => {
    let row = grouped.get(day);
    if (!row) {
      row = {
        dia: day,
        proyecto_id: project.legacyId,
        nombre_proyecto: project.name,
        ingresos: 0,
        gastos: 0,
        balance: 0,
        urp: 0,
        iva_soportado: 0,
        iva_repercutido: 0,
        saldo_iva: 0,
      };
      grouped.set(day, row);
    }
    return row;
  };

  for (const line of saleLines) {
    const sale = salesById.get(line.saleId);
    if (!sale || sale.status !== "enviada") continue;
    const row = get(dayOf(sale.date));
    const gross = line.units * line.unitPriceCents;
    const vat = vatPart(gross, line.vatRate);
    const cost = (latestByProduct.get(line.productId)?.cost ?? 0) * line.units;
    row.ingresos += gross;
    row.urp += gross - cost;
    row.iva_repercutido += vat;
  }
  for (const line of purchaseLines) {
    const purchase = purchasesById.get(line.purchaseId);
    if (!purchase || purchase.status !== "recibida") continue;
    const row = get(dayOf(purchase.date));
    const gross = line.units * line.unitPriceCents;
    row.gastos += gross;
    row.iva_soportado += vatPart(gross, line.vatRate);
    row.urp -= gross;
  }
  for (const other of others) {
    const row = get(dayOf(other.date));
    const gross = other.amountCents;
    if (other.type === "ingreso") {
      row.ingresos += gross;
      row.iva_repercutido += vatPart(gross, other.vatRate);
    } else {
      row.gastos += gross;
      row.urp -= gross;
      row.iva_soportado += vatPart(gross, other.vatRate);
    }
  }

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      ingresos: euros(row.ingresos),
      gastos: euros(row.gastos),
      balance: euros(row.ingresos - row.gastos),
      urp: euros(row.urp),
      iva_soportado: euros(row.iva_soportado),
      iva_repercutido: euros(row.iva_repercutido),
      saldo_iva: euros(row.iva_repercutido - row.iva_soportado),
    }))
    .filter((row) =>
      (!args.fromDate || row.dia >= dayOf(args.fromDate)) &&
      (!args.toDate || row.dia <= dayOf(args.toDate)),
    )
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

export const listDailyFinances = query({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
  },
  handler: computeDailyFinances,
});

export const financeEvolution = query({
  args: { ...bridgeArgs, projectLegacyId: v.number(), fromDate: v.string() },
  handler: async (ctx, args) => {
    const rows = await computeDailyFinances(ctx, {
      ...args,
      toDate: undefined,
    });
    return rows
      .filter((row: FinanceRow) => row.dia >= dayOf(args.fromDate))
      .map((row) => ({ dia: row.dia, ingresos: row.ingresos, urp: row.urp }));
  },
});

async function visibleProjects(ctx: QueryCtx | MutationCtx, actor: Actor) {
  if (actor.kind === "api_key") {
    if (actor.projectLegacyId !== undefined) {
      const project = await projectByLegacyId(ctx, actor.projectLegacyId);
      return project ? [project] : [];
    }
    return await ctx.db.query("projects").withIndex("by_name").collect();
  }
  if (!actor.userId) fail("unauthorized", "A user session is required.");
  const memberships = await ctx.db
    .query("projectMembers")
    .withIndex("by_user", (q) => q.eq("userId", actor.userId!))
    .collect();
  return (
    await Promise.all(memberships.map((membership) => ctx.db.get(membership.projectId)))
  ).filter((project): project is Doc<"projects"> => project !== null);
}

export const salesInitData = query({
  args: { ...bridgeArgs, projectLegacyId: v.optional(v.number()) },
  handler: async (ctx, args) => {
    check(args);
    const projects = await visibleProjects(ctx, args.actor);
    const selected = args.projectLegacyId
      ? projects.filter((project) => project.legacyId === args.projectLegacyId)
      : projects;
    const stock = (
      await Promise.all(selected.map((project) => stockRowsForProject(ctx, project)))
    ).flat();
    const sales = (
      await Promise.all(selected.map((project) => salesForProject(ctx, project._id)))
    ).flat();
    return {
      products: stock.map((row) => ({
        id: row.producto_id,
        name: row.nombre_producto,
        price: row.venta_ud,
        stock: row.stock_actual,
      })),
      channels: Array.from(new Set(sales.map((sale) => sale.channel))).sort(),
    };
  },
});

export const transactionSources = query({
  args: {
    ...bridgeArgs,
    projectLegacyId: v.number(),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    check(args);
    const project = await requireProject(ctx, args.actor, args.projectLegacyId);
    const sales = (await salesForProject(ctx, project._id)).filter(
      (sale) =>
        (!args.fromDate || sale.date >= args.fromDate) &&
        (!args.toDate || sale.date <= args.toDate),
    );
    const purchases = (await purchasesForProject(ctx, project._id)).filter(
      (purchase) =>
        (!args.fromDate || purchase.date >= args.fromDate) &&
        (!args.toDate || purchase.date <= args.toDate),
    );
    const others = (await otherTransactionsForProject(ctx, project._id)).filter(
      (row) =>
        (!args.fromDate || row.date >= args.fromDate) &&
        (!args.toDate || row.date <= args.toDate),
    );
    return {
      sales: await Promise.all(sales.map((sale) => saleRow(ctx, sale))),
      purchases: await Promise.all(purchases.map((purchase) => purchaseRow(ctx, purchase))),
      others: others.map((row) => ({
        id: row.legacyId,
        proyecto_id: row.projectLegacyId,
        tipo: row.type,
        concepto: row.concept,
        descripcion: row.description ?? null,
        importe: euros(row.amountCents),
        porcentaje_iva: row.vatRate,
        fecha: row.date,
      })),
    };
  },
});

export const apiKeyByHash = query({
  args: { bridgeSecret: v.string(), keyHash: v.string() },
  handler: async (ctx, args) => {
    check(args);
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("keyHash", args.keyHash))
      .unique();
    if (!key) return null;
    return {
      id: key._id,
      proyecto_id: key.projectLegacyId ?? null,
      scopes: key.scopes,
      activa: key.active,
      expira_en: key.expiresAt ?? null,
      ultimo_uso_en: key.lastUsedAt ?? null,
    };
  },
});

export const touchApiKey = mutation({
  args: { bridgeSecret: v.string(), keyId: v.string(), lastUsedAt: v.string() },
  handler: async (ctx, args) => {
    check(args);
    const key = await ctx.db.get(args.keyId as Id<"apiKeys">);
    if (key) await ctx.db.patch(key._id, { lastUsedAt: args.lastUsedAt });
    return null;
  },
});

export const createApiKey = mutation({
  args: {
    bridgeSecret: v.string(),
    name: v.string(),
    projectLegacyId: v.optional(v.number()),
    keyHash: v.string(),
    keyPrefix: v.string(),
    scopes: v.array(v.union(v.literal("read"), v.literal("write"))),
    expiresAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    check(args);
    const id = await ctx.db.insert("apiKeys", {
      name: args.name,
      keyHash: args.keyHash,
      keyPrefix: args.keyPrefix,
      ...(args.projectLegacyId !== undefined
        ? { projectLegacyId: args.projectLegacyId }
        : {}),
      scopes: args.scopes,
      active: true,
      ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
      createdAt: new Date().toISOString(),
    });
    return {
      id,
      nombre: args.name,
      proyecto_id: args.projectLegacyId ?? null,
      scopes: args.scopes,
      expira_en: args.expiresAt ?? null,
    };
  },
});

const IN_FLIGHT = 0;

export const reserveIdempotency = mutation({
  args: {
    ...bridgeArgs,
    key: v.string(),
    endpoint: v.string(),
    requestHash: v.string(),
  },
  handler: async (ctx, args) => {
    check(args);
    const existing = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key_endpoint", (q) =>
        q.eq("key", args.key).eq("endpoint", args.endpoint),
      )
      .unique();
    if (existing) {
      if (existing.requestHash !== args.requestHash) {
        return { status: "mismatch" as const };
      }
      if (existing.responseStatus === IN_FLIGHT) {
        return { status: "in_flight" as const };
      }
      return {
        status: "replay" as const,
        responseStatus: existing.responseStatus,
        responseBody: existing.responseBody,
      };
    }
    await ctx.db.insert("idempotencyKeys", {
      key: args.key,
      endpoint: args.endpoint,
      ...(args.actor.apiKeyId ? { apiKeyId: args.actor.apiKeyId } : {}),
      requestHash: args.requestHash,
      responseStatus: IN_FLIGHT,
      responseBody: {},
      createdAt: new Date().toISOString(),
    });
    return { status: "reserved" as const };
  },
});

export const completeIdempotency = mutation({
  args: {
    ...bridgeArgs,
    key: v.string(),
    endpoint: v.string(),
    responseStatus: v.number(),
    responseBody: v.any(),
  },
  handler: async (ctx, args) => {
    check(args);
    const existing = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key_endpoint", (q) =>
        q.eq("key", args.key).eq("endpoint", args.endpoint),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        responseStatus: args.responseStatus,
        responseBody: args.responseBody,
      });
    }
    return null;
  },
});

export const releaseIdempotency = mutation({
  args: { ...bridgeArgs, key: v.string(), endpoint: v.string() },
  handler: async (ctx, args) => {
    check(args);
    const existing = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key_endpoint", (q) =>
        q.eq("key", args.key).eq("endpoint", args.endpoint),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
