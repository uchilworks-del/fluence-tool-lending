import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { caller, requireAdmin, requireSelf } from "./auth";
import { notifyN8n } from "./hmac";

const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

// Idempotent event writer — retries with the same key never duplicate.
async function record(ctx: any, loanId: Id<"loans">, type: string, detail: string, key: string) {
  const existing = await ctx.db
    .query("events").withIndex("by_idempotency_key", (q: any) => q.eq("idempotencyKey", key)).first();
  if (existing) return;
  await ctx.db.insert("events", { loanId, type, detail, idempotencyKey: key, createdAt: nowIso() });
  await ctx.db.patch(loanId, { lastEventAt: nowIso() });
}

// ── Reads ────────────────────────────────────────────────────────────────

export const myRequests = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await caller(ctx, userId);
    return ctx.db.query("loans").withIndex("by_borrower", (q) => q.eq("borrowerId", userId)).collect();
  },
});

export const incomingRequests = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await caller(ctx, userId);
    if (me.role === "admin") return ctx.db.query("loans").collect(); // admin views all loans
    return ctx.db.query("loans").withIndex("by_lender", (q) => q.eq("lenderId", userId)).collect();
  },
});

export const activity = query({
  args: { userId: v.id("users"), loanId: v.id("loans") },
  handler: async (ctx, { userId, loanId }) => {
    const me = await caller(ctx, userId);
    const loan = await ctx.db.get(loanId);
    if (!loan) return [];
    if (me.role !== "admin") requireSelf(me, loan.borrowerId, loan.lenderId);
    return ctx.db.query("events").withIndex("by_loan", (q) => q.eq("loanId", loanId)).collect();
  },
});

// ── Writes ───────────────────────────────────────────────────────────────

export const request = mutation({
  args: { userId: v.id("users"), toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { userId, toolId, startDate, endDate }) => {
    const me = await caller(ctx, userId);
    const tool = await ctx.db.get(toolId);
    if (!tool || !tool.available) throw new Error("tool unavailable");
    if (tool.ownerId === userId) throw new Error("cannot borrow your own tool");
    if (endDate < startDate) throw new Error("endDate before startDate");

    const loanId = await ctx.db.insert("loans", {
      toolId, borrowerId: userId, lenderId: tool.ownerId,
      startDate, endDate, status: "requested", remindersSent: 0,
    });
    await ctx.db.patch(toolId, { available: false });
    await record(ctx, loanId, "request_created", `borrow ${startDate}..${endDate}`, `req:${loanId}`);
    // notification is best-effort; the loan is the source of truth
    await ctx.scheduler.runAfter(0, internal.loans.notify, { loanId, type: "request_created" });
    return loanId;
  },
});

export const decide = mutation({
  args: { userId: v.id("users"), loanId: v.id("loans"), approve: v.boolean() },
  handler: async (ctx, { userId, loanId, approve }) => {
    const me = await caller(ctx, userId);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new Error("loan not found");
    if (loan.status !== "requested") return loan.status; // idempotent re-submit
    if (me.role !== "admin") requireSelf(me, loan.lenderId); // lender acts on own tools

    const status = approve ? "approved" : "declined";
    await ctx.db.patch(loanId, { status });
    if (!approve) {
      const tool = await ctx.db.get(loan.toolId);
      if (tool) await ctx.db.patch(loan.toolId, { available: true });
    }
    await record(ctx, loanId, status, `lender decision`, `${status}:${loanId}`);
    await ctx.scheduler.runAfter(0, internal.loans.notify, { loanId, type: status });
    return status;
  },
});

export const markReturned = mutation({
  args: { userId: v.id("users"), loanId: v.id("loans") },
  handler: async (ctx, { userId, loanId }) => {
    const me = await caller(ctx, userId);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new Error("loan not found");
    if (loan.status === "returned") return "returned"; // idempotent
    if (loan.status !== "approved") throw new Error("only active loans can be returned");
    // lender (or admin) confirms return
    if (me.role !== "admin") requireSelf(me, loan.lenderId);
    await ctx.db.patch(loanId, { status: "returned" });
    await ctx.db.patch(loan.toolId, { available: true });
    await record(ctx, loanId, "returned", "tool returned", `ret:${loanId}`);
    await ctx.scheduler.runAfter(0, internal.loans.notify, { loanId, type: "returned" });
    return "returned";
  },
});

export const markTrustedLender = mutation({
  args: { userId: v.id("users"), lenderId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, lenderId, trusted }) => {
    const me = await caller(ctx, userId);
    requireAdmin(me);
    await ctx.db.patch(lenderId, { trustedLender: trusted });
  },
});

// ── Internal: outbound notification (Convex → n8n) ───────────────────────

export const notify = internalMutation({
  args: { loanId: v.id("loans"), type: v.string() },
  handler: async (ctx, { loanId, type }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return;
    await notifyN8n({ type, loanId, toolId: loan.toolId, borrowerId: loan.borrowerId, lenderId: loan.lenderId, status: loan.status });
  },
});

// ── Internal: n8n write-backs (called via http.ts, already verified) ─────

// Overdue fetch is done in http.ts (needs raw filtering); this mutation
// records a reminder — idempotent per (loanId, n8n execution id).
export const recordReminder = mutation({
  args: { loanId: v.id("loans"), executionId: v.string() },
  handler: async (ctx, { loanId, executionId }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan || loan.status !== "approved") return { recorded: false, reason: "inactive" };
    await record(ctx, loanId, "reminder_sent", "overdue reminder emailed", `n8n:${executionId}:${loanId}`);
    await ctx.db.patch(loanId, { remindersSent: loan.remindersSent + 1, lastReminderAt: nowIso() });
    return { recorded: true };
  },
});
