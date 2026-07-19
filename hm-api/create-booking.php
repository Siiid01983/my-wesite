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
require_once __DIR__ . '/_intervals.php';   // hourly dual-write gate (feature-flagged, OFF by default)
require_once __DIR__ . '/_capacity.php';    // capacity-based reserve (capacity_enabled, OFF by default)
hm_cors();
hm_require_api_key();
hm_rate_limit('booking', 5, 60);   // public submit: max 5 / IP / minute

// Address privacy (server-side, mirrors js/lib/addressPrivacy.js maskAddress):
// keep 都道府県 + the FIRST 市/区/町/村; drop postal / street / building / floor.
// Privacy-first — an uncertain parse masks MORE.
function hm_mask_address(string $a): string {
  $a = trim($a);
  if ($a === '') return '';
  // Drop a leading postal code (〒123-4567 / 123-4567).
  $a = trim(preg_replace('/^〒?\s*[0-9０-９]{3}[-‐ー－]?[0-9０-９]{4}\s*/u', '', $a));
  if (preg_match('/^\s*([^0-9０-９]*?[都道府県])?\s*([^0-9０-９]*?[市区町村])/u', $a, $m) && ($m[2] ?? '') !== '') {
    return preg_replace('/\s+/u', '', ($m[1] ?? '') . $m[2]);
  }
  if (strpos($a, ',') !== false) {                       // western: keep last two parts
    $p = array_values(array_filter(array_map('trim', explode(',', $a))));
    return count($p) > 2 ? implode(', ', array_slice($p, -2)) : implode(', ', $p);
  }
  if (preg_match('/^([^0-9０-９]+)/u', $a, $n) && mb_strlen(trim($n[1])) >= 2) return trim($n[1]);
  return '';
}
// Rewrite the from:/to: address values inside a packed notes block to their masked
// locality — used for the pre-confirmation admin notification body only.
function hm_mask_notes_addresses(string $notes): string {
  return preg_replace_callback('/^(from|to):\s*(.+)$/mu', function ($m) {
    $masked = hm_mask_address($m[2]);
    return $m[1] . ': ' . ($masked !== '' ? $masked : '（詳細は確定後に表示）');
  }, $notes);
}

