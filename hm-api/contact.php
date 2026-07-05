<?php
// ════════════════════════════════════════════════════════════════════════════
//  contact.php — server-side contact-form intake → contact@hello-moving.com
//
//  Reached at:  <API_BASE>/contact.php
//  Body (JSON): { name, email, message, subject? }
//
//  Routes through the centralized EmailService with account='contact':
//    From        = contact@hello-moving.com   (Hello Moving カスタマーサポート)
//    To          = contact@hello-moving.com   (admin recipient)
//    Reply-To    = the submitter's email      (staff reply goes to the customer)
//    Return-Path = contact@ (envelope) ; Sender: added if AUTH mailbox differs.
//
//  Response envelope: standard { ok, data, error } (hm_ok / hm_err).
//
//  Frontend: the index.html「メールでお問い合わせ」form (js/contact-form.js).
//
//  Intake is DUAL, with the WMC Inbox row as the authoritative copy:
//    1. inbox_messages row (mailbox = contact@) → appears instantly in the
//       admin Inbox on the contact@ channel; staff reply from the card.
//    2. Notification email to contact@ (best-effort; submission still succeeds
//       if SMTP is down as long as the Inbox row was written).
//  The row reuses the email's Message-ID, so when inbox-poll.php later imports
//  contact@'s INBOX the self-sent copy is skipped as a duplicate.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_cache.php';
require_once __DIR__ . '/_ratelimit.php';

// Guarded load so a missing EmailService.php degrades to a structured error
// instead of a fatal.
$HM_EMAIL_READY = false;
if (is_file(__DIR__ . '/EmailService.php')) {
  require_once __DIR__ . '/EmailService.php';
  $HM_EMAIL_READY = class_exists('EmailService');
}

hm_cors();
hm_require_api_key();

$cfg = hm_config();
hm_rate_limit('contact', 5, 60);   // max 5 contact submissions / IP / minute

$p       = hm_body();
$name    = trim((string)($p['name'] ?? ''));
$email   = trim((string)($p['email'] ?? ''));
$phone   = trim((string)($p['phone'] ?? ''));   // optional
$message = trim((string)($p['message'] ?? ''));
$subject = trim((string)($p['subject'] ?? '')) ?: 'お問い合わせ';

if ($name === '') hm_err('お名前を入力してください', 400, 'missing_name');
if ($email === '' || strpbrk($email, "\r\n") !== false || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
  hm_err('メールアドレスが正しくありません', 400, 'bad_email');
}
if ($message === '') hm_err('メッセージを入力してください', 400, 'empty_message');

$text = "新しいお問い合わせ（ウェブフォーム）\n\nお名前: {$name}\nメール: {$email}\n"
      . ($phone !== '' ? "電話番号: {$phone}\n" : '')
      . "件名: {$subject}\n\n{$message}";

// ── 1. Notification email to contact@ (best-effort) ─────────────────────────
$res = null;
if ($HM_EMAIL_READY) {
  $acc  = EmailService::account($cfg, 'contact');
  $rows = ['お名前' => $name, 'メール' => $email];
  if ($phone !== '') $rows['電話番号'] = $phone;
  $rows['件名'] = $subject;
  $html = EmailService::notifyHtml('新しいお問い合わせ', $rows, $message);

  $res = EmailService::deliver($cfg, [
    'account' => 'contact',
    'to'      => $acc['admin'],                 // contact@ (admin recipient)
    'subject' => '[お問い合わせ] ' . $subject,
    'html'    => $html,
    'text'    => $text,
    'replyTo' => $email,                        // reply straight to the submitter
  ]);
  if (!$res['ok']) {
    hm_log_error('contact send failed', [
      'code' => $res['code'], 'err' => $res['error_raw'] ?? $res['error'], 'to' => $acc['admin'],
    ]);
  }
} else {
  hm_log_error('contact email unavailable', ['reason' => 'EmailService.php missing or invalid']);
}
$emailed = (bool)($res['ok'] ?? false);

// ── 2. WMC Inbox row (authoritative intake) ──────────────────────────────────
// Shares the email's Message-ID so inbox-poll.php skips the self-sent copy in
// contact@'s INBOX (dedup is by message_id). If the email failed, a synthetic
// Message-ID keeps the row insertable and threadable.
$mid = ($emailed && !empty($res['messageId']))
     ? (string)$res['messageId']
     : '<contact-' . hm_uuid4() . '@hello-moving.com>';
$inboxOk = false;
try {
  $st = hm_db()->prepare(
    'INSERT INTO inbox_messages
       (id, sender, sender_name, email, subject, body, body_text,
        mailbox, message_id, thread_id, received_at, is_read, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),0,\'open\')'
  );
  $st->execute([
    hm_uuid4(),
    $name,
    $name,
    $email,
    '[お問い合わせ] ' . $subject,
    $text,
    $text,
    'contact@hello-moving.com',   // recipient channel → contact@ tab, reply From
    $mid,
    $mid,                         // new thread rooted at this message
  ]);
  hm_cache_invalidate_table('inbox_messages');
  $inboxOk = true;
} catch (Throwable $e) {
  hm_log_error('contact inbox row failed', ['err' => $e->getMessage()]);
}

// Success if the message reached EITHER channel; error only when both failed.
if ($inboxOk || $emailed) {
  hm_ok(['inbox' => $inboxOk, 'emailed' => $emailed, 'messageId' => $mid]);
}
if ($res) {
  hm_err(hm_debug() ? ($res['error_raw'] ?? $res['error']) : $res['error'], $res['status'] ?? 502, $res['code']);
}
hm_err('お問い合わせを送信できませんでした。時間をおいて再度お試しください', 500, 'contact_failed');
