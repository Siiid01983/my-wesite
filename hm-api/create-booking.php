<?php
// ════════════════════════════════════════════════════════════════════════════
//  create-booking.php — public booking form submit (POST JSON)
//
//  Body: a booking row already shaped by the client (customer_name,
//        customer_email, customer_phone, booking_date, service_id, status,
//        notes [HM-ref + from/to/service packed], items, created_at).
//  Returns: { ok:true, id } | { ok:false, error }
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_cache.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/_line.php';
require_once __DIR__ . '/_slots.php';   // Phase 2: slot lock (feature-flagged, OFF by default)
hm_cors();
hm_require_api_key();
hm_rate_limit('booking', 5, 60);   // public submit: max 5 / IP / minute

$p = hm_body(true);
$ALLOWED = ['customer_name','customer_email','customer_phone','booking_date','service_id','status','notes','items','created_at'];

$data = [];
foreach ($ALLOWED as $c) {
  if (!array_key_exists($c, $p)) continue;
  $data[$c] = ($c === 'items') ? json_encode($p[$c], JSON_UNESCAPED_UNICODE) : $p[$c];
}

// ── Validate required fields (go-live hardening) ─────────────────────────────
//  NOTE: service_id is intentionally NOT range/numeric-checked — the public form
//  always sends service_id=null and packs the chosen service into `notes`
//  (bookingService._packNotes). The column is VARCHAR; numeric validation would
//  reject every legitimate booking.
$name  = trim((string)($data['customer_name']  ?? ''));
$name  = preg_replace('/\s+/u', ' ', $name);   // normalize internal whitespace
$email = trim((string)($data['customer_email'] ?? ''));
$phone = trim((string)($data['customer_phone'] ?? ''));
$bdate = trim((string)($data['booking_date']   ?? ''));
$bts   = $bdate === '' ? false : strtotime($bdate);
$errs  = [];
if ($name === '')                                            $errs[] = 'name required';
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) $errs[] = 'valid email required';
if (strlen(preg_replace('/\D/', '', $phone)) < 8)            $errs[] = 'valid phone required';
if ($bdate === '' || $bts === false)                         $errs[] = 'valid booking_date required';
// Reject clearly-past dates (anti-tampering). 1-day grace avoids timezone
// false-positives for legitimate same-day bookings (server TZ vs client JST).
elseif ($bts < strtotime('today') - 86400)                   $errs[] = 'booking_date must not be in the past';

// ── Service-aware address validation ─────────────────────────────────────────
//  Addresses are packed into `notes` by the client (bookingService._packNotes):
//    from:<loc> / to:<dest> / locmode:single|dual  (in the [HM_EXTRAS] block).
//  Single-location services (junk removal / furniture assembly) need only a
//  service location; moving jobs need both current + destination. We enforce
//  this ONLY when the packed block is positively identified (locmode or ref:
//  present) so any non-BA / future caller passes through untouched.
$notes = (string)($data['notes'] ?? '');
$sep   = "\n[HM_EXTRAS]\n";
$spos  = strpos($notes, $sep);
$block = $spos !== false ? substr($notes, $spos + strlen($sep)) : $notes;
$mode  = '';
if (preg_match('/^locmode:\s*(\w+)/m', $block, $mm)) $mode = strtolower($mm[1]);
$isPacked = ($mode !== '') || (strpos($block, 'ref:') !== false);
if ($isPacked) {
  $hasFrom = (bool)preg_match('/^from:\s*\S/m', $block);
  $hasTo   = (bool)preg_match('/^to:\s*\S/m', $block);
  if ($mode === 'single') {
    if (!$hasFrom) $errs[] = 'service location required';
  } else {                       // dual / moving (default)
    if (!$hasFrom) $errs[] = 'current address required';
    if (!$hasTo)   $errs[] = 'destination address required';
  }
}
if ($errs) {
  hm_log_write('error.log', ['type' => 'invalid_request', 'endpoint' => 'create-booking',
    'errors' => $errs, 'fp' => hm_client_fingerprint()]);
  hm_json(['ok' => false, 'data' => null, 'error' => implode('; ', $errs)], 400);
}

// Store normalized values; cap lengths + strip control chars (anti-abuse defense
// in depth). Output is HTML-escaped at render time, so legitimate input is NOT
// HTML-stripped here — \n and \t are preserved for multi-line notes.
$data['customer_name']  = $name;
$data['customer_email'] = $email;
$data['customer_phone'] = $phone;
$CAPS = ['customer_name'=>200,'customer_email'=>254,'customer_phone'=>40,'booking_date'=>40,'status'=>40,'notes'=>5000];
foreach ($CAPS as $col => $max) {
  if (!isset($data[$col]) || !is_string($data[$col])) continue;
  $data[$col] = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $data[$col]);
  if (mb_strlen($data[$col]) > $max) $data[$col] = mb_substr($data[$col], 0, $max);
}

// items (if ever sent): must be a JSON array of bounded size — re-encode from the
// raw decoded payload so only well-formed data is stored. The BA overlay packs
// items into `notes`, so this is defensive for future callers.
if (array_key_exists('items', $data)) {
  $items = (isset($p['items']) && is_array($p['items'])) ? $p['items'] : [];
  if (count($items) > 100) $items = array_slice($items, 0, 100);
  $enc = json_encode($items, JSON_UNESCAPED_UNICODE);
  $data['items'] = (is_string($enc) && strlen($enc) <= 20000) ? $enc : '[]';
}

$data['id'] = hm_uuid4();
if (empty($data['status'])) $data['status'] = 'pending';

