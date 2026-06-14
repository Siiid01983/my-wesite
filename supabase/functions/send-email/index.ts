/**
 * Hello Moving — send-email Edge Function  (Phase 30 — Resend API)
 *
 * Sends an admin-to-customer HTML email via Resend.
 * Returns { ok, from, messageId } on success or { ok, error } on failure.
 *
 * The JS client (communications.js) handles all Supabase status updates
 * (email_status: pending → sent / failed). This function only delivers.
 *
 * ── Required Supabase secret ───────────────────────────────────────────
 *
 *   RESEND_API_KEY      re_xxxxxxxxxxxxxxxxxxxx   (Resend dashboard → API Keys)
 *
 * ── Resend domain requirement ──────────────────────────────────────────
 *
 *   hello-moving.com must be verified in your Resend account
 *   (Resend dashboard → Domains → Add Domain → add DNS records to cPanel).
 *   Until verified, use the Resend sandbox address: onboarding@resend.dev
 *
 * ── Deploy ─────────────────────────────────────────────────────────────
 *   supabase functions deploy send-email --no-verify-jwt
 */

import { Resend } from "npm:resend";

/* ── CORS headers ────────────────────────────────────────── */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

/* ── Account registry ────────────────────────────────────── */
interface Account {
  displayEmail: string;
  displayName:  string;
}

const ACCOUNTS: Record<string, Account> = {
  booking: {
    displayEmail: "booking@hello-moving.com",
    displayName:  "Hello Moving 予約センター",
  },
  support: {
    displayEmail: "support@hello-moving.com",
    displayName:  "Hello Moving アフターサービス",
  },
  contact: {
    displayEmail: "contact@hello-moving.com",
    displayName:  "Hello Moving カスタマーサポート",
  },
};

/* ── HTML email builder ──────────────────────────────────── */
function buildHtml(message: unknown, bookingId: unknown, replyEmail: unknown): string {
  const safe = (s: unknown): string => {
    if (s === null || s === undefined) return "";
    const str = typeof s === "string" ? s : String(s);
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };

  const safeMessage   = typeof message   === "string" ? message.trim()   : "";
  const safeBookingId = typeof bookingId === "string" ? bookingId.trim() : "";
  const safeReply     = typeof replyEmail === "string" ? replyEmail.trim() : "";

  const msgHtml = safe(safeMessage).replace(/\n/g, "<br>");

  const bookingRow = safeBookingId
    ? `<tr>
         <td style="padding:10px 16px;border-top:1px solid #e8e8e4;font-size:12px;font-weight:600;color:#666;width:130px;white-space:nowrap">受付番号</td>
         <td style="padding:10px 16px;border-top:1px solid #e8e8e4;font-size:13px;font-weight:700;color:#1d4ed8">${safe(safeBookingId)}</td>
       </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f2f2ef;font-family:'Hiragino Sans','Meiryo','Yu Gothic',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2ef;padding:32px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0"
  style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:600px;width:100%">

  <!-- Header -->
  <tr><td style="background:#0a1f44;padding:28px 36px">
    <p style="margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:.04em">Hello Moving</p>
    <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,.55);letter-spacing:.06em">TOKYO MOVING SERVICE</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:36px 36px 28px">
    <p style="margin:0 0 20px;font-size:14px;line-height:1.9;color:#0b0f17">${msgHtml}</p>

    ${safeBookingId ? `
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border:1px solid #e8e8e4;border-radius:8px;overflow:hidden;margin-bottom:20px">
      ${bookingRow}
    </table>` : ""}

    <table width="100%" cellpadding="0" cellspacing="0"
      style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px">
      <tr><td style="padding:14px 18px">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#0369a1">お急ぎのご連絡</p>
        <p style="margin:0;font-size:12px;color:#444;line-height:1.9">
          📞 <a href="tel:+819024893402" style="color:#0369a1">090-2489-3402</a>（08:00〜20:00）<br>
          💬 <a href="https://line.me/R/ti/p/~hellomoving" style="color:#0369a1">LINE で相談する</a>
        </p>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f7f7f4;padding:18px 36px;border-top:1px solid #e8e8e4">
    <p style="margin:0;font-size:11px;color:#aaa;line-height:1.7">
      このメールは Hello Moving より送信されています。<br>
      返信先: <a href="mailto:${safe(safeReply)}" style="color:#aaa">${safe(safeReply)}</a><br>
      〒 東京都 — 国土交通省 認可 第431320058126号
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

/* ── Main handler ────────────────────────────────────────── */
Deno.serve(async (req: Request): Promise<Response> => {

  /* ── Preflight ─────────────────────────────────────────── */
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  /* ── Parse payload ─────────────────────────────────────── */
  let payload: {
    communication_id?: number | string;
    from_account?:     string;
    to:                string;
    subject?:          string;
    message:           string;
    booking_id?:       string;
  };

  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const {
    communication_id,
    from_account = "booking",
    to,
    subject,
    message,
    booking_id = "",
  } = payload;

  /* ── Validate payload ──────────────────────────────────── */
  if (!to || typeof to !== "string" || !to.includes("@")) {
    return json({ ok: false, error: "Invalid or missing recipient address (to)" }, 400);
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return json({ ok: false, error: "Empty message body" }, 400);
  }

  /* ── Resolve account ───────────────────────────────────── */
  const accountKey = from_account in ACCOUNTS ? from_account : "booking";
  const account    = ACCOUNTS[accountKey];

  console.log("[send-email] Request", {
    communication_id,
    from_account: accountKey,
    from:         account.displayEmail,
    to:           to.toLowerCase().trim(),
  });

  /* ── Guard: API key must exist ─────────────────────────── */
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("[send-email] RESEND_API_KEY secret is not set");
    return json({ ok: false, error: "RESEND_API_KEY not configured" }, 500);
  }

  /* ── Build and send via Resend ─────────────────────────── */
  const resend       = new Resend(apiKey);
  const emailSubject = (subject || "[Hello Moving] ご連絡").trim();
  const emailHtml    = buildHtml(message.trim(), booking_id, account.displayEmail);

  try {
    const { data, error } = await resend.emails.send({
      from:     `${account.displayName} <${account.displayEmail}>`,
      to:       [to.toLowerCase().trim()],
      reply_to: account.displayEmail,
      subject:  emailSubject,
      text:     message.trim(),
      html:     emailHtml,
    });

    if (error) {
      console.error("[send-email] DELIVERY_FAILED", {
        communication_id,
        from:   account.displayEmail,
        to,
        error,
      });
      return json({ ok: false, error: error.message }, 502);
    }

    console.log("[send-email] DELIVERY_SUCCESS", {
      communication_id,
      messageId: data?.id,
      from:      account.displayEmail,
      to:        to.toLowerCase().trim(),
    });

    return json({
      ok:        true,
      from:      account.displayEmail,
      messageId: data?.id,
    });

  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[send-email] DELIVERY_EXCEPTION", { communication_id, detail });
    return json({ ok: false, error: detail }, 502);
  }
});
