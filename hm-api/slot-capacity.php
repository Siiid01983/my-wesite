<?php
// ════════════════════════════════════════════════════════════════════════════
//  slot-capacity.php — Admin capacity management (Morning/Afternoon/Evening/Night)
//
//  Configure per-band capacity instead of hard-blocking dates. Backed by
//  _capacity.php + the slot_capacity table. A booking only fails when a band is
//  closed or its capacity is exhausted.
//
//  ── Auth (dual gate — identical to block-interval.php) ──────────────────────
//    1. Admin session token (X-ADMIN-TOKEN), verified inline.
//    2. Fallback: admin_setup_token in _config.php as ?token=.  CLI always trusted.
//
//  ── Actions (JSON body / GET / POST) ────────────────────────────────────────
//    get    { date }                     → per-band status for the date + defaults
//    set    { date, band, capacity }     → set capacity (date='*' sets the default)
//    close  { date, band }               → close the slot
//    reopen { date, band }               → reopen the slot
//        (increase/decrease = set with the new capacity; the UI does +/-.)
//
//  ── Response ────────────────────────────────────────────────────────────────
//    { ok:true, date, bands:{am:{status,capacity,used,remaining,closed}, …},
//      defaults:{am:{capacity,closed}, …} }
//    { ok:false, error:"…" }  (+ HTTP 4xx/5xx)
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_capacity.php';

$isCli = (PHP_SAPI === 'cli');

function sc_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    fwrite(STDOUT, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit;
  }
  hm_json($payload, $status);
}

$body = [];
if (!$isCli) {
  $raw = file_get_contents('php://input');
  if ($raw !== '' && $raw !== false) {
    $j = json_decode($raw, true);
    if (is_array($j)) $body = $j;
  }
}
$param = function (string $k) use ($body) {
  if (isset($_GET[$k]))            return $_GET[$k];
  if (isset($_POST[$k]))           return $_POST[$k];
  if (array_key_exists($k, $body)) return $body[$k];
  return null;
};

if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_cors();
  hm_require_api_key();
  hm_rate_limit('slot_capacity', 40, 60);
}

// ── Dual auth gate ───────────────────────────────────────────────────────────
if (!$isCli) {
  $authed = false;
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (is_string($tok) && $tok !== '') {
    $pl = hm_admin_token_verify($tok);
    if ($pl !== null && ($pl['role'] ?? '') === 'admin' && hm_admin_token_account_valid($pl)) $authed = true;
  }
  if (!$authed) {
    $setup = (string)(hm_config()['admin_setup_token'] ?? '');
    $sent  = (string)($param('token') ?? '');
    if ($setup !== '' && hash_equals($setup, $sent)) $authed = true;
  }
  if (!$authed) {
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('slot_capacity');
    sc_out(['ok' => false, 'error' => 'forbidden — admin session (X-ADMIN-TOKEN) or ?token= required'], false, 403);
  }
}

$action = strtolower(trim((string)($param('action') ?? 'get')));
if (!in_array($action, ['get', 'set', 'close', 'reopen'], true)) {
  sc_out(['ok' => false, 'error' => "invalid action — use 'get', 'set', 'close', or 'reopen'"], $isCli, 400);
}

// Date: '*' (defaults) or strict YYYY-MM-DD.
$date = trim((string)($param('date') ?? ''));
if ($date === '') $date = HM_CAP_DEFAULT;
if ($date !== HM_CAP_DEFAULT) {
  $p = DateTime::createFromFormat('!Y-m-d', $date);
  $e = DateTime::getLastErrors();
  $ok = $p instanceof DateTime && $p->format('Y-m-d') === $date && (($e['warning_count'] ?? 0) === 0) && (($e['error_count'] ?? 0) === 0);
  if (!$ok) sc_out(['ok' => false, 'error' => "invalid date — expected YYYY-MM-DD or '*'"], $isCli, 400);
}

// ── Helper: build the response snapshot for a date (per-band status + defaults) ─
$snapshot = function (PDO $db, string $date): array {
  $defaults = [];
  foreach (HM_CAP_BANDS as $b) {
    $eff = hm_cap_effective($db, HM_CAP_DEFAULT, $b);
    $defaults[$b] = ['capacity' => $eff['capacity'], 'closed' => $eff['closed']];
  }
  $bands = ($date === HM_CAP_DEFAULT) ? null : hm_cap_day($db, $date);
  $out = ['ok' => true, 'date' => $date, 'defaults' => $defaults];
  if ($bands !== null) $out['bands'] = $bands;
  return $out;
};

try {
  $db = hm_db();
  hm_cap_ensure_table($db);
  hm_slot_ensure_table($db);

  if ($action === 'get') {
    sc_out($snapshot($db, $date), $isCli);
  }

  // set / close / reopen all need a band.
  $band = strtolower(trim((string)($param('band') ?? '')));
  if (!in_array($band, HM_CAP_BANDS, true)) {
    $norm = hm_slot_band_id($band);   // accept a JP label / time too
    if ($norm !== null && in_array($norm, HM_CAP_BANDS, true)) $band = $norm;
    else sc_out(['ok' => false, 'error' => 'invalid band — use am|pm|ev|nt'], $isCli, 400);
  }

  if ($action === 'set') {
    $capRaw = $param('capacity');
    if ($capRaw === null || !is_numeric($capRaw) || (int)$capRaw < 0) {
      sc_out(['ok' => false, 'error' => 'capacity required (integer >= 0)'], $isCli, 400);
    }
    hm_cap_set($db, $date, $band, (int)$capRaw, null);
  } elseif ($action === 'close') {
    hm_cap_set($db, $date, $band, null, true);
  } elseif ($action === 'reopen') {
    hm_cap_set($db, $date, $band, null, false);
  }

  $res = $snapshot($db, $date);
  $res['action'] = $action;
  $res['band'] = $band;
  sc_out($res, $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('slot-capacity failed', ['err' => $e->getMessage(), 'action' => $action ?? '', 'date' => $date ?? '']);
  sc_out(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], $isCli, 500);
}
