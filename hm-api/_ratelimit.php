<?php
// ════════════════════════════════════════════════════════════════════════════
//  _ratelimit.php — IP-based sliding-window rate limiting + abuse blocking
//
//  Per-IP state lives in one small JSON file under rate_limit_dir (default
//  hm-api/_cache/rl). A request that exceeds <max> hits within <window> seconds
//  earns a "strike"; once strikes reach block_threshold the IP is blocked for
//  block_minutes. The request fingerprint (IP + User-Agent) is recorded so
//  repeat offenders can be correlated in error.log.
//
//  Fail-OPEN: any filesystem error skips limiting rather than blocking real
//  traffic. Disable entirely with 'rate_limit_enabled' => false in _config.php.
//
//  Usage (after hm_cors()):  hm_rate_limit('auth', 10, 60);
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_log.php';

function hm_rl_config(): array {
  $c = function_exists('hm_config') ? hm_config() : [];
  return [
    'enabled'         => ($c['rate_limit_enabled'] ?? true) !== false,
    'max'             => (int)($c['rate_limit_max'] ?? 120),            // hits per window
    'window'          => (int)($c['rate_limit_window'] ?? 60),          // seconds
    'block_threshold' => (int)($c['rate_limit_block_threshold'] ?? 3),  // strikes before block
    'block_minutes'   => (int)($c['rate_limit_block_minutes'] ?? 15),
    'dir'             => (string)($c['rate_limit_dir'] ?? (__DIR__ . '/_cache/rl')),
  ];
}

// Enforce a limit for the current IP within $bucket. $max/$window override config.
// Emits a 429 (and exits) when the limit is hit or the IP is in a block window.
function hm_rate_limit(string $bucket = 'global', ?int $max = null, ?int $window = null): void {
  $cfg = hm_rl_config();
  if (!$cfg['enabled']) return;
  $max    = $max    ?? $cfg['max'];
  $window = $window ?? $cfg['window'];
  if ($max <= 0 || $window <= 0) return;

  $dir = $cfg['dir'];
  if (!is_dir($dir)) @mkdir($dir, 0775, true);
  $ip   = hm_client_ip();
  $file = $dir . '/' . preg_replace('/[^A-Za-z0-9._-]/', '_', $bucket . '_' . $ip) . '.json';

  $fh = @fopen($file, 'c+');
  if ($fh === false) return;                 // fail-open on FS error
  @flock($fh, LOCK_EX);

  $now   = time();
  $state = ['hits' => [], 'strikes' => 0, 'blocked_until' => 0, 'fp' => hm_client_fingerprint()];
  $raw   = stream_get_contents($fh);
  if ($raw) { $j = json_decode($raw, true); if (is_array($j)) $state = array_merge($state, $j); }

  // Already serving a block window → reject without recording new hits.
  if ((int)($state['blocked_until'] ?? 0) > $now) {
    @flock($fh, LOCK_UN); @fclose($fh);
    hm_log_write('error.log', ['type' => 'rate_block', 'bucket' => $bucket,
      'fp' => (string)($state['fp'] ?? ''), 'until' => date('c', (int)$state['blocked_until'])]);
    header('Retry-After: ' . max(1, (int)$state['blocked_until'] - $now));
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'Too many requests', 'code' => 'rate_limited']], 429);
  }

  // Prune to the sliding window, then record this hit.
  $hits = array_values(array_filter((array)($state['hits'] ?? []), fn($t) => ($now - (int)$t) < $window));
  $hits[] = $now;
  $state['hits'] = $hits;
  $state['fp']   = hm_client_fingerprint();

  if (count($hits) > $max) {
    $state['strikes'] = (int)($state['strikes'] ?? 0) + 1;
    if ($state['strikes'] >= $cfg['block_threshold']) {
      $state['blocked_until'] = $now + $cfg['block_minutes'] * 60;
    }
    rewind($fh); ftruncate($fh, 0); fwrite($fh, json_encode($state)); @flock($fh, LOCK_UN); @fclose($fh);
    hm_log_write('error.log', ['type' => 'rate_limited', 'bucket' => $bucket,
      'fp' => $state['fp'], 'hits' => count($hits), 'strikes' => $state['strikes'],
      'blocked' => (int)$state['blocked_until'] > $now]);
    $retry = (int)$state['blocked_until'] > $now ? ((int)$state['blocked_until'] - $now) : $window;
    header('Retry-After: ' . max(1, $retry));
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'Too many requests', 'code' => 'rate_limited']], 429);
  }

  rewind($fh); ftruncate($fh, 0); fwrite($fh, json_encode($state)); @flock($fh, LOCK_UN); @fclose($fh);
}
