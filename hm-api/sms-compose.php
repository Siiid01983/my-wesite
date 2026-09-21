<?php
// ════════════════════════════════════════════════════════════════════════════
//  sms-compose.php — build a MANUAL SMS (text + phone) from trusted records
//
//  This endpoint DOES NOT SEND anything. There is no SMS provider, no transport,
//  no credentials, no delivery log. It only RESOLVES the customer's stored phone
//  and BUILDS the message body (Company + name + booking ref + Direct Chat Link)
//  server-side, so a staff member can send it manually from their own phone. The
//  server can never know whether the manual SMS was actually sent, so it never
//  claims delivery and writes no "sent" record.
//
//  Auth: staff only — X-ADMIN-TOKEN (role admin|manager), verified inline exactly
//        like reschedule.php / contact-chat.php. The browser passes ONLY a booking
//        id + intent; it can never inject a phone number, name, ref, or URL.
//
//  Request (JSON POST):  { booking_id, intent }
//     intent ∈ booking_confirmed | reschedule | staff_message
//  Response (HTTP 200 unless auth/validation fails):
//     { ok:true, data:{ phone, has_phone:bool, body, ref, segments } }
//
//  Eligibility (real customer bookings only): refuses status 'admin_blocked'
//  (Ops availability blocks / closed days) and any row without a customer
//  reference (ref: in notes) — those have no chat link and are not customer bookings.
//
//  Direct Chat Link: EmailService::chatUrl($cfg, $ref) — REUSED UNCHANGED
//  (login.html?ref=…&view=chat). The customer enters their email after opening it.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/EmailService.php';   // chatUrl() — existing chat deep-link
require_once __DIR__ . '/SmsService.php';     // content builder (no sending)

hm_cors();
hm_require_api_key();
hm_rate_limit('sms_compose', 40, 60);   // max 40 compose calls / IP / minute

// ── Staff auth (admin OR manager) — inline, mirrors contact-chat.php ──────────
$actor = '';
$tok = hm_request_header('X-ADMIN-TOKEN');
if (is_string($tok) && $tok !== '' && function_exists('hm_admin_token_verify')) {
  $pl   = hm_admin_token_verify($tok);
  $role = is_array($pl) ? ($pl['role'] ?? '') : '';
  if ($pl !== null && ($role === 'admin' || $role === 'manager') && hm_admin_token_account_valid($pl)) {
    $actor = (string)($pl['email'] ?? ($pl['sub'] ?? 'admin'));
  }
}
if ($actor === '') {
  if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('sms_compose');
  hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'forbidden', 'code' => 'forbidden']], 403);
}

// ── Input ────────────────────────────────────────────────────────────────────
$p         = hm_body();
$bookingId = trim((string)($p['booking_id'] ?? ''));
$intent    = trim((string)($p['intent'] ?? ''));
if ($bookingId === '') hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'booking_id required', 'code' => 'bad_request']], 400);
if (!SmsService::isValidIntent($intent)) {
  hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'invalid intent', 'code' => 'bad_intent']], 400);
}

$cfg = hm_config();

try {
  $db = hm_db();

  // Resolve the booking from TRUSTED server-side records.
  $q = $db->prepare('SELECT customer_name, customer_phone, notes, status FROM bookings WHERE id = ? LIMIT 1');
  $q->execute([$bookingId]);
  $bk = $q->fetch(PDO::FETCH_ASSOC);
  if (!$bk) hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'not_found', 'code' => 'not_found']], 404);

  // Eligibility: never compose for an availability block / closed day / internal entry.
  if ((string)($bk['status'] ?? '') === 'admin_blocked') {
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'not a customer booking', 'code' => 'not_eligible']], 400);
  }

  // Booking reference (public HM-… number), packed into notes by bookingService.
  // Its ABSENCE marks a non-customer row → refuse (and no chat link is possible).
  $ref = '';
  if (preg_match('/^ref:\s*(\S+)/m', (string)($bk['notes'] ?? ''), $rm)) $ref = trim($rm[1]);
  if ($ref === '') {
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'no customer reference', 'code' => 'not_eligible']], 400);
  }

  // Build the message from trusted values + the existing chat deep-link (unchanged).
  $phone = SmsService::normalizePhone((string)($bk['customer_phone'] ?? ''));
  $link  = EmailService::chatUrl($cfg, $ref);
  $body  = SmsService::render($intent, (string)($bk['customer_name'] ?? ''), $ref, $link);

  hm_json(['ok' => true, 'data' => [
    'phone'     => $phone,           // '' when the stored number is missing/invalid
    'has_phone' => $phone !== '',
    'body'      => $body,
    'ref'       => $ref,
    'segments'  => SmsService::segmentsUcs2($body),
  ]]);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('sms-compose failed', ['err' => $e->getMessage(), 'booking' => $bookingId]);
  hm_json(['ok' => false, 'data' => null, 'error' => ['message' => hm_safe_msg('Request failed', $e), 'code' => 'server']], 500);
}
