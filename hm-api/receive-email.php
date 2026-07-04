<?php
// receive-email.php — inbound email webhook → inbox_messages
// Reached at <API_BASE>/receive-email.php (point your inbound provider here).
// Accepts a generic JSON payload; map your inbound provider's fields here.
//
// Recipient classification (Inbox channel filter): the destination mailbox is
// read from `mailbox` / `recipient_email` / `recipient` / `to` and stored in
// inbox_messages.mailbox. Only the three company channels are accepted;
// anything else (or a missing recipient) defaults to contact@hello-moving.com —
// the same default inbox-migrate.php backfills onto legacy rows, so the admin
// Inbox channel tabs always have a bucket for every message.
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
hm_cors();

$p = hm_body();
$sender  = trim((string)($p['sender'] ?? $p['from'] ?? ''));
$email   = trim((string)($p['email'] ?? $p['from_email'] ?? ''));
$subject = (string)($p['subject'] ?? '');
$body    = (string)($p['body'] ?? $p['text'] ?? '');
$booking = trim((string)($p['booking_id'] ?? ''));

// Destination mailbox → channel (allowlisted; default contact@).
$HM_CHANNELS = ['booking@hello-moving.com', 'support@hello-moving.com', 'contact@hello-moving.com'];
$mailboxRaw  = strtolower(trim((string)($p['mailbox'] ?? $p['recipient_email'] ?? $p['recipient'] ?? $p['to'] ?? '')));
$mailbox     = in_array($mailboxRaw, $HM_CHANNELS, true) ? $mailboxRaw : 'contact@hello-moving.com';

if ($email === '' || strpos($email, '@') === false) hm_json(['ok' => false, 'error' => 'invalid sender'], 400);

try {
  $st = hm_db()->prepare(
    'INSERT INTO inbox_messages (id, sender, email, subject, body, booking_id, mailbox) VALUES (?,?,?,?,?,?,?)'
  );
  $st->execute([hm_uuid4(), $sender ?: $email, $email, $subject, $body, $booking ?: null, $mailbox]);
  hm_json(['ok' => true, 'mailbox' => $mailbox]);
} catch (Throwable $e) {
  hm_log_error('receive-email failed', ['err' => $e->getMessage()]);
  hm_json(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
