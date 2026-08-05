import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const role = v.union(v.literal("admin"), v.literal("miembro"));
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
const movementType = v.union(
  v.literal("compra"),
  v.literal("venta"),
  v.literal("devolucion_vta"),
  v.literal("ajuste manual"),
  v.literal("devolucion_com"),
);

/**
 * Convex's _id is intentionally not exposed as the public API id. The
 * legacyId fields preserve the existing integer contract while letting the
 * backend use typed Convex document references internally.
 */
export default defineSchema({
  projects: defineTable({
    legacyId: v.number(),
    name: v.string(),
    active: v.boolean(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_name", ["name"]),

  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.string(),
    role,
    createdAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_user_project", ["userId", "projectId"])
    .index("by_project", ["projectId"]),

  products: defineTable({
    legacyId: v.number(),
    projectId: v.id("projects"),
    projectLegacyId: v.number(),
    name: v.string(),
    wallapopTitle: v.optional(v.string()),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_project_name", ["projectId", "name"])
    .index("by_project_legacy", ["projectLegacyId", "legacyId"])
    .index("by_project_wallapop_title", ["projectId", "wallapopTitle"]),

  customers: defineTable({
    legacyId: v.number(),
    projectId: v.id("projects"),
    projectLegacyId: v.number(),
    name: v.string(),
    normalizedName: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_project_name", ["projectId", "name"])
    .index("by_project_normalized_name", ["projectId", "normalizedName"]),

  customerCounts: defineTable({
    projectId: v.id("projects"),
    projectLegacyId: v.number(),
    count: v.number(),
  }).index("by_project", ["projectId"]),

  sales: defineTable({
    legacyId: v.number(),
    projectId: v.id("projects"),
    projectLegacyId: v.number(),
    date: v.string(),
    channel: v.string(),
    status: saleStatus,
    customerId: v.optional(v.id("customers")),
    origin: v.optional(v.string()),
    originId: v.optional(v.string()),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_project_date", ["projectId", "date"])
    .index("by_project_legacy", ["projectLegacyId", "legacyId"])
    .index("by_project_origin", ["projectId", "origin"]),

  saleLines: defineTable({
    legacyId: v.number(),
    saleId: v.id("sales"),
    projectId: v.id("projects"),
    projectLegacyId: v.number(),
    productId: v.id("products"),
    productLegacyId: v.number(),
    units: v.number(),
    unitPriceCents: v.number(),
    vatRate: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_sale", ["saleId"])
    .index("by_product", ["productId"])
    .index("by_project", ["projectId"]),

  purchases: defineTable({
    legacyId: v.number(),
    projectId: v.id("projects"),
    projectLegacyId: v.number(),
    date: v.string(),
    status: purchaseStatus,
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_project_date", ["projectId", "date"])
    .index("by_project_legacy", ["projectLegacyId", "legacyId"]),

  purchaseLines: defineTable({
    legacyId: v.number(),
    purchaseId: v.id("purchases"),
    projectId: v.id("projects"),
    projectLegacyId: v.number(),
    productId: v.id("products"),
    productLegacyId: v.number(),
    units: v.number(),
    unitPriceCents: v.number(),
    vatRate: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_purchase", ["purchaseId"])
    .index("by_product", ["productId"])
    .index("by_project", ["projectId"]),

  stockMovements: defineTable({
    legacyId: v.number(),
    productId: v.id("products"),
    productLegacyId: v.number(),
    projectId: v.id("projects"),
    projectLegacyId: v.number(),
    units: v.number(),
    type: movementType,
    purchaseLineId: v.optional(v.id("purchaseLines")),
    saleLineId: v.optional(v.id("saleLines")),
    date: v.string(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_product", ["productId"])
    .index("by_project_date", ["projectId", "date"])
    .index("by_purchase_line", ["purchaseLineId"])
    .index("by_sale_line", ["saleLineId"]),

  otherTransactions: defineTable({
    legacyId: v.number(),
    projectId: v.id("projects"),
    projectLegacyId: v.number(),
    type: transactionType,
    concept: v.string(),
    description: v.optional(v.string()),
    amountCents: v.number(),
    vatRate: v.number(),
    date: v.string(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_project_date", ["projectId", "date"])
    .index("by_project_type_date", ["projectId", "type", "date"]),

  apiKeys: defineTable({
    name: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
    projectLegacyId: v.optional(v.number()),
    scopes: v.array(v.union(v.literal("read"), v.literal("write"))),
    active: v.boolean(),
    expiresAt: v.optional(v.string()),
    lastUsedAt: v.optional(v.string()),
    createdAt: v.string(),
  }).index("by_hash", ["keyHash"]),

  idempotencyKeys: defineTable({
    key: v.string(),
    endpoint: v.string(),
    apiKeyId: v.optional(v.string()),
    requestHash: v.string(),
    responseStatus: v.number(),
    responseBody: v.any(),
    createdAt: v.string(),
  })
    .index("by_key_endpoint", ["key", "endpoint"])
    .index("by_created_at", ["createdAt"]),
});
