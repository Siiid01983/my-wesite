<?php
// ════════════════════════════════════════════════════════════════════════════
//  slot-preflight.php — Smart Booking Engine safe-test preflight (token-gated)
//
//  Purpose: let the controlled-validation driver VERIFY that slot locking is
//  actually ACTIVE at runtime BEFORE it writes any test booking — so a stale
//  OPcache / un-refreshed config can never again cause a "silent no-lock" run
//  that pollutes production.
//
//  Does only two things: (1) optionally opcache_reset() (?reset=1), and
//  (2) report runtime facts. NO writes to any business table.
//
//    GET /hm-api/slot-preflight.php?token=<admin_setup_token>[&reset=1]
//    → { ok, opcache_available, opcache_reset, slot_lock_enabled,
//        reserve_fn, code_build, booking_slots_table }
//
//  IMPORTANT: opcache_reset() clears the compiled-bytecode cache for the NEXT
//  requests; the CURRENT request already ran on the old cache. So the driver
//  should call ?reset=1 first, then call again (no reset) to read the now-fresh
//  slot_lock_enabled / code_build values.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_slots.php';

$isCli = (PHP_SAPI === 'cli');
if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_rate_limit('slot_preflight', 10, 60);
  $setup = (string)(hm_config()['admin_setup_token'] ?? '');
  $sent  = (string)($_GET['token'] ?? '');
  if ($setup === '' || !hash_equals($setup, $sent)) {
    hm_json(['ok' => false, 'error' => 'forbidden — set admin_setup_token in _config.php and pass ?token='], 403);
  }
}

$didReset = false;
$wantReset = $isCli ? in_array('reset', array_slice($argv, 1), true) : !empty($_GET['reset']);
if ($wantReset && function_exists('opcache_reset')) {
  $didReset = (bool)@opcache_reset();
}

$hasTable = false;
try {
  $hasTable = (bool)hm_db()->query("SHOW TABLES LIKE 'booking_slots'")->fetch();
} catch (Throwable $e) { /* report false; never leak SQL */ }

hm_json([
  'ok'                  => true,
  'opcache_available'   => function_exists('opcache_get_status'),
  'opcache_reset'       => $didReset,
  'slot_lock_enabled'   => hm_slot_lock_enabled(),          // the decisive flag, as this process sees it
  'reserve_fn'          => function_exists('hm_slot_reserve'),
  'code_build'          => defined('HM_SLOTS_BUILD') ? HM_SLOTS_BUILD : null,
  'booking_slots_table' => $hasTable,
  'note'                => 'Call ?reset=1 first, then call again to read post-reset values.',
]);
