<?php
// receive-email.php — inbound email webhook → inbox_messages
// Reached at <API_BASE>/receive-email.php (point your inbound provider here).
// Accepts a generic JSON payload; map your inbound provider's fields here.
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
hm_cors();

$p = hm_body();
$sender  = trim((string)($p['sender'] ?? $p['from'] ?? ''));
$email   = trim((string)($p['email'] ?? $p['from_email'] ?? ''));
$subject = (string)($p['subject'] ?? '');
$body    = (string)($p['body'] ?? $p['text'] ?? '');
$booking = trim((string)($p['booking_id'] ?? ''));

if ($email === '' || strpos($email, '@') === false) hm_json(['ok' => false, 'error' => 'invalid sender'], 400);

try {
  $st = hm_db()->prepare(
    'INSERT INTO inbox_messages (id, sender, email, subject, body, booking_id) VALUES (?,?,?,?,?,?)'
  );
  $st->execute([hm_uuid4(), $sender ?: $email, $email, $subject, $body, $booking ?: null]);
  hm_json(['ok' => true]);
} catch (Throwable $e) {
  hm_log_error('receive-email failed', ['err' => $e->getMessage()]);
  hm_json(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
