<?php
// ════════════════════════════════════════════════════════════════════════════
//  customer-bookings.php — Customer Profile System, Phase 1 (READ-ONLY)
//
//  GET /hm-api/customer-bookings.php?email=<e>&reference=<HM-xxx>&page=<n>&per=<m>
//
//  Paginated booking history for one customer, NEWEST FIRST. Ownership: the
//  (email, reference) pair must match a booking (same server-side check as
//  auth.php / _profiles.php); results are then scoped to that email ONLY.
//  Generic 'invalid' for any mismatch (anti-enumeration).
//
//  Per project decision, NO price fields are returned (bookings carry no price).
//
//  → { ok:true,
//      data:{ items:[ { ref, date, service, status } ], page, per, total },
//      error:null }
//
//  Read-only: never writes to bookings / booking_slots / any table.
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

// ── Input ────────────────────────────────────────────────────────────────────
$email = strtolower(trim((string)($_GET['email'] ?? '')));
$ref   = trim((string)($_GET['reference'] ?? ''));

// Strict validation of required credentials (matches auth.php).
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || $ref === '') {
  hm_json(['ok' => false, 'data' => null, 'error' => 'invalid'], 400);
}

// Pagination — clamp to safe bounds. LIMIT/OFFSET are validated integers and
// inlined (PDO with emulated prepares OFF rejects bound LIMIT params); casting
// to (int) makes them injection-safe.
$page = (int)($_GET['page'] ?? 1);
$per  = (int)($_GET['per']  ?? 10);
if ($page < 1)   $page = 1;
if ($per  < 1)   $per  = 10;
if ($per  > 50)  $per  = 50;              // hard ceiling — no unbounded scans
$offset = ($page - 1) * $per;

try {
  $db = hm_db();

  // ── Ownership gate — generic 'invalid' (never disclose whether a ref exists) ─
  if (!hm_profile_verify_owner($db, $email, $ref)) {
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('customer_bookings');
    hm_json(['ok' => false, 'data' => null, 'error' => 'invalid'], 404);
  }

  // ── Total (scoped to this email) ─────────────────────────────────────────────
  $cst = $db->prepare('SELECT COUNT(*) AS n FROM bookings WHERE LOWER(customer_email) = ?');
  $cst->execute([$email]);
  $total = (int)($cst->fetch()['n'] ?? 0);

  // ── Page of rows, NEWEST FIRST (booking_date desc, then created_at desc) ─────
  $sql = 'SELECT id, booking_date, service_id, status, notes, created_at
          FROM bookings
          WHERE LOWER(customer_email) = ?
          ORDER BY booking_date DESC, created_at DESC
          LIMIT ' . (int)$per . ' OFFSET ' . (int)$offset;
  $rst = $db->prepare($sql);
  $rst->execute([$email]);

  // ── Shape each row (ref + service parsed from the packed [HM_EXTRAS] notes) ──
  $items = [];
  foreach ($rst as $row) {
    $svc = trim((string)($row['service_id'] ?? ''));
    if ($svc === '') $svc = (string)(hm_profile_service_from_notes($row['notes'] ?? '') ?? '');
    $items[] = [
      'ref'     => hm_profile_ref_from_notes($row['notes'] ?? '') ?? (string)($row['id'] ?? ''),
      'date'    => (string)($row['booking_date'] ?? ''),
      'service' => $svc,
      'status'  => (string)($row['status'] ?? ''),
    ];
  }

  hm_json(['ok' => true, 'data' => [
    'items' => $items,
    'page'  => $page,
    'per'   => $per,
    'total' => $total,
  ], 'error' => null]);

} catch (Throwable $e) {
  hm_log_error('customer-bookings failed', ['err' => $e->getMessage()]);
  hm_json(['ok' => false, 'data' => null, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
