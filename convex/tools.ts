import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { caller, requireAdmin, requireSelf } from "./auth";

// ── Reads ────────────────────────────────────────────────────────────────

// All tools with availability; optional category filter (indexed).
export const list = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, { category }) => {
    const tools = category
      ? await ctx.db.query("tools").withIndex("by_category", (q) => q.eq("category", category)).collect()
      : await ctx.db.query("tools").collect();
    return tools;
  },
});

export const categories = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").collect();
    return [...new Set(tools.map((t) => t.category))].sort();
  },
});

export const myListings = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await caller(ctx, userId);
    return ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", userId)).collect();
  },
});

// ── Writes ───────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    description: v.string(),
    category: v.string(),
  },
  handler: async (ctx, { userId, title, description, category }) => {
    await caller(ctx, userId); // any signed-in user may list a tool
    if (!title.trim()) throw new Error("title required");
    return ctx.db.insert("tools", {
      ownerId: userId, title: title.trim(), description, category, available: true,
    });
  },
});

export const update = mutation({
  args: {
    userId: v.id("users"),
    toolId: v.id("tools"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, { userId, toolId, ...patch }) => {
    const me = await caller(ctx, userId);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new Error("tool not found");
    if (me.role !== "admin") requireSelf(me, tool.ownerId); // user: own listings only
    await ctx.db.patch(toolId, patch);
  },
});

export const remove = mutation({
  args: { userId: v.id("users"), toolId: v.id("tools") },
  handler: async (ctx, { userId, toolId }) => {
    const me = await caller(ctx, userId);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new Error("tool not found");
    // admin may remove any listing; user only their own
    if (me.role !== "admin") requireSelf(me, tool.ownerId);
    // never delete under an active loan — flag unavailable instead
    const active = await ctx.db
      .query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
    if (active.some((l) => l.status === "requested" || l.status === "approved")) {
      await ctx.db.patch(toolId, { available: false });
      return "delisted-active-loan";
    }
    await ctx.db.delete(toolId);
    return "deleted";
  },
});
