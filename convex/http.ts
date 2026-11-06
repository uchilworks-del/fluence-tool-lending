import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifySignature } from "./hmac";

const http = httpRouter();

/**
 * Inbound n8n → Convex endpoints. Every request must carry
 * `x-signature: hex(hmac_sha256(secret, rawBody))`.
 */

// GET /overdue — n8n scheduled workflow fetches approved loans past endDate.
http.route({
  path: "/overdue",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.N8N_WEBHOOK_SECRET;
    const sig = req.headers.get("x-signature") ?? "";
    // sign the query string itself so the shared-secret pattern applies to GETs
    const qs = new URL(req.url).search;
    if (!secret || !(await verifySignature(secret, qs, sig)))
      return new Response("unauthorized", { status: 401 });

    const today = new Date().toISOString().slice(0, 10);
    const loans = await ctx.runQuery(internal.httpInternal.overdueLoans, { today });
    return Response.json({ loans });
  }),
});

// POST /reminders — n8n writes back that a reminder was sent (idempotent).
http.route({
  path: "/reminders",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.N8N_WEBHOOK_SECRET;
    const body = await req.text();
    const sig = req.headers.get("x-signature") ?? "";
    if (!secret || !(await verifySignature(secret, body, sig)))
      return new Response("unauthorized", { status: 401 });

    const { loanId, executionId } = JSON.parse(body);
    const result = await ctx.runMutation(internal.loans.recordReminder, { loanId, executionId });
    return Response.json(result);
  }),
});

export default http;
