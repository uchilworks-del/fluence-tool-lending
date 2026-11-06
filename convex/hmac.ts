/**
 * HMAC-SHA256 signing of outbound webhook payloads (Convex → n8n).
 * n8n verifies with the shared secret held in its credentials.
 * Inbound requests (n8n → Convex) are verified in http.ts.
 */
export async function signPayload(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifySignature(secret: string, body: string, signature: string) {
  const expected = await signPayload(secret, body);
  // constant-time-ish compare (both hex strings of equal length when valid)
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/** Fire-and-forget notification to the n8n request workflow. */
export async function notifyN8n(payload: Record<string, unknown>) {
  const url = process.env.N8N_WEBHOOK_URL;      // e.g. https://n8n.local/webhook/tool-loan
  const secret = process.env.N8N_WEBHOOK_SECRET; // shared with n8n credentials
  if (!url || !secret) return; // integration disabled locally — event log still records it
  const body = JSON.stringify(payload);
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature": await signPayload(secret, body) },
    body,
  }).catch(() => {}); // notification failure must not fail the mutation
}
