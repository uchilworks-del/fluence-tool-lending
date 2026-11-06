import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Demo seed — a real deployment provisions users from the IdP.
export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("users").collect();
    if (existing.length) return existing;
    const admin = await ctx.db.insert("users", { name: "Admin", email: "admin@demo.local", role: "admin", trustedLender: false });
    const priya = await ctx.db.insert("users", { name: "Priya", email: "priya@demo.local", role: "user", trustedLender: true });
    const sam = await ctx.db.insert("users", { name: "Sam", email: "sam@demo.local", role: "user", trustedLender: false });
    await ctx.db.insert("tools", { ownerId: priya, title: "DeWalt Drill", description: "18V cordless", category: "Power Tools", available: true });
    await ctx.db.insert("tools", { ownerId: priya, title: "Ladder 6ft", description: "Aluminium", category: "Access", available: true });
    await ctx.db.insert("tools", { ownerId: sam, title: "Pressure Washer", description: "2000 PSI", category: "Outdoor", available: true });
    return ctx.db.query("users").collect();
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query("users").collect(),
});
