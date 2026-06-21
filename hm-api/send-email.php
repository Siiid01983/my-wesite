<?php
// ════════════════════════════════════════════════════════════════════════════
//  send-email.php — admin → customer email
//
//  Reached at:  <API_BASE>/send-email.php
//  Body (JSON): { communication_id?, from_account?, to, subject?, message, booking_id? }
//  Returns:     { ok, from, messageId } | { ok:false, error }
//
//  Delivery: PHP mail() (default) or SMTP via PHPMailer if present in vendor/.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_ratelimit.php';
hm_cors();
hm_require_api_key();
hm_rate_limit('email', 20, 60);   // max 20 sends / IP / minute

$cfg = hm_config();
$p   = hm_body();

$to       = trim((string)($p['to'] ?? ''));
$message  = (string)($p['message'] ?? '');
$account  = (string)($p['from_account'] ?? 'booking');
$subject  = trim((string)($p['subject'] ?? '')) ?: '[Hello Moving] ご連絡';
$bookingId= trim((string)($p['booking_id'] ?? ''));

if ($to === '' || strpos($to, '@') === false) hm_json(['ok' => false, 'error' => 'Invalid recipient'], 400);
if (trim($message) === '') hm_json(['ok' => false, 'error' => 'Empty message body'], 400);

$ACCOUNTS = [
  'booking' => ['email' => $cfg['mail_from_booking'] ?? 'booking@hello-moving.com', 'name' => 'Hello Moving 予約センター'],
  'support' => ['email' => $cfg['mail_from_support'] ?? 'support@hello-moving.com', 'name' => 'Hello Moving アフターサービス'],
  'contact' => ['email' => $cfg['mail_from_contact'] ?? 'contact@hello-moving.com', 'name' => 'Hello Moving カスタマーサポート'],
];
$acc = $ACCOUNTS[$account] ?? $ACCOUNTS['booking'];

function esc_html($s): string {
  return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}
$msgHtml = nl2br(esc_html(trim($message)));
$bookingRow = $bookingId ? '<tr><td style="padding:10px 16px;border-top:1px solid #e8e8e4;font-size:12px;font-weight:600;color:#666;width:130px">受付番号</td><td style="padding:10px 16px;border-top:1px solid #e8e8e4;font-size:13px;font-weight:700;color:#1d4ed8">' . esc_html($bookingId) . '</td></tr>' : '';

$html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head>'
  . '<body style="margin:0;padding:0;background:#f2f2ef;font-family:sans-serif">'
  . '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2ef;padding:32px 0"><tr><td align="center">'
  . '<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;width:100%">'
  . '<tr><td style="background:#0a1f44;padding:28px 36px"><p style="margin:0;font-size:22px;font-weight:700;color:#fff">Hello Moving</p>'
  . '<p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,.55)">TOKYO MOVING SERVICE</p></td></tr>'
  . '<tr><td style="padding:36px"><p style="margin:0 0 20px;font-size:14px;line-height:1.9;color:#0b0f17">' . $msgHtml . '</p>'
  . ($bookingId ? '<table width="100%" style="border:1px solid #e8e8e4;border-radius:8px;margin-bottom:20px">' . $bookingRow . '</table>' : '')
  . '</td></tr>'
  . '<tr><td style="background:#f7f7f4;padding:18px 36px;border-top:1px solid #e8e8e4"><p style="margin:0;font-size:11px;color:#aaa">'
  . 'このメールは Hello Moving より送信されています。<br>返信先: ' . esc_html($acc['email']) . '</p></td></tr>'
  . '</table></td></tr></table></body></html>';

$mode = $cfg['mail_mode'] ?? 'mail';

// ── SMTP via PHPMailer (only if you dropped it into hm-api/vendor/) ──────────
if ($mode === 'smtp' && is_file(__DIR__ . '/vendor/autoload.php')) {
  require_once __DIR__ . '/vendor/autoload.php';
  try {
    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    $mail->isSMTP();
    $mail->CharSet  = 'UTF-8';
    $mail->Host     = $cfg['smtp_host'];
    $mail->Port     = (int)$cfg['smtp_port'];
    $mail->SMTPAuth = true;
    $mail->Username = $cfg['smtp_user'];
    $mail->Password = $cfg['smtp_pass'];
    $mail->SMTPSecure = $cfg['smtp_secure'] ?: 'tls';
    $mail->setFrom($acc['email'], $acc['name']);
    $mail->addAddress($to);
    $mail->addReplyTo($acc['email'], $acc['name']);
    $mail->isHTML(true);
    $mail->Subject = $subject;
    $mail->Body    = $html;
    $mail->AltBody = trim($message);
    $mail->send();
    hm_json(['ok' => true, 'from' => $acc['email'], 'messageId' => $mail->getLastMessageID() ?: ('smtp-' . time())]);
  } catch (Throwable $e) {
    hm_log_error('send-email failed', ['err' => $e->getMessage()]);
    hm_json(['ok' => false, 'error' => hm_safe_msg('Email send failed', $e)], 502);
  }
}

// ── Default: PHP mail() ──────────────────────────────────────────────────────
$headers  = 'MIME-Version: 1.0' . "\r\n";
$headers .= 'Content-Type: text/html; charset=UTF-8' . "\r\n";
$headers .= 'From: ' . mb_encode_mimeheader($acc['name'], 'UTF-8') . ' <' . $acc['email'] . '>' . "\r\n";
$headers .= 'Reply-To: ' . $acc['email'] . "\r\n";
$encSubject = mb_encode_mimeheader($subject, 'UTF-8');

$ok = @mail($to, $encSubject, $html, $headers, '-f' . $acc['email']);
if ($ok) hm_json(['ok' => true, 'from' => $acc['email'], 'messageId' => 'mail-' . time()]);
hm_json(['ok' => false, 'error' => 'mail() delivery failed (check cPanel mail / SPF / from address)'], 502);
