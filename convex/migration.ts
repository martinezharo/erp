import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertBridgeSecret, fail, productByLegacyId, projectByLegacyId } from "./lib/bridge";
import type { MutationCtx } from "./_generated/server";

/**
 * One-shot, secret-protected import surface for the Supabase compatibility
 * migration. The script sends small batches so it remains below Convex's
 * argument and transaction limits. Each operation is idempotent by legacy id.
 *
 * This is deliberately separate from the application domain mutations: source
 * rows already contain their identity and must not receive new sequence ids.
 */

const importArgs = {
  bridgeSecret: v.string(),
  rows: v.array(v.any()),
};

function numberValue(value: unknown, fallback = 0): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function centsValue(value: unknown): number {
  return Math.round(numberValue(value) * 100);
}

function dateValue(value: unknown): string {
  return stringValue(value, new Date(0).toISOString());
}

async function existingByLegacyId(
  ctx: MutationCtx,
  table: "products" | "sales" | "saleLines" | "purchases" | "purchaseLines" | "stockMovements" | "otherTransactions",
  legacyId: number,
) {
  return await ctx.db.query(table).withIndex("by_legacy_id", (q) => q.eq("legacyId", legacyId)).unique();
}

export const importProjects = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    assertBridgeSecret(args.bridgeSecret);
    for (const raw of args.rows) {
      const row = raw as Record<string, unknown>;
      const legacyId = numberValue(row.id);
      const existing = await projectByLegacyId(ctx, legacyId);
      const values = {
        legacyId,
        name: stringValue(row.nombre),
        active: Boolean(row.activo),
      };
      if (existing) await ctx.db.patch(existing._id, values);
      else await ctx.db.insert("projects", values);
    }
    return args.rows.length;
  },
});

export const importMembers = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    assertBridgeSecret(args.bridgeSecret);
    for (const raw of args.rows) {
      const row = raw as Record<string, unknown>;
      const projectLegacyId = numberValue(row.proyecto_id);
      const project = await projectByLegacyId(ctx, projectLegacyId);
      if (!project) fail("validation_error", `Project ${projectLegacyId} is missing.`);
      const userId = stringValue(row.user_id);
      const existing = await ctx.db
        .query("projectMembers")
        .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", project._id))
        .unique();
      const values = {
        projectId: project._id,
        userId,
        role: stringValue(row.rol, "miembro") === "admin" ? "admin" as const : "miembro" as const,
        createdAt: dateValue(row.creado_en),
      };
      if (existing) await ctx.db.patch(existing._id, values);
      else await ctx.db.insert("projectMembers", values);
    }
    return args.rows.length;
  },
});

export const importProducts = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    assertBridgeSecret(args.bridgeSecret);
    for (const raw of args.rows) {
      const row = raw as Record<string, unknown>;
      const legacyId = numberValue(row.id);
      const projectLegacyId = numberValue(row.proyecto_id);
      const project = await projectByLegacyId(ctx, projectLegacyId);
      if (!project) fail("validation_error", `Project ${projectLegacyId} is missing.`);
      const existing = await existingByLegacyId(ctx, "products", legacyId);
      const values = {
        legacyId,
        projectId: project._id,
        projectLegacyId,
        name: stringValue(row.nombre),
      };
      if (existing) await ctx.db.patch(existing._id, values);
      else await ctx.db.insert("products", values);
    }
    return args.rows.length;
  },
});

export const importSales = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    assertBridgeSecret(args.bridgeSecret);
    for (const raw of args.rows) {
      const row = raw as Record<string, unknown>;
      const legacyId = numberValue(row.id);
      const projectLegacyId = numberValue(row.proyecto_id);
      const project = await projectByLegacyId(ctx, projectLegacyId);
      if (!project) fail("validation_error", `Project ${projectLegacyId} is missing.`);
      const existing = await existingByLegacyId(ctx, "sales", legacyId);
      const values = {
        legacyId,
        projectId: project._id,
        projectLegacyId,
        date: dateValue(row.fecha),
        channel: stringValue(row.canal),
        status: ["pendiente", "enviada", "devuelta", "reembolsada"].includes(stringValue(row.estado))
          ? stringValue(row.estado) as "pendiente" | "enviada" | "devuelta" | "reembolsada"
          : "pendiente" as const,
      };
      if (existing) await ctx.db.patch(existing._id, values);
      else await ctx.db.insert("sales", values);
    }
    return args.rows.length;
  },
});