try {
  $db   = hm_db();
  $keys = array_keys($data);
  $ph   = implode(',', array_fill(0, count($keys), '?'));
  $sql  = 'INSERT INTO bookings (' . implode(',', array_map(fn($c) => "`$c`", $keys)) . ") VALUES ($ph)";

  // ── Phase 2: server-side slot lock (SLOT_LOCK_ENABLED, OFF by default) ──────
  //  When the flag is ON *and* this booking carries a canonical band, reserve
  //  the slot ATOMICALLY with the booking insert, BEFORE the success response is
  //  flushed (finding #7). A slot collision → 409 and NO booking row is written.
  //  Because the slot's UNIQUE(date,band) row is inserted first, a duplicate
  //  same-band re-submit also 409s → inherent idempotency for locked bands
  //  (finding #8). Flag OFF, or a band-less / 時間指定なし booking, takes the
  //  ORIGINAL plain-insert path below — behaviour identical to before.
  $lockTime = hm_slot_lock_enabled() ? hm_slot_time_from_notes($data['notes'] ?? '') : null;
  $lockBand = $lockTime !== null ? hm_slot_band_id($lockTime) : null;

  if ($lockBand !== null) {
    $db->beginTransaction();
    try {
      $res = hm_slot_reserve($db, (string)($data['booking_date'] ?? ''), $lockTime, (string)$data['id']);
      if (!empty($res['conflict'])) {
        $db->rollBack();
        hm_log_write('info.log', ['type' => 'slot_conflict', 'endpoint' => 'create-booking',
          'date' => (string)($data['booking_date'] ?? ''), 'band' => $lockBand]);
        hm_json(['ok' => false, 'data' => null, 'error' => 'slot_taken'], 409);
      }
      $st = $db->prepare($sql);
      $st->execute(array_values($data));
      $db->commit();
    } catch (Throwable $e) {
      if ($db->inTransaction()) $db->rollBack();
      throw $e;
    }
  } else {
    $st = $db->prepare($sql);
    $st->execute(array_values($data));
  }

  hm_log_booking($data['id'], ['email' => (string)($data['customer_email'] ?? ''), 'date' => (string)($data['booking_date'] ?? '')]);
  hm_cache_invalidate_table('bookings');   // dashboard stats / lists pick this up

  // ── Success: respond to the customer immediately, THEN fire the LINE alert ──
  // `id` kept top-level for back-compat; data/error added for the standard envelope.
  $resp = ['ok' => true, 'id' => $data['id'], 'data' => ['id' => $data['id']], 'error' => null];
  http_response_code(200);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($resp, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  // Flush the response to the client before the LINE round-trip. Handler-agnostic:
  // fastcgi_finish_request() on PHP-FPM, litespeed_finish_request() on LiteSpeed
  // (lsphp — common on cPanel). On other SAPIs (mod_php/suPHP) neither exists and
  // the push runs inline (bounded by hm_line_push's 8s timeout).
  if      (function_exists('fastcgi_finish_request'))  fastcgi_finish_request();
  elseif  (function_exists('litespeed_finish_request')) litespeed_finish_request();

  // Server-side new-booking notification. Gated ONLY by line_enabled (server
  // config) — the admin UI's per-trigger toggles live in browser localStorage
  // and are not visible to PHP. Fire-and-forget: hm_line_push never throws, so
  // a LINE failure is logged and never affects the (already-sent) booking.
  if (hm_line_enabled()) {
    $msg = "📅 新規予約（ウェブ）\n"
         . "お名前: {$name}\n"
         . "日程: "   . (string)($data['booking_date'] ?? '未定') . "\n"
         . "電話: {$phone}\n"
         . "メール: {$email}\n"
         . "受付ID: {$data['id']}";
    if (!empty($data['notes'])) $msg .= "\n---\n" . mb_substr((string)$data['notes'], 0, 500);
    hm_line_push($msg);
  }

  // ── Admin Inbox row (replaces the old client-side Formspree email) ─────────
  // Persistent, internal booking notification: appears in the admin Inbox
  // (inbox_messages), linked to the booking via booking_id. `notes` already
  // carries the packed details (service / from / to / 希望時間 / 階数・EV /
  // 荷物 / 不用品回収). Fire-and-forget: the customer's response is already
  // flushed, so a failure here is logged and never affects the booking.
  try {
    $bdateStr = (string)($data['booking_date'] ?? '未定');
    $body = "新規予約（ウェブ予約フォーム）\n"
          . "お名前: {$name}\n"
          . "メール: {$email}\n"
          . "電話: {$phone}\n"
          . "日程: {$bdateStr}\n"
          . "受付ID: {$data['id']}";
    if (!empty($data['notes'])) $body .= "\n---\n" . (string)$data['notes'];
    $st = hm_db()->prepare(
      'INSERT INTO inbox_messages (id, sender, email, subject, body, body_text, booking_id, mailbox, sender_name, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,NOW())'
    );
    $st->execute([
      hm_uuid4(),
      $name,
      $email,
      "📅 新規予約: {$name}（{$bdateStr}）",
      $body,
      $body,
      $data['id'],
      'booking@hello-moving.com',
      $name,
    ]);
    hm_cache_invalidate_table('inbox_messages');
  } catch (Throwable $e) {
    hm_log_error('create-booking inbox row failed', ['err' => $e->getMessage(), 'booking' => $data['id']]);
  }
  exit;
} catch (Throwable $e) {
  hm_log_error('create-booking failed', ['err' => $e->getMessage()]);
  hm_json(['ok' => false, 'data' => null, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
