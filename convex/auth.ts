import { QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

/**
 * RBAC helpers — every public function resolves the caller row first and
 * enforces rules here, never in the UI.
 *
 * NOTE: `userId` is passed explicitly because the take-home uses a demo user
 * picker instead of an IdP. In production replace this with
 * `ctx.auth.getUserIdentity()` and map the identity subject to the user row.
 */
export async function caller(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("unauthenticated: unknown user");
  return user;
}

export function requireAdmin(user: Doc<"users">) {
  if (user.role !== "admin") throw new Error("forbidden: admin only");
}

export function requireSelf(
  user: Doc<"users">,
  ...ids: Array<Id<"users">>
) {
  if (!ids.includes(user._id))
    throw new Error("forbidden: not a participant in this resource");
}