export const importSaleLines = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    assertBridgeSecret(args.bridgeSecret);
    for (const raw of args.rows) {
      const row = raw as Record<string, unknown>;
      const sale = await ctx.db
        .query("sales")
        .withIndex("by_legacy_id", (q) => q.eq("legacyId", numberValue(row.venta_id)))
        .unique();
      if (!sale) fail("validation_error", `Sale ${row.venta_id} is missing.`);
      const product = await productByLegacyId(ctx, sale.projectLegacyId, numberValue(row.producto_id));
      if (!product) fail("validation_error", `Product ${row.producto_id} is missing.`);
      const legacyId = numberValue(row.id);
      const values = {
        legacyId,
        saleId: sale._id,
        projectId: sale.projectId,
        projectLegacyId: sale.projectLegacyId,
        productId: product._id,
        productLegacyId: product.legacyId,
        units: numberValue(row.unidades),
        unitPriceCents: centsValue(row.precio_unitario_venta),
        vatRate: numberValue(row.porcentaje_iva),
      };
      const existing = await existingByLegacyId(ctx, "saleLines", legacyId);
      if (existing) await ctx.db.patch(existing._id, values);
      else await ctx.db.insert("saleLines", values);
    }
    return args.rows.length;
  },
});

export const importPurchases = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    assertBridgeSecret(args.bridgeSecret);
    for (const raw of args.rows) {
      const row = raw as Record<string, unknown>;
      const legacyId = numberValue(row.id);
      const projectLegacyId = numberValue(row.proyecto_id);
      const project = await projectByLegacyId(ctx, projectLegacyId);
      if (!project) fail("validation_error", `Project ${projectLegacyId} is missing.`);
      const existing = await existingByLegacyId(ctx, "purchases", legacyId);
      const values = {
        legacyId,
        projectId: project._id,
        projectLegacyId,
        date: dateValue(row.fecha),
        status: ["pendiente", "recibida", "cancelada"].includes(stringValue(row.estado))
          ? stringValue(row.estado) as "pendiente" | "recibida" | "cancelada"
          : "pendiente" as const,
      };
      if (existing) await ctx.db.patch(existing._id, values);
      else await ctx.db.insert("purchases", values);
    }
    return args.rows.length;
  },
});

export const importPurchaseLines = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    assertBridgeSecret(args.bridgeSecret);
    for (const raw of args.rows) {
      const row = raw as Record<string, unknown>;
      const purchase = await ctx.db
        .query("purchases")
        .withIndex("by_legacy_id", (q) => q.eq("legacyId", numberValue(row.compra_id)))
        .unique();
      if (!purchase) fail("validation_error", `Purchase ${row.compra_id} is missing.`);
      const product = await productByLegacyId(ctx, purchase.projectLegacyId, numberValue(row.producto_id));
      if (!product) fail("validation_error", `Product ${row.producto_id} is missing.`);
      const legacyId = numberValue(row.id);
      const values = {
        legacyId,
        purchaseId: purchase._id,
        projectId: purchase.projectId,
        projectLegacyId: purchase.projectLegacyId,
        productId: product._id,
        productLegacyId: product.legacyId,
        units: numberValue(row.unidades),
        unitPriceCents: centsValue(row.precio_unitario_compra),
        vatRate: numberValue(row.porcentaje_iva),
      };
      const existing = await existingByLegacyId(ctx, "purchaseLines", legacyId);
      if (existing) await ctx.db.patch(existing._id, values);
      else await ctx.db.insert("purchaseLines", values);
    }
    return args.rows.length;
  },
});

export const importMovements = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    assertBridgeSecret(args.bridgeSecret);
    for (const raw of args.rows) {
      const row = raw as Record<string, unknown>;
      const purchaseLine = row.ref_compra_detalle_id == null
        ? null
        : await ctx.db
          .query("purchaseLines")
          .withIndex("by_legacy_id", (q) => q.eq("legacyId", numberValue(row.ref_compra_detalle_id)))
          .unique();
      const saleLine = row.ref_venta_detalle_id == null
        ? null
        : await ctx.db
          .query("saleLines")
          .withIndex("by_legacy_id", (q) => q.eq("legacyId", numberValue(row.ref_venta_detalle_id)))
          .unique();
      const productId = numberValue(row.producto_id);
      const projectLegacyId = numberValue(row.proyecto_id);
      const product = await productByLegacyId(ctx, projectLegacyId, productId);
      if (!product) fail("validation_error", `Product ${productId} is missing.`);
      const movementType = ["compra", "venta", "devolucion_vta", "ajuste manual", "devolucion_com"].includes(stringValue(row.tipo_movimiento))
        ? stringValue(row.tipo_movimiento) as "compra" | "venta" | "devolucion_vta" | "ajuste manual" | "devolucion_com"
        : "ajuste manual" as const;
      const legacyId = numberValue(row.id);
      const values = {
        legacyId,
        productId: product._id,
        productLegacyId: product.legacyId,
        projectId: product.projectId,
        projectLegacyId: product.projectLegacyId,
        units: numberValue(row.unidades),
        type: movementType,
        ...(purchaseLine ? { purchaseLineId: purchaseLine._id } : {}),
        ...(saleLine ? { saleLineId: saleLine._id } : {}),
        date: dateValue(row.fecha),
      };
      const existing = await existingByLegacyId(ctx, "stockMovements", legacyId);
      if (existing) await ctx.db.patch(existing._id, values);
      else await ctx.db.insert("stockMovements", values);
    }
    return args.rows.length;
  },
});

