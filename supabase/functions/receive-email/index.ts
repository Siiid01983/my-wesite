/**
 * Hello Moving — receive-email Edge Function  (Phase 31 — Inbound Email)
 *
 * Receives POST webhooks from Resend Inbound and inserts them into
 * the inbox_messages table using the Supabase service-role key.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 *
 *   Set WEBHOOK_SECRET in Supabase secrets, then include it as a query
 *   parameter in the Resend webhook URL:
 *
 *     https://<project-ref>.supabase.co/functions/v1/receive-email?secret=<WEBHOOK_SECRET>
 *
 *   The function rejects requests missing or supplying a wrong secret with 401.
 *
 * ── Required Supabase secrets ────────────────────────────────────────────────
 *
 *   WEBHOOK_SECRET          any long random string (≥32 chars)
 *   SUPABASE_URL            set automatically by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY  set automatically by Supabase runtime
 *
 * ── Deploy ───────────────────────────────────────────────────────────────────
 *   supabase functions deploy receive-email --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ── JSON response helper ─────────────────────────────────── */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/* ── Parse display name + address from RFC 5322 From header ─ */
function parseFrom(raw: string): { sender: string; email: string } {
  if (!raw) return { sender: "Unknown", email: "" };

  // "Display Name <address@example.com>"
  const match = raw.match(/^(.+?)\s*<([^>]+)>\s*$/);
  if (match) {
    return {
      sender: match[1].replace(/^["']|["']$/g, "").trim() || match[2],
      email:  match[2].trim().toLowerCase(),
    };
  }

  // bare "address@example.com"
  const bare = raw.trim().toLowerCase();
  return { sender: bare, email: bare };
}

/* ── Try to find a booking_id in subject/body ────────────────
   Supports patterns like HM-ABC123, #HM-ABC123, [HM-ABC123]   */
function extractBookingId(subject: string, body: string): string | null {
  const pattern = /(?:^|[\s#\[])([A-Z]{2,4}-[A-Z0-9]{4,})/;
  const hit = pattern.exec(subject) ?? pattern.exec(body);
  return hit ? hit[1] : null;
}

/* ── Main handler ─────────────────────────────────────────── */
Deno.serve(async (req: Request): Promise<Response> => {

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  /* ── Secret validation ─────────────────────────────────── */
  const expectedSecret = Deno.env.get("WEBHOOK_SECRET");
  if (!expectedSecret) {
    console.error("[receive-email] WEBHOOK_SECRET is not configured");
    return json({ ok: false, error: "Server misconfiguration" }, 500);
  }

  const url            = new URL(req.url);
  const suppliedSecret = url.searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(suppliedSecret, expectedSecret)) {
    console.warn("[receive-email] Rejected — invalid secret");
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  /* ── Parse Resend inbound payload ──────────────────────── */
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  /*
    Resend inbound payload shape (as of 2024):
    {
      "from":    "Sender Name <sender@example.com>",
      "to":      ["contact@hello-moving.com"],
      "subject": "お問い合わせ",
      "text":    "...",
      "html":    "...",
      "headers": { ... },
      "attachments": [ ... ]
    }
  */
  const rawFrom   = (payload.from   as string) ?? "";
  const subject   = ((payload.subject as string) ?? "").trim();
  const body      = ((payload.text   as string) ?? (payload.html as string) ?? "").trim();

  const { sender, email } = parseFrom(rawFrom);

  if (!email) {
    console.warn("[receive-email] Missing sender email — payload:", JSON.stringify(payload).slice(0, 400));
    return json({ ok: false, error: "Missing sender email" }, 400);
  }

  const bookingId = extractBookingId(subject, body) ?? null;

  console.log("[receive-email] Inbound", { from: email, subject, bookingId });

  /* ── Insert into inbox_messages ────────────────────────── */
  const supabaseUrl     = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error } = await db.from("inbox_messages").insert({
    sender,
    email,
    subject: subject || "(件名なし)",
    body:    body    || "(本文なし)",
    booking_id: bookingId,
  });

  if (error) {
    console.error("[receive-email] DB insert failed", error);
    return json({ ok: false, error: error.message }, 500);
  }

  console.log("[receive-email] Stored message from", email);
  return json({ ok: true });
});

/* ── Constant-time string comparison ─────────────────────── */
function timingSafeEqual(a: string, b: string): boolean {
  // Pad both to the same length so length itself is not leaked
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < maxLen; i++) {
    diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return diff === 0;
}
