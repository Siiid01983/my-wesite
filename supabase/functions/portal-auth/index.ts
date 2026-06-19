/**
 * Hello Moving — portal-auth Edge Function  (RLS-safe customer login)
 *
 * Replaces the Magic Link UX with Email + Confirmation Number while KEEPING a
 * real Supabase Auth session, so Phase 6B RLS (which keys off auth.email())
 * stays ACTIVELY enforced. No email is ever sent.
 *
 * Flow:
 *   1. Receive { email, reference } from login.html (anon-invokable).
 *   2. Rate-limit (per IP + per email).
 *   3. Validate the pair against `bookings` using the SERVICE_ROLE key
 *      (bypasses RLS for this lookup only). Generic 401 on any mismatch.
 *   4. Ensure a confirmed auth user exists for the email (sends NO email).
 *   5. Mint a session WITHOUT emailing: generateLink (computes a token,
 *      delivers nothing) → verifyOtp(token_hash) → { access_token, refresh_token }.
 *   6. Return the tokens; the browser calls auth.setSession(...).
 *
 * ── Required Supabase secrets ──────────────────────────────────────────
 *   SB_URL              https://<project-ref>.supabase.co
 *   SB_SERVICE_ROLE_KEY service_role key   (NEVER ships to the browser)
 *   SB_ANON_KEY         anon public key    (used only for the verifyOtp exchange)
 *
 *   Note: secret names are NOT prefixed "SUPABASE_" because that prefix is
 *   reserved by the platform and cannot be set via `supabase secrets set`.
 *
 * ── Deploy ─────────────────────────────────────────────────────────────
 *   supabase secrets set SB_URL=... SB_SERVICE_ROLE_KEY=... SB_ANON_KEY=...
 *   supabase functions deploy portal-auth --no-verify-jwt
 */

import { createClient } from "npm:@supabase/supabase-js@2";

/* ── CORS ──────────────────────────────────────────────────────
 * Locked to the production origin(s). CORS can only return a single
 * Access-Control-Allow-Origin value, so we echo back the request Origin when it
 * is on the allow-list and otherwise fall back to the canonical origin (which
 * blocks the disallowed caller's browser). Add/remove entries as domains change. */
const ALLOWED_ORIGINS = new Set<string>([
  "https://hello-moving.com",
  "https://www.hello-moving.com",
]);
const CANONICAL_ORIGIN = "https://hello-moving.com";

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allow  = ALLOWED_ORIGINS.has(origin) ? origin : CANONICAL_ORIGIN;
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary":                         "Origin",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

// One generic failure for every "no match" case so we never disclose whether an
// email or a reference exists (anti-enumeration).
function denied(cors: Record<string, string>): Response {
  return json({ ok: false, error: "invalid-credentials" }, 401, cors);
}

/* ── Rate limiting ────────────────────────────────────────────
 * Baseline in-memory limiter (per warm instance). It throttles the common case;
 * it is NOT a global guarantee because Edge instances are ephemeral and scale
 * horizontally. For hard limits across instances, back this with a DB table or
 * an external store. Documented limitation — see LOGIN_RLS_SAFE_DESIGN.md §5. */
const WINDOW_MS  = 15 * 60 * 1000; // 15 minutes
const MAX_HITS   = 5;              // attempts per key per window
const _buckets   = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const b = _buckets.get(key);
  if (!b || b.resetAt < now) {
    _buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > MAX_HITS;
}

/* ── Reference matching ───────────────────────────────────────
 * A booking reference is either the numeric DB id, or the HM-… reference packed
 * into notes as `ref:HM-…` (see bookingService.js). Compared case-insensitively. */
function referenceMatches(row: { id: unknown; notes: unknown }, reference: string): boolean {
  const ref = reference.trim().toUpperCase();
  if (!ref) return false;
  if (String(row.id ?? "").toUpperCase() === ref) return true;
  const notes = typeof row.notes === "string" ? row.notes : "";
  // Match `ref:<reference>` bounded by end-of-line / end-of-string.
  const m = notes.match(/ref:([^\n\r]*)/i);
  return !!m && m[1].trim().toUpperCase() === ref;
}