export const importTransactions = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    assertBridgeSecret(args.bridgeSecret);
    for (const raw of args.rows) {
      const row = raw as Record<string, unknown>;
      const projectLegacyId = numberValue(row.proyecto_id);
      const project = await projectByLegacyId(ctx, projectLegacyId);
      if (!project) fail("validation_error", `Project ${projectLegacyId} is missing.`);
      const legacyId = numberValue(row.id);
      const values = {
        legacyId,
        projectId: project._id,
        projectLegacyId,
        type: stringValue(row.tipo) === "gasto" ? "gasto" as const : "ingreso" as const,
        concept: stringValue(row.concepto),
        ...(row.descripcion != null ? { description: stringValue(row.descripcion) } : {}),
        amountCents: centsValue(row.importe),
        vatRate: numberValue(row.porcentaje_iva),
        date: dateValue(row.fecha),
      };
      const existing = await existingByLegacyId(ctx, "otherTransactions", legacyId);
      if (existing) await ctx.db.patch(existing._id, values);
      else await ctx.db.insert("otherTransactions", values);
    }
    return args.rows.length;
  },
});

export const importApiKeys = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    assertBridgeSecret(args.bridgeSecret);
    for (const raw of args.rows) {
      const row = raw as Record<string, unknown>;
      const keyHash = stringValue(row.key_hash);
      const existing = await ctx.db
        .query("apiKeys")
        .withIndex("by_hash", (q) => q.eq("keyHash", keyHash))
        .unique();
      const rawScopes = Array.isArray(row.scopes) ? row.scopes : [];
      const scopes = rawScopes.filter((scope): scope is "read" | "write" => scope === "read" || scope === "write");
      const values = {
        name: stringValue(row.nombre),
        keyHash,
        keyPrefix: stringValue(row.key_prefix),
        ...(row.proyecto_id == null ? {} : { projectLegacyId: numberValue(row.proyecto_id) }),
        scopes: scopes.length ? scopes : ["read" as const],
        active: Boolean(row.activa),
        ...(row.expira_en ? { expiresAt: stringValue(row.expira_en) } : {}),
        ...(row.ultimo_uso_en ? { lastUsedAt: stringValue(row.ultimo_uso_en) } : {}),
        createdAt: dateValue(row.creada_en),
      };
      if (existing) await ctx.db.patch(existing._id, values);
      else await ctx.db.insert("apiKeys", values);
    }
    return args.rows.length;
  },
});

/**
 * Protected post-import audit. It is intentionally separate from the domain
 * API: business callers should not receive raw table counts, while the
 * migration operator needs to verify every imported relation.
 */
export const stats = query({
  args: { bridgeSecret: v.string() },
  handler: async (ctx, args) => {
    assertBridgeSecret(args.bridgeSecret);
    const [projects, members, products, sales, saleLines, purchases, purchaseLines, transactions, movements, apiKeys] =
      await Promise.all([
        ctx.db.query("projects").collect(),
        ctx.db.query("projectMembers").collect(),
        ctx.db.query("products").collect(),
        ctx.db.query("sales").collect(),
        ctx.db.query("saleLines").collect(),
        ctx.db.query("purchases").collect(),
        ctx.db.query("purchaseLines").collect(),
        ctx.db.query("otherTransactions").collect(),
        ctx.db.query("stockMovements").collect(),
        ctx.db.query("apiKeys").collect(),
      ]);

    return {
      projects: projects.length,
      members: members.length,
      products: products.length,
      sales: sales.length,
      saleLines: saleLines.length,
      purchases: purchases.length,
      purchaseLines: purchaseLines.length,
      otherTransactions: transactions.length,
      stockMovements: movements.length,
      apiKeys: apiKeys.length,
    };
  },
});
