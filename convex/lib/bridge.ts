import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { env } from "../_generated/server";
import { ConvexError } from "convex/values";
import { v } from "convex/values";

export const actorValidator = v.object({
  kind: v.union(v.literal("session"), v.literal("api_key")),
  userId: v.optional(v.string()),
  projectLegacyId: v.optional(v.number()),
  apiKeyId: v.optional(v.string()),
});

export type Actor = {
  kind: "session" | "api_key";
  userId?: string;
  projectLegacyId?: number;
  apiKeyId?: string;
};

export const bridgeArgs = {
  bridgeSecret: v.string(),
  actor: actorValidator,
};

export function assertBridgeSecret(secret: string): void {
  const expected = env.CONVEX_BRIDGE_SECRET;
  if (!expected || secret !== expected) {
    throw new ConvexError({ code: "unauthorized", message: "Backend bridge unauthorized." });
  }
}

export function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export function cents(value: number): number {
  if (!Number.isFinite(value) || value < 0) fail("validation_error", "Money value is invalid.");
  return Math.round(value * 100);
}

export function euros(value: number): number {
  return Math.round((value / 100) * 100) / 100;
}

export function vatPart(grossCents: number, rate: number): number {
  if (!rate) return 0;
  return Math.round(grossCents * (rate / (100 + rate)));
}

type LegacyTable =
  | "projects"
  | "products"
  | "sales"
  | "saleLines"
  | "purchases"
  | "purchaseLines"
  | "stockMovements"
  | "otherTransactions";

export async function nextLegacyId(ctx: MutationCtx, table: LegacyTable): Promise<number> {
  const last = await ctx.db
    .query(table)
    .withIndex("by_legacy_id")
    .order("desc")
    .first();
  return ((last as { legacyId?: number } | null)?.legacyId ?? 0) + 1;
}

export async function projectByLegacyId(
  ctx: QueryCtx | MutationCtx,
  projectLegacyId: number,
) {
  return await ctx.db
    .query("projects")
    .withIndex("by_legacy_id", (q) => q.eq("legacyId", projectLegacyId))
    .unique();
}

export async function requireProject(
  ctx: QueryCtx | MutationCtx,
  actor: Actor,
  projectLegacyId: number,
) {
  const project = await projectByLegacyId(ctx, projectLegacyId);
  if (!project) fail("not_found", `Project ${projectLegacyId} not found.`);

  if (actor.kind === "api_key") {
    if (
      actor.projectLegacyId !== undefined &&
      actor.projectLegacyId !== projectLegacyId
    ) {
      fail("forbidden", "This API key cannot access that project.");
    }
    return project;
  }

  if (!actor.userId) fail("unauthorized", "A user session is required.");
  const membership = await ctx.db
    .query("projectMembers")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", actor.userId!).eq("projectId", project._id),
    )
    .unique();
  if (!membership) fail("forbidden", "You are not a member of that project.");
  return project;
}

export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
  actor: Actor,
  projectLegacyId: number,
) {
  const project = await requireProject(ctx, actor, projectLegacyId);
  if (actor.kind === "api_key") return project;
  const membership = await ctx.db
    .query("projectMembers")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", actor.userId!).eq("projectId", project._id),
    )
    .unique();
  if (membership?.role !== "admin") {
    fail("forbidden", "Only project admins can perform this operation.");
  }
  return project;
}

export async function productByLegacyId(
  ctx: QueryCtx | MutationCtx,
  projectLegacyId: number,
  productLegacyId: number,
) {
  return await ctx.db
    .query("products")
    .withIndex("by_project_legacy", (q) =>
      q.eq("projectLegacyId", projectLegacyId).eq("legacyId", productLegacyId),
    )
    .unique();
}

export async function requireProduct(
  ctx: QueryCtx | MutationCtx,
  actor: Actor,
  projectLegacyId: number,
  productLegacyId: number,
) {
  await requireProject(ctx, actor, projectLegacyId);
  const product = await productByLegacyId(ctx, projectLegacyId, productLegacyId);
  if (!product) fail("not_found", `Product ${productLegacyId} not found.`);
  return product;
}

export async function saleByLegacyId(ctx: QueryCtx | MutationCtx, legacyId: number) {
  return await ctx.db
    .query("sales")
    .withIndex("by_legacy_id", (q) => q.eq("legacyId", legacyId))
    .unique();
}

export async function purchaseByLegacyId(ctx: QueryCtx | MutationCtx, legacyId: number) {
  return await ctx.db
    .query("purchases")
    .withIndex("by_legacy_id", (q) => q.eq("legacyId", legacyId))
    .unique();
}

export async function transactionByLegacyId(
  ctx: QueryCtx | MutationCtx,
  legacyId: number,
) {
  return await ctx.db
    .query("otherTransactions")
    .withIndex("by_legacy_id", (q) => q.eq("legacyId", legacyId))
    .unique();
}

export type ProjectId = Id<"projects">;