$p = hm_body(true);
$ALLOWED = ['customer_name','customer_email','customer_phone','booking_date','service_id','status','notes','items','created_at','preferred_start_1','preferred_start_2'];

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

  // ── HOURLY / CLIENT-REQUEST handling (all gated; dormant until hourly is live) ─
  //  Two mutually-exclusive branches, both behind hm_iv_active (flag ON + migrated):
  //   • Client-Request model — the customer sent preferred appointment time(s):
  //     store them and keep the row a PENDING request. start_at/end_at stay NULL;
  //     the admin sets the final duration later via confirm-request.php. No band,
  //     no forced end-time calc.
  //   • Band transition — no preferred time: mirror the requested band into
  //     start_at/end_at (am 09–12 · pm 12–15 · ev 15–18 · nt 18–21), as before.
  //  Deploy-order-safe: the preferred_* columns are kept ONLY when their migration
  //  (002) has run (hm_bookings_has_request_cols); otherwise they are stripped so
  //  the INSERT matches whatever schema is actually present.
  $__ivActive = hm_iv_active($db);
  if ($__ivActive && hm_bookings_has_request_cols($db)) {
    foreach (['preferred_start_1', 'preferred_start_2'] as $__pk) {
      if (isset($data[$__pk])) {
        $__nz = hm_iv_normalize((string)$data[$__pk]);
        if ($__nz === null) unset($data[$__pk]); else $data[$__pk] = $__nz;
      }
    }
  } else {
    unset($data['preferred_start_1'], $data['preferred_start_2']);
  }

  if ($__ivActive && !empty($data['preferred_start_1'])) {
    // Client-Request: awaits admin confirmation. start_at/end_at intentionally NULL.
    $data['status'] = 'pending';
  } elseif ($__ivActive) {
    $__band = hm_slot_band_id(hm_slot_time_from_notes($data['notes'] ?? ''));
    $__bandHours = [
      'am' => ['09:00', '12:00'], 'pm' => ['12:00', '15:00'],
      'ev' => ['15:00', '18:00'], 'nt' => ['18:00', '21:00'],
    ];
    $__dateOnly = substr((string)($data['booking_date'] ?? ''), 0, 10);
    if ($__band !== null && isset($__bandHours[$__band])
        && preg_match('/^\d{4}-\d{2}-\d{2}$/', $__dateOnly)) {
      $data['start_at'] = $__dateOnly . ' ' . $__bandHours[$__band][0] . ':00';
      $data['end_at']   = $__dateOnly . ' ' . $__bandHours[$__band][1] . ':00';
    }
  }

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
  // Reserve gate: 'capacity_enabled' (per-band configurable capacity) takes
  // precedence over the capacity-1 slot lock. When EITHER is on AND the booking
  // carries a band, the reserve runs ATOMICALLY with the insert; a collision → 409
  // and NO booking row is written. capacity_enabled OFF → byte-for-byte the prior
  // slot-lock behavior (hm_slot_lock_enabled path unchanged).
  $capOn    = hm_capacity_enabled();
  // Reservation is DEFERRED to admin confirmation (booking-status.php reserves on
  // 確定). A customer booking is a REQUEST/PREFERENCE only and must NOT reserve or
  // block a slot at create time — the booking stays 新規 and the calendar/capacity
  // are unchanged until an admin confirms. Set 'reserve_on_create' truthy in
  // _config.php to restore the old create-time locking behaviour.
  $reserveOnCreate = !empty(hm_config()['reserve_on_create']);
  $lockTime = ($reserveOnCreate && (hm_slot_lock_enabled() || $capOn)) ? hm_slot_time_from_notes($data['notes'] ?? '') : null;
  $lockBand = $lockTime !== null ? hm_slot_band_id($lockTime) : null;

  if ($lockBand !== null) {
    $db->beginTransaction();
    try {
      $res = $capOn
        ? hm_cap_reserve($db, (string)($data['booking_date'] ?? ''), $lockBand, (string)$data['id'])
        : hm_slot_reserve($db, (string)($data['booking_date'] ?? ''), $lockTime, (string)$data['id']);
      if (!empty($res['conflict'])) {
        $db->rollBack();
        hm_log_write('info.log', ['type' => 'slot_conflict', 'endpoint' => 'create-booking',
          'date' => (string)($data['booking_date'] ?? ''), 'band' => $lockBand,
          'mode' => $capOn ? 'capacity' : 'lock', 'reason' => (string)($res['reason'] ?? 'slot_taken')]);
        // Keep error='slot_taken' for frontend compatibility; 'reason' adds detail
        // (full | closed) for capacity mode.
        hm_json(['ok' => false, 'data' => null, 'error' => 'slot_taken', 'reason' => (string)($res['reason'] ?? 'full')], 409);
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
    // Privacy: a NEW booking is unconfirmed, so the admin Inbox/Chat notification
    // must NOT expose the exact street address (banchi/building/floor/postal). Mask
    // the from:/to: lines to the SERVICE AREA (都道府県 + first 市/区/町/村) here —
    // this is the notification body only; the authoritative full address stays in
    // bookings.notes and is revealed in Booking Details once the booking is 確定.
    if (!empty($data['notes'])) $body .= "\n---\n" . hm_mask_notes_addresses((string)$data['notes']);
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

  // ── Customer "request received" EMAIL — the first lifecycle email ────────────
  //  Parity with confirmed/rescheduled/cancelled (booking-status.php / reschedule.php):
  //  a real email through the SAME EmailService/SMTP transport, telling the customer
  //  their request was received and is UNDER REVIEW (status = 新規, no slot reserved).
  //  Fire-and-forget (response already flushed) but ALWAYS logged — sent / failure
  //  code / SMTP transport — never a silent failure. Independent of LINE / inbox row.
  try {
    if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
      // Pull display bits out of the packed notes block (bookingService._packNotes):
      //   ref: / service: / time: / pref1: / pref2:  (all optional).
      $nx = function (string $k) use ($block, $notes) {
        foreach ([$block, $notes] as $hay) {
          if (preg_match('/^' . $k . ':\s*(.+)$/m', $hay, $m)) return trim($m[1]);
        }
        return '';
      };
      $ref      = $nx('ref') ?: (string)$data['id'];
      $service  = $nx('service');
      $bdateStr = (string)($data['booking_date'] ?? '未定');
      $timeBand = $nx('time');
      $pref1    = $nx('pref1');
      $pref2    = $nx('pref2');

      $lines = [
        '📩 ご予約リクエストを受け付けました',
        '',
        "{$name} 様",
        '',
        'この度はお問い合わせいただきありがとうございます。以下の内容でご予約リクエストを受け付けました。',
        '担当者が確認のうえ、確定のご連絡をお送りします（現時点ではまだ確定していません）。',
        '',
        "予約番号: {$ref}",
      ];
      if ($service !== '')  $lines[] = "サービス: {$service}";
      $lines[] = "ご希望日: {$bdateStr}" . ($timeBand !== '' ? "（{$timeBand}）" : '');
      if ($pref1 !== '')    $lines[] = "第1希望: {$pref1}";
      if ($pref2 !== '')    $lines[] = "第2希望: {$pref2}";
      $lines[] = '';
      $lines[] = '確定次第、あらためてメールでお知らせいたします。';
      $msg = implode("\n", $lines);

      $emailStatus = 'error';
      require_once __DIR__ . '/EmailService.php';
      if (class_exists('EmailService')) {
        $cfg  = hm_config();
        $acc  = EmailService::account($cfg, 'booking');
        $html = EmailService::customerHtml($acc, $msg, $ref);
        $er   = EmailService::deliver($cfg, ['account' => 'booking', 'to' => $email,
                  'subject' => "【予約リクエスト受付 {$ref}】" . $name . ' 様', 'html' => $html, 'text' => $msg]);
        if (!empty($er['ok'])) {
          $emailStatus = 'sent';
          hm_log_write('info.log', ['type' => 'new_booking_email', 'result' => 'sent',
            'booking' => $data['id'], 'to' => $email, 'transport' => (string)($er['transport'] ?? '')]);
        } else {
          $emailStatus = (string)($er['code'] ?? 'error');
          hm_log_error('new-booking email FAILED — customer not notified by email',
            ['booking' => $data['id'], 'to' => $email, 'code' => (string)($er['code'] ?? 'unknown'), 'error' => (string)($er['error'] ?? '')]);
        }
      } else {
        hm_log_error('new-booking email: EmailService.php unavailable', ['booking' => $data['id']]);
      }
    }
  } catch (Throwable $e) {
    hm_log_error('new-booking email exception', ['booking' => $data['id'], 'err' => $e->getMessage()]);
  }
  exit;
} catch (Throwable $e) {
  hm_log_error('create-booking failed', ['err' => $e->getMessage()]);
  hm_json(['ok' => false, 'data' => null, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
