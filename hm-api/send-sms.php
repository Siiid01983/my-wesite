<?php
// ════════════════════════════════════════════════════════════════════════════
//  send-sms.php — OPTIONAL staff-triggered customer SMS (attention notification)
//
//  SMS is SECONDARY. Email + Chat are primary and are NOT touched here — this
//  endpoint is called SEPARATELY, AFTER the primary Ops operation has already
//  succeeded, so an SMS failure can never roll back a booking / reschedule / chat.
//
//  Auth: staff only — X-ADMIN-TOKEN (role admin|manager), verified inline exactly
//        like reschedule.php / contact-chat.php. No public send path.
//
//  Request (JSON POST):  { booking_id, intent }
//     intent ∈ booking_confirmed | reschedule | staff_message
//  The browser supplies ONLY the booking id + intent. Everything customer-facing
//  (name, phone, reference, chat URL) is derived SERVER-SIDE from the trusted
//  bookings row — the browser can never inject a phone number, name, or URL.
//
//  Response (HTTP 200 unless auth/validation fails):
//     { ok:true, data:{ sent:bool, code:string, dedupe?:bool, dry_run?:bool,
//                        ref, segments } }
//  Hard failures (auth / bad input / not a real customer booking) return ok:false.
//  A "customer has no usable phone" is a SOFT result (sent:false, code:'no_phone')
//  so the caller shows a non-blocking notice instead of an error.
//
//  Eligibility (rule: only REAL customer bookings):
//     • status must not be 'admin_blocked' (Ops availability blocks / closed days)
//     • the booking must carry a customer reference (ref: in notes) — availability
//       blocks and internal calendar entries have none, so they are refused.
//
//  Idempotency: a recent (SMS_DEDUPE_WINDOW) audit_log row for the same
//  (booking, intent) with result sent|pending short-circuits a duplicate send —
//  covering double-click, ret#ry, refresh, and provider-accepted-but-response-lost.
//
//  Direct Chat Link: EmailService::chatUrl($cfg, $ref) — REUSED UNCHANGED. The
//  customer only enters their email after opening it; the booking ref alone is not
//  authentication (auth.php enforces ref + email server-side).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/EmailService.php';   // chatUrl() — existing chat deep-link
require_once __DIR__ . '/SmsService.php';     // provider-agnostic SMS adapter

const SMS_DEDUPE_WINDOW = 600;   // seconds a same (booking,intent) send is suppressed

hm_cors();
hm_require_api_key();
hm_rate_limit('send_sms', 20, 60);   // max 20 SMS calls / IP / minute

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
  if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('send_sms');
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

  // ── Resolve the booking from TRUSTED server-side records ───────────────────
  $q = $db->prepare('SELECT customer_name, customer_email, customer_phone, notes, status FROM bookings WHERE id = ? LIMIT 1');
  $q->execute([$bookingId]);
  $bk = $q->fetch(PDO::FETCH_ASSOC);
  if (!$bk) hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'not_found', 'code' => 'not_found']], 404);

  // Eligibility: never SMS an availability block / closed day / internal entry.
  if ((string)($bk['status'] ?? '') === 'admin_blocked') {
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'not a customer booking', 'code' => 'not_eligible']], 400);
  }

  // Booking reference (public HM-… number) — packed into notes by bookingService.
  // Its ABSENCE marks a non-customer row (block / closed day) → refuse. Also the
  // Direct Chat Link cannot exist without it.
  $ref = '';
  if (preg_match('/^ref:\s*(\S+)/m', (string)($bk['notes'] ?? ''), $rm)) $ref = trim($rm[1]);
  if ($ref === '') {
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'no customer reference', 'code' => 'not_eligible']], 400);
  }

  // ── Duplicate / retry protection (audit_log, no schema change) ─────────────
  sms_ensure_audit($db);
  if (sms_recent_send_exists($db, $bookingId, $intent)) {
    hm_json(['ok' => true, 'data' => ['sent' => false, 'code' => 'duplicate', 'dedupe' => true, 'ref' => $ref]]);
  }

  // ── Phone: normalize the STORED number; missing/invalid → SOFT skip ─────────
  $phone = SmsService::normalizePhone((string)($bk['customer_phone'] ?? ''));
  if ($phone === '') {
    sms_audit($db, $actor, $bookingId, $intent, ['result' => 'no_phone'], 0);
    hm_json(['ok' => true, 'data' => ['sent' => false, 'code' => 'no_phone', 'ref' => $ref]]);
  }

  // ── Build body + Direct Chat Link (existing mechanism, unchanged) ──────────
  $link = EmailService::chatUrl($cfg, $ref);
  $body = SmsService::render($intent, (string)($bk['customer_name'] ?? ''), $ref, $link);
  $seg  = SmsService::segmentsUcs2($body);

  // Claim row FIRST (result=pending) so a concurrent double-click / lost response
  // is treated as a duplicate rather than a second live send.
  $claimId = sms_audit($db, $actor, $bookingId, $intent, ['result' => 'pending', 'seg' => $seg], $seg);

  // ── Send (best-effort; never throws) ───────────────────────────────────────
  $r    = SmsService::send($cfg, $phone, $body);
  $sent = !empty($r['sent']);
  $code = (string)($r['code'] ?? ($sent ? 'sent' : 'failed'));

  // Finalize the audit row + a masked JSON log line (no body, no full number).
  sms_audit_update($db, $claimId, [
    'intent' => $intent,   // retained so the dedupe LIKE still matches a finalized 'sent' row
    'result' => $sent ? 'sent' : 'failed',
    'code'   => $code,
    'to'     => SmsService::maskPhone($phone),
    'seg'    => $seg,
  ]);
  if (function_exists('hm_log_write')) {
    hm_log_write('info.log', [
      'type' => 'sms_send', 'actor' => $actor, 'ref' => $ref, 'intent' => $intent,
      'result' => $sent ? 'sent' : 'failed', 'code' => $code,
      'to' => SmsService::maskPhone($phone), 'seg' => $seg,
    ]);
  }
  if (!$sent && function_exists('hm_log_error')) {
    hm_log_error('sms send failed', ['ref' => $ref, 'intent' => $intent, 'code' => $code]);
  }

  hm_json(['ok' => true, 'data' => [
    'sent'     => $sent,
    'code'     => $code,
    'dry_run'  => !empty($r['dry_run']),
    'ref'      => $ref,
    'segments' => $seg,
  ]]);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('send-sms failed', ['err' => $e->getMessage(), 'booking' => $bookingId]);
  // Even an unexpected server error is reported softly at the data layer so the
  // Ops caller treats SMS as non-blocking; the HTTP status still signals failure.
  hm_json(['ok' => false, 'data' => ['sent' => false, 'code' => 'server'], 'error' => ['message' => hm_safe_msg('Request failed', $e), 'code' => 'server']], 500);
}

