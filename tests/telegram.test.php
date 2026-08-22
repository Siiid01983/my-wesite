<?php
// ════════════════════════════════════════════════════════════════════════════
//  tests/telegram.test.php — unit test for hm-api/_telegram.php.
//
//  Deterministic + offline: exercises ONLY the code paths that return BEFORE any
//  network call (disabled / missing token / missing chat id / empty message), so
//  it never contacts api.telegram.org and never needs a DB. Verifies:
//    1. disabled  → Contact Chat notification is a no-op (returns false, no throw)
//    2. gating    → missing token / chat id / message all return false
//    3. no-throw  → the helper never throws in any gating path
//    4. no-leak   → the bot token is never written to logs, and the source never
//                   logs $token or the send $url (which embeds the token)
//    5. contract  → uses the official Bot API sendMessage endpoint + a timeout
//    6. wiring    → contact-chat.php notifies via Telegram, not LINE
//
//  Run: php tests/telegram.test.php
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

$pass = 0; $fail = 0;
function t(string $name, bool $cond): void {
  global $pass, $fail;
  if ($cond) { $pass++; echo "  ok    $name\n"; }
  else       { $fail++; echo "  NOT OK  $name\n"; }
}

// ── Stubs (must exist before including _telegram.php) ─────────────────────────
$GLOBALS['__cfg']  = [];
$GLOBALS['__logs'] = [];
if (!function_exists('hm_config'))    { function hm_config(): array { return $GLOBALS['__cfg']; } }
if (!function_exists('hm_log_error')) { function hm_log_error(string $m, array $c = []): void { $GLOBALS['__logs'][] = ['m' => $m, 'c' => $c]; } }

require __DIR__ . '/../hm-api/_telegram.php';

$SECRET = '123456:FAKE-BOT-TOKEN-should-never-be-logged';

// 1. Disabled → no-op (Contact Chat still works because this is fire-and-forget)
$GLOBALS['__cfg'] = ['telegram_enabled' => false, 'telegram_bot_token' => $SECRET, 'telegram_chat_id' => '111'];
t('disabled → hm_telegram_send returns false (no send)', hm_telegram_send('hi') === false);
t('disabled → hm_telegram_enabled() is false',           hm_telegram_enabled() === false);

// 2. Enabled but missing token → false (no network)
$GLOBALS['__cfg'] = ['telegram_enabled' => true, 'telegram_bot_token' => '', 'telegram_chat_id' => '111'];
t('missing token → false',            hm_telegram_send('hi') === false);
t('missing token → enabled() false',  hm_telegram_enabled() === false);

// 3. Enabled but missing chat id → false (no network)
$GLOBALS['__cfg'] = ['telegram_enabled' => true, 'telegram_bot_token' => $SECRET, 'telegram_chat_id' => ''];
t('missing chat_id → false',           hm_telegram_send('hi') === false);
t('missing chat_id → enabled() false', hm_telegram_enabled() === false);

// 4. Fully configured but EMPTY message → false BEFORE any network call
$GLOBALS['__cfg'] = ['telegram_enabled' => true, 'telegram_bot_token' => $SECRET, 'telegram_chat_id' => '111'];
t('empty message → false (no network)', hm_telegram_send('') === false);
t('fully configured → enabled() true',  hm_telegram_enabled() === true);

// 5. Never throws in any gating path (reached here without a fatal)
t('no exception thrown across gating paths', true);

// 6. Token never leaked: nothing was logged in these no-network paths, and in no
//    case does any captured log entry contain the token string.
$leaked = false;
foreach ($GLOBALS['__logs'] as $l) {
  if (strpos(json_encode($l, JSON_UNESCAPED_UNICODE), $SECRET) !== false) $leaked = true;
}
t('bot token never appears in logs', $leaked === false);
t('no logs emitted in gating paths (nothing to leak)', count($GLOBALS['__logs']) === 0);

// ── Source-contract checks (static; no execution) ────────────────────────────
$tg  = file_get_contents(__DIR__ . '/../hm-api/_telegram.php');
t('uses the official Bot API sendMessage endpoint',
  strpos($tg, "https://api.telegram.org/bot' . \$token . '/sendMessage") !== false);
t('sets a network timeout',
  strpos($tg, 'CURLOPT_TIMEOUT') !== false && strpos($tg, "'timeout'") !== false);
t('sends PLAIN TEXT (no parse_mode parameter → no formatting injection)',
  !preg_match("/'parse_mode'\s*=>/", $tg));
t('never logs $token',
  !preg_match('/hm_log_error\([^;]*\$token/', $tg));
t('never logs the send $url (which embeds the token)',
  !preg_match('/hm_log_error\([^;]*\$url/', $tg));

$cc = file_get_contents(__DIR__ . '/../hm-api/contact-chat.php');
t('contact-chat.php notifies via Telegram (hm_telegram_send)',
  strpos($cc, 'hm_telegram_send(') !== false);
t('contact-chat.php no longer calls LINE (hm_line_push removed)',
  strpos($cc, 'hm_line_push') === false);
t('contact-chat.php requires _telegram.php',
  strpos($cc, "require_once __DIR__ . '/_telegram.php'") !== false);

// Standardized on Telegram: new-booking + contact-form alerts migrated too.
$cb = file_get_contents(__DIR__ . '/../hm-api/create-booking.php');
t('create-booking.php notifies via Telegram (hm_telegram_send + hm_telegram_enabled)',
  strpos($cb, 'hm_telegram_send(') !== false && strpos($cb, 'hm_telegram_enabled(') !== false);
t('create-booking.php no longer calls LINE',
  strpos($cb, 'hm_line_push') === false && strpos($cb, 'hm_line_enabled') === false);

$cf = file_get_contents(__DIR__ . '/../hm-api/contact.php');
t('contact.php notifies via Telegram (hm_telegram_send)',
  strpos($cf, 'hm_telegram_send(') !== false);
t('contact.php no longer calls LINE',
  strpos($cf, 'hm_line_push') === false);

$ch = file_get_contents(__DIR__ . '/../hm-api/chat.php');
t('chat.php notifies via Telegram (hm_telegram_send)',
  strpos($ch, 'hm_telegram_send(') !== false);
t('chat.php no longer calls LINE',
  strpos($ch, 'hm_line_push') === false);

$ip = file_get_contents(__DIR__ . '/../hm-api/inbox-poll.php');
t('inbox-poll.php notifies via Telegram (hm_telegram_send + hm_telegram_enabled)',
  strpos($ip, 'hm_telegram_send(') !== false && strpos($ip, 'hm_telegram_enabled(') !== false);
t('inbox-poll.php no longer calls LINE',
  strpos($ip, 'hm_line_push') === false && strpos($ip, 'hm_line_enabled') === false);

echo "\n$pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
