import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Users carry the role used by every Convex function for RBAC.
// In production this is populated by a real IdP (Clerk/Auth0 webhook);
// for the take-home a demo user picker seeds these rows.
export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  }).index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    available: v.boolean(), // false while out on an active loan or delisted
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"])
    .index("by_availability", ["available"]),

  loans: defineTable({
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    lenderId: v.id("users"),
    startDate: v.string(), // ISO yyyy-mm-dd
    endDate: v.string(),
    status: v.union(
      v.literal("requested"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("returned")
    ),
    // Automation bookkeeping — kept small; full events live in notifications.
    remindersSent: v.number(),
    lastReminderAt: v.optional(v.string()),
    lastEventAt: v.optional(v.string()),
  })
    .index("by_tool", ["toolId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_status", ["status"]),

  // Immutable automation/activity log — powers the bonus "recent activity" UI.
  events: defineTable({
    loanId: v.id("loans"),
    type: v.string(), // e.g. "request_created", "approved", "reminder_sent"
    detail: v.string(),
    // Idempotency key supplied by the writer (n8n execution id or mutation id).
    idempotencyKey: v.string(),
    createdAt: v.string(),
  })
    .index("by_loan", ["loanId"])
    .index("by_idempotency_key", ["idempotencyKey"]),
});
