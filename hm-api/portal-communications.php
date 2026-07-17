<?php
// ════════════════════════════════════════════════════════════════════════════
//  portal-communications.php — Customer Portal communications read (READ-ONLY)
//
//  GET /hm-api/portal-communications.php?email=<e>&reference=<HM-xxx>
//
//  Ownership-gated, exactly like customer-profile.php / customer-bookings.php:
//  the (email, reference) pair must match a booking (same server-side check as
//  auth.php via hm_profile_verify_owner). Data is then scoped SERVER-SIDE to that
//  booking's communications AND to that customer's email — the client cannot
//  supply the scope, so there is no global-read surface. Generic 'invalid' for
//  any mismatch (anti-enumeration).
//
//  Replaces the previous raw rest.php SELECT from the customer surface (which was
//  gated only by the public page-served API key). Read-only: never writes.
//
//  → { ok:true, data:{ items:[ { id, booking_id, customer_email, sender_email,
//        subject, message, direction, created_at } ] }, error:null }
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/_profiles.php';
hm_cors();
hm_require_api_key();
hm_rate_limit('general', 30, 60);   // public read: max 30 / IP / minute

// ── Method guard: read-only endpoint accepts GET only ────────────────────────
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
  hm_json(['ok' => false, 'data' => null, 'error' => 'method not allowed — use GET'], 405);
}

// ── Input (same strict validation as auth.php / customer-bookings.php) ────────
$email = strtolower(trim((string)($_GET['email'] ?? '')));
$ref   = trim((string)($_GET['reference'] ?? ''));
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || $ref === '') {
  hm_json(['ok' => false, 'data' => null, 'error' => 'invalid'], 400);
}

try {
  $db = hm_db();

  // ── Ownership gate — generic 'invalid' (never disclose whether a ref exists) ─
  if (!hm_profile_verify_owner($db, $email, $ref)) {
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('portal_communications');
    hm_json(['ok' => false, 'data' => null, 'error' => 'invalid'], 404);
  }

  // ── Resolve the owner's booking id(s) SERVER-SIDE ────────────────────────────
  // Messages may be filed under the booking's DB id OR its HM-reference; scope to
  // both — but only for a booking that belongs to THIS email. The client never
  // supplies booking ids, so it cannot widen the scope.
  $bk = $db->prepare('SELECT id FROM bookings WHERE notes LIKE ? AND LOWER(customer_email) = ? ORDER BY created_at DESC LIMIT 1');
  $bk->execute(['%ref:' . $ref . '%', $email]);
  $row = $bk->fetch();

  $ids = [];
  if ($row && isset($row['id']) && (string)$row['id'] !== '') $ids[] = (string)$row['id'];
  $ids[] = $ref;
  $ids = array_values(array_unique($ids));

  // ── Communications for those booking id(s), guarded again by customer_email ─
  // (blank customer_email rows are kept — already constrained by booking id.)
  $ph  = implode(',', array_fill(0, count($ids), '?'));
  $sql = "SELECT id, booking_id, customer_email, sender_email, subject, message, direction, created_at
          FROM communications
          WHERE booking_id IN ($ph)
            AND (LOWER(customer_email) = ? OR customer_email IS NULL OR customer_email = '')
          ORDER BY created_at DESC
          LIMIT 200";
  $st = $db->prepare($sql);
  $st->execute(array_merge($ids, [$email]));

  $items = [];
  foreach ($st as $r) {
    $items[] = [
      'id'             => $r['id'] ?? null,
      'booking_id'     => $r['booking_id'] ?? null,
      'customer_email' => $r['customer_email'] ?? '',
      'sender_email'   => $r['sender_email'] ?? '',
      'subject'        => $r['subject'] ?? '',
      'message'        => $r['message'] ?? '',
      'direction'      => $r['direction'] ?? 'outbound',
      'created_at'     => $r['created_at'] ?? null,
    ];
  }

  hm_json(['ok' => true, 'data' => ['items' => $items], 'error' => null]);

} catch (Throwable $e) {
  hm_log_error('portal-communications failed', ['err' => $e->getMessage()]);
  hm_json(['ok' => false, 'data' => null, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