// ════════════════════════════════════════════════════════════════════════════
//  audit_log helpers — reuse the existing append-only trail (no new table).
// ════════════════════════════════════════════════════════════════════════════
function sms_ensure_audit(PDO $db): void {
  try {
    $db->exec(
      "CREATE TABLE IF NOT EXISTS audit_log (
        id CHAR(36) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actor VARCHAR(191) NOT NULL DEFAULT 'system', action VARCHAR(40) NOT NULL DEFAULT 'other',
        target_type VARCHAR(40) NOT NULL DEFAULT '-', target_id VARCHAR(191) NOT NULL DEFAULT '',
        details TEXT, PRIMARY KEY (id), KEY idx_audit_action (action),
        KEY idx_audit_target (target_type, target_id), KEY idx_audit_actor (actor)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
  } catch (Throwable $e) { /* best-effort */ }
}

// True when a recent (window) SMS for the same (booking, intent) is already
// sent or in-flight (pending). The details JSON carries intent + result.
function sms_recent_send_exists(PDO $db, string $bookingId, string $intent): bool {
  try {
    $st = $db->prepare(
      "SELECT COUNT(*) FROM audit_log
        WHERE action = 'sms_notify' AND target_type = 'booking' AND target_id = ?
          AND created_at > (NOW() - INTERVAL ? SECOND)
          AND details LIKE ? AND (details LIKE '%\"result\":\"sent\"%' OR details LIKE '%\"result\":\"pending\"%')"
    );
    $st->execute([$bookingId, SMS_DEDUPE_WINDOW, '%"intent":"' . $intent . '"%']);
    return (int)$st->fetchColumn() > 0;
  } catch (Throwable $e) {
    return false;   // fail-open: never block a legitimate send on an audit hiccup
  }
}

// Append an audit row; returns its id (for later finalization). Best-effort.
function sms_audit(PDO $db, string $actor, string $bookingId, string $intent, array $extra, int $seg): string {
  $id = hm_uuid4();
  try {
    $details = json_encode(array_merge(['intent' => $intent], $extra), JSON_UNESCAPED_UNICODE);
    $st = $db->prepare('INSERT INTO audit_log (id, actor, action, target_type, target_id, details) VALUES (?,?,?,?,?,?)');
    $st->execute([$id, mb_substr($actor, 0, 191), 'sms_notify', 'booking', mb_substr($bookingId, 0, 191), $details]);
  } catch (Throwable $e) {
    if (function_exists('hm_log_error')) hm_log_error('sms audit failed', ['err' => $e->getMessage(), 'booking' => $bookingId]);
  }
  return $id;
}

// Overwrite an existing audit row's details with the final result. Best-effort.
function sms_audit_update(PDO $db, string $id, array $details): void {
  if ($id === '') return;
  try {
    $st = $db->prepare('UPDATE audit_log SET details = ? WHERE id = ?');
    $st->execute([json_encode($details, JSON_UNESCAPED_UNICODE), $id]);
  } catch (Throwable $e) { /* best-effort */ }
}
