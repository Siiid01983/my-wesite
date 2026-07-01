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
//  NOTE: no frontend is wired to this yet — the public contact links in the
//  locked index.html are still mailto:. Wiring a real form to this endpoint is a
//  separate, sign-off-gated step.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
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

if (!$HM_EMAIL_READY) {
  hm_log_error('contact unavailable', ['reason' => 'EmailService.php missing or invalid']);
  hm_err('メール送信サービスを利用できません', 500, 'smtp_unavailable');
}

$acc  = EmailService::account($cfg, 'contact');
$rows = ['お名前' => $name, 'メール' => $email];
if ($phone !== '') $rows['電話番号'] = $phone;
$rows['件名'] = $subject;
$html = EmailService::notifyHtml('新しいお問い合わせ', $rows, $message);
$text = "新しいお問い合わせ\n\nお名前: {$name}\nメール: {$email}\n"
      . ($phone !== '' ? "電話番号: {$phone}\n" : '')
      . "件名: {$subject}\n\n{$message}";

$res = EmailService::deliver($cfg, [
  'account' => 'contact',
  'to'      => $acc['admin'],                 // contact@ (admin recipient)
  'subject' => '[お問い合わせ] ' . $subject,
  'html'    => $html,
  'text'    => $text,
  'replyTo' => $email,                        // reply straight to the submitter
]);

if ($res['ok']) {
  hm_ok(['from' => $res['from'], 'messageId' => $res['messageId'], 'transport' => $res['transport']]);
}

hm_log_error('contact send failed', [
  'code' => $res['code'], 'err' => $res['error_raw'] ?? $res['error'], 'to' => $acc['admin'],
]);
hm_err(hm_debug() ? ($res['error_raw'] ?? $res['error']) : $res['error'], $res['status'] ?? 502, $res['code']);
