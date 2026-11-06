import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Overdue = approved loans whose endDate has passed. Only fields n8n needs —
// data minimization: no user rows, no descriptions.
export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = await ctx.db.query("loans").withIndex("by_status", (q) => q.eq("status", "approved")).collect();
    return loans
      .filter((l) => l.endDate < today)
      .map((l) => ({
        loanId: l._id,
        toolId: l.toolId,
        borrowerId: l.borrowerId,
        endDate: l.endDate,
        remindersSent: l.remindersSent,
      }));
  },
});