/* ── Main handler ─────────────────────────────────────────────*/
Deno.serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: cors });
  if (req.method !== "POST")    return json({ ok: false, error: "method-not-allowed" }, 405, cors);

  const SB_URL   = Deno.env.get("SB_URL");
  const SVC_KEY  = Deno.env.get("SB_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SB_ANON_KEY");
  if (!SB_URL || !SVC_KEY || !ANON_KEY) {
    console.error("[portal-auth] Missing SB_URL / SB_SERVICE_ROLE_KEY / SB_ANON_KEY secret");
    return json({ ok: false, error: "server-misconfigured" }, 500, cors);
  }

  /* ── Parse + validate payload ──────────────────────────────*/
  let payload: { email?: string; reference?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400, cors);
  }

  const email     = String(payload.email ?? "").trim().toLowerCase();
  const reference = String(payload.reference ?? "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !reference) {
    return denied(cors);
  }

  /* ── Rate limit (per IP + per email) ───────────────────────*/
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (rateLimited("ip:" + ip) || rateLimited("email:" + email)) {
    console.warn("[portal-auth] rate-limited", { ip });
    return json({ ok: false, error: "rate-limited" }, 429, cors);
  }

  const admin = createClient(SB_URL, SVC_KEY, { auth: { persistSession: false } });

  /* ── 1. Validate email + reference against bookings (service_role) ──*/
  let rows: Array<{ id: unknown; customer_email: unknown; notes: unknown }> = [];
  try {
    const { data, error } = await admin
      .from("bookings")
      .select("id, customer_email, notes")
      .ilike("customer_email", email);
    if (error) {
      console.error("[portal-auth] bookings lookup failed:", error.message);
      return json({ ok: false, error: "lookup-failed" }, 502, cors);
    }
    rows = data || [];
  } catch (err) {
    console.error("[portal-auth] bookings lookup threw:", err);
    return json({ ok: false, error: "lookup-failed" }, 502, cors);
  }

  const matched = rows.some((r) => referenceMatches(r, reference));
  if (!matched) {
    console.warn("[portal-auth] no booking match", { ip });
    return denied(cors);
  }

  /* ── 2. Ensure a confirmed auth user (sends NO email) ──────*/
  try {
    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    // "already registered" is the expected path for returning customers — ignore.
    if (createErr && !/already|registered|exists/i.test(createErr.message)) {
      console.error("[portal-auth] createUser failed:", createErr.message);
      return json({ ok: false, error: "user-provision-failed" }, 502, cors);
    }
  } catch (err) {
    console.error("[portal-auth] createUser threw:", err);
    return json({ ok: false, error: "user-provision-failed" }, 502, cors);
  }

  /* ── 3. Mint a session WITHOUT emailing ────────────────────*/
  let tokenHash = "";
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error || !data?.properties?.hashed_token) {
      console.error("[portal-auth] generateLink failed:", error?.message);
      return json({ ok: false, error: "session-mint-failed" }, 502, cors);
    }
    tokenHash = data.properties.hashed_token;
  } catch (err) {
    console.error("[portal-auth] generateLink threw:", err);
    return json({ ok: false, error: "session-mint-failed" }, 502, cors);
  }

  try {
    // Exchange the (un-emailed) token hash for a real session via an anon client.
    const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await anon.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
    const session = data?.session;
    if (error || !session?.access_token || !session?.refresh_token) {
      console.error("[portal-auth] verifyOtp failed:", error?.message);
      return json({ ok: false, error: "session-mint-failed" }, 502, cors);
    }

    console.log("[portal-auth] LOGIN_SUCCESS", { email });
    return json({
      ok: true,
      access_token:  session.access_token,
      refresh_token: session.refresh_token,
    }, 200, cors);
  } catch (err) {
    console.error("[portal-auth] verifyOtp threw:", err);
    return json({ ok: false, error: "session-mint-failed" }, 502, cors);
  }
});
