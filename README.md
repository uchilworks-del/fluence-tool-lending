# Tool Lending — Fluence take-home

Neighborhood tool-lending app: users list tools, request loans for a date
range, lenders approve/decline, loans are marked returned. Convex backend
enforces RBAC server-side; n8n automates request notifications and daily
overdue reminders over HMAC-signed HTTP.

## Stack

- **Next.js** frontend (single-page demo UI — browse/filter, my listings,
  my requests, incoming requests)
- **Convex** — schema, mutations/queries, HTTP endpoints, RBAC, event log
- **n8n** — two workflows (`n8n/*.workflow.json`), Mailpit for local mail

## Run it

```bash
npm install
npx convex dev                      # provisions CONVEX_* env + NEXT_PUBLIC_CONVEX_URL
cp .env.example .env.local          # fill in values printed by convex dev
docker compose up -d                # n8n on :5678, Mailpit UI on :8025
npx convex env set N8N_WEBHOOK_URL http://localhost:5678/webhook/tool-loan
npx convex env set N8N_WEBHOOK_SECRET <shared-secret>
npm run dev                         # app on :3000
```

Import both `n8n/*.workflow.json` files in the n8n UI, create an SMTP
credential named "Mailpit SMTP" (host `mailpit`, port `1025`, no auth —
when running docker-to-docker; use `localhost` if n8n runs on the host),
and activate the workflows.

## Architecture

```
UI ──► Convex mutations ──► loans/tools tables (+ immutable events log)
              │ scheduler
              ▼
        POST N8N_WEBHOOK_URL  (x-signature = HMAC-SHA256(secret, body))
              │
              ▼  n8n request-notification: verify → build → email

n8n overdue-reminders (daily):
  sign → GET {CONVEX_SITE}/overdue → per loan: email reminder →
  sign → POST /reminders {loanId, executionId} → Convex records reminder
  (idempotent on n8n execution id) → "reminded Nx" shows in the UI
```

## Security & data-minimization decisions

- **RBAC lives in Convex functions, not the UI** — `convex/auth.ts`
  resolves the caller row on every read/write; `requireSelf`/`requireAdmin`
  guard listing edits, loan decisions, returns, trusted-lender flags, and
  admin views. (The demo passes `userId` explicitly since there's no IdP —
  see "Production" for the swap.)
- **Both directions authenticated** — outbound Convex→n8n payloads are
  HMAC-signed and verified in the workflow before processing; inbound
  n8n→Convex calls carry `x-signature` verified against the raw body
  (or query string for the GET) in `convex/http.ts`. Tampered or unsigned
  requests get 401.
- **Secrets never in code** — shared secret lives in Convex env vars and
  n8n env/credentials only; nothing secret is exported into workflow JSON.
- **Minimal payloads** — `/overdue` returns only ids/dates n8n needs, not
  user or tool data; notifications carry ids, not personal details.
- **Idempotent writes** — every event/reminder insert is keyed
  (`idempotencyKey`) so webhook retries or re-runs never duplicate
  records, emails, or counters.
- **Fail-visible automation** — n8n errors route to an error workflow
  (extendable to Slack/email alerting); the loan record is the source of
  truth so a lost notification never corrupts state.

## What I'd change for production

- Real auth (Clerk/Auth0) → `ctx.auth.getUserIdentity()` replaces the
  explicit `userId` arg; keep all the same RBAC checks.
- Sign payloads with per-tenant secrets or asymmetric keys; rotate via
  key id header; add timestamp + nonce to signatures for replay protection.
- Queue notifications durably (Convex scheduled fn already retries; add
  exponential backoff + dead-letter table instead of best-effort fetch).
- Paginate `/overdue`; rate-limit HTTP endpoints; audit-log admin actions.
- Observability: Sentry on mutations, n8n error workflow → PagerDuty/Slack.
- RBAC hardening: lender can only act on loans for tools they own
  (already enforced), admin actions logged with actor id, plus row-level
  tests for every role×action matrix.
