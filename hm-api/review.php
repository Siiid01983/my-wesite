<?php
// ════════════════════════════════════════════════════════════════════════════
//  review.php — post-completion customer review, opened from an EMAIL LINK
//
//  The completed-booking email (booking-status.php) contains
//  review.html?token=<opaque>. That page calls this endpoint. There is NO login
//  and NO portal session here — the SIGNED TOKEN is the sole authorization: it
//  binds the request to exactly one booking and cannot be forged or altered
//  (see _reviewtoken.php). No customer/admin data is ever taken from the URL.
//
//  Reached at:  <API_BASE>/review.php?action=info|submit
//  Auth model:  X-API-KEY (page-served) + a valid review token. Rate-limited.
//
//  action=info    GET  ?token=…
//                 → { ok, data:{ state:'ok'|'used', ref, service } }   (masked)
//                 invalid/expired token → { ok:false, error:'invalid' }
//  action=submit  POST { token, rating(1-5), comment?, name? }
//                 → { ok, data:{ saved:true } }
//                 already reviewed → { ok:false, error:'used' }
//
//  A submitted review is written to the EXISTING `reviews` table exactly like the
//  portal/admin flow (source='customer', approved=0 → admin approval queue). The
//  client can NEVER set approved/published. Single-use is enforced by refusing a
//  second review for the same booking (reviews.booking_reference idempotency key).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/_reviewtoken.php';

hm_cors();
hm_require_api_key();
hm_rate_limit('review', 30, 60);   // max 30 review calls / IP / minute

$action = (string)($_GET['action'] ?? 'info');

// Resolve the booking behind a token, or emit a generic invalid + exit. Returns
// the booking row plus the derived human reference (HM-…) and service.
function review_resolve(string $token): array {
  $tok = hm_review_token_parse($token);
  if ($tok === null) hm_json(['ok' => false, 'data' => null, 'error' => 'invalid'], 200);
  $bookingId = (string)$tok['booking_id'];
  try {
    $st = hm_db()->prepare('SELECT id, customer_name, notes, status FROM bookings WHERE id = ? LIMIT 1');
    $st->execute([$bookingId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
  } catch (Throwable $e) {
    hm_log_error('review resolve failed', ['err' => $e->getMessage()]);
    hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
  }
  if (!$row) hm_json(['ok' => false, 'data' => null, 'error' => 'invalid'], 200);

  // Human reference + service are packed inside notes by bookingService._packNotes.
  $ref = $bookingId;
  if (preg_match('/^ref:\s*(\S+)/m', (string)($row['notes'] ?? ''), $m)) $ref = trim($m[1]);
  $svc = '';
  if (preg_match('/^service:\s*(.+)$/m', (string)($row['notes'] ?? ''), $sm)) $svc = trim($sm[1]);

  return ['row' => $row, 'booking_id' => $bookingId, 'ref' => $ref, 'service' => $svc];
}

// Has this booking already been reviewed? Checks BOTH identifiers (uuid + HM ref)
// so the email link and the in-portal 口コミ投稿 form dedupe against each other.
function review_exists(string $bookingId, string $ref): bool {
  try {
    $st = hm_db()->prepare('SELECT 1 FROM reviews WHERE booking_reference IN (?, ?) LIMIT 1');
    $st->execute([$bookingId, $ref]);
    return (bool)$st->fetchColumn();
  } catch (Throwable $e) {
    hm_log_error('review exists check failed', ['err' => $e->getMessage()]);
    return false;   // fail-open on the READ so a transient DB blip doesn't hard-block; the
                    // INSERT path still guards below.
  }
}

// ── action=info ──────────────────────────────────────────────────────────────
if ($action === 'info') {
  $v     = review_resolve((string)($_GET['token'] ?? ''));
  $state = review_exists($v['booking_id'], $v['ref']) ? 'used' : 'ok';
  hm_ok(['state' => $state, 'ref' => $v['ref'], 'service' => $v['service']]);
}

// ── action=submit ────────────────────────────────────────────────────────────
if ($action === 'submit') {
  $p     = hm_body();
  $v     = review_resolve((string)($p['token'] ?? ''));
  $bid   = $v['booking_id'];
  $ref   = $v['ref'];

  $rating = (int)($p['rating'] ?? 0);
  if ($rating < 1 || $rating > 5) hm_json(['ok' => false, 'data' => null, 'error' => 'bad_rating'], 400);

  // Comment + display name are OPTIONAL. Both bounded server-side.
  $comment = trim((string)($p['comment'] ?? ($p['text'] ?? '')));
  if (mb_strlen($comment) > 2000) $comment = mb_substr($comment, 0, 2000);
  $name = trim((string)($p['name'] ?? ''));
  if ($name === '') $name = trim((string)($v['row']['customer_name'] ?? '')) ?: 'お客様';
  $name = mb_substr($name, 0, 60);

  // Single-use: refuse a second review for this booking (idempotency key).
  if (review_exists($bid, $ref)) hm_json(['ok' => false, 'data' => null, 'error' => 'used'], 200);

  $reviewId = hm_uuid4();
  $refId    = 'REV-' . time() . '-' . strtoupper(substr(bin2hex(random_bytes(3)), 0, 5));
  try {
    // Store booking_reference = the human HM ref (matches the portal path), so both
    // entry points converge on one idempotency key. approved/published FORCED to 0.
    $st = hm_db()->prepare(
      'INSERT INTO reviews
         (id, reference_id, customer_name, rating, review_text, approved, published, service, source, booking_reference, created_at)
       VALUES (?,?,?,?,?,0,0,?,?,?,NOW())'
    );
    $st->execute([
      $reviewId,
      $refId,
      $name,
      $rating,
      $comment,
      ($v['service'] !== '' ? $v['service'] : null),
      'customer',
      $ref,
    ]);
    if (function_exists('hm_cache_invalidate_table')) hm_cache_invalidate_table('reviews');
  } catch (Throwable $e) {
    // A race that trips the reference_id unique key (double-submit) is treated as
    // already-saved rather than a hard error.
    hm_log_error('review submit failed', ['err' => $e->getMessage(), 'booking' => $bid]);
    if (review_exists($bid, $ref)) hm_json(['ok' => false, 'data' => null, 'error' => 'used'], 200);
    hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
  }

  hm_ok(['saved' => true]);
}

hm_json(['ok' => false, 'data' => null, 'error' => 'unknown_action'], 400);
