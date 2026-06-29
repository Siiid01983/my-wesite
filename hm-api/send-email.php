<?php
// ════════════════════════════════════════════════════════════════════════════
//  send-email.php — admin → customer email
//
//  Reached at:  <API_BASE>/send-email.php
//  Body (JSON): { communication_id?, from_account?, to, subject?, message, booking_id? }
//
//  Transport is config-driven (_config.php → 'mail_mode'):
//    'mail'  → PHP mail()              (default; out-of-the-box on cPanel)
//    'smtp'  → authenticated SMTP      (_smtp.php; native — no Composer needed,
//                                       uses PHPMailer instead only if vendor/ present)
//  When mail_mode='smtp' the request FAILS LOUDLY on any SMTP error — it never
//  silently degrades to mail() (that was the old, deliverability-killing bug).
//
//  Response envelope (additive / backward compatible):
//    success → { ok:true,  data:{from,messageId,transport}, error:null,
//                from, messageId, transport }            ← legacy top-level kept
//    failure → { ok:false, data:null,
//                error:"<string>",                       ← legacy string kept
//                error_detail:{ message, code } }        ← new structured detail
//
//  Self-test (admin-gated):  GET/POST  ?action=selftest[&send=1]
//    (a test send targets smtp_user only; a client-supplied `to` is ignored)
//
//  All connect / auth / send failures are logged via hm_log_error (_log.php).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_ratelimit.php';

// Guarded load of the SMTP client. It is intentionally NOT a hard `require` so a
// missing/half-deployed _smtp.php can never fatal the endpoint (which would take
// down ALL email, including mail() mode). When absent we degrade to a structured
// error in smtp mode and keep mail() mode fully working.
$HM_SMTP_READY = false;
if (is_file(__DIR__ . '/_smtp.php')) {
  require_once __DIR__ . '/_smtp.php';
  $HM_SMTP_READY = function_exists('hm_smtp_send') && function_exists('hm_smtp_selftest');
}

hm_cors();
hm_require_api_key();

$cfg = hm_config();

// ── Response helpers — additive envelope, legacy fields preserved ────────────
function email_ok(array $data): void {
  hm_json([
    'ok'        => true,
    'data'      => $data,
    'error'     => null,
    // legacy top-level mirrors — current frontend reads these directly
    'from'      => $data['from'] ?? null,
    'messageId' => $data['messageId'] ?? null,
    'transport' => $data['transport'] ?? null,
  ], 200);
}
function email_err(string $message, string $code, int $status = 502): void {
  hm_json([
    'ok'           => false,
    'data'         => null,
    'error'        => $message,                              // STRING (legacy consumers)
    'error_detail' => ['message' => $message, 'code' => $code], // structured (new consumers)
  ], $status);
}

// ── Self-test branch (diagnostics) ───────────────────────────────────────────
//  Verifies SMTP connection + authentication, and optionally sends a test email
//  to the authenticated mailbox ITSELF. Protected by the API key + a dedicated
//  rate limit, plus hm_require_admin when admin auth is enabled. The optional
//  test send always targets smtp_user — NEVER a client-supplied recipient — so
//  the diagnostic can't be used as an open relay even if the API key leaks
//  (a client-supplied `to` is ignored; this does not depend on admin auth).
if (($_GET['action'] ?? '') === 'selftest' || isset($_GET['selftest'])) {
  hm_require_admin();
  hm_rate_limit('email_selftest', 5, 60);

  if (!$HM_SMTP_READY) {
    hm_log_error('smtp selftest unavailable', ['reason' => '_smtp.php missing or invalid']);
    email_err('SMTP transport unavailable (_smtp.php missing on server)', 'smtp_unavailable', 500);
  }

  $body   = hm_body();
  $doSend = !empty($body['send']) || (($_GET['send'] ?? '') === '1');
  // Hardening: the test send goes to smtp_user only; any client-supplied `to`
  // is intentionally ignored so this endpoint can never relay to arbitrary
  // recipients.
  $sendTo = (string)($cfg['smtp_user'] ?? '');

  if (($cfg['mail_mode'] ?? 'mail') !== 'smtp') {
    hm_json([
      'ok'           => false,
      'data'         => ['mail_mode' => $cfg['mail_mode'] ?? 'mail'],
      'error'        => "Self-test only applies when mail_mode='smtp'",
      'error_detail' => ['message' => "mail_mode is not 'smtp'", 'code' => 'not_smtp'],
    ], 200);
  }

  $result = hm_smtp_selftest($cfg, $doSend ? $sendTo : null);
  if ($result['ok']) {
    hm_json(['ok' => true, 'data' => $result['data'], 'error' => null], 200);
  }
  $code = $result['code'] ?? 'smtp_error';
  $msg  = $result['error'] ?? 'self-test failed';
  hm_log_error('smtp selftest failed', [
    'code' => $code, 'err' => $msg, 'host' => (string)($cfg['smtp_host'] ?? ''),
  ]);
  hm_json([
    'ok'           => false,
    'data'         => $result['data'] ?? null,
    'error'        => $msg,                                   // STRING (req 7)
    'error_detail' => ['message' => $msg, 'code' => $code],   // structured (req 6/7)
  ], 200);
}

// ── Normal send path ─────────────────────────────────────────────────────────
hm_rate_limit('email', 20, 60);   // max 20 sends / IP / minute
$p = hm_body();

$to        = trim((string)($p['to'] ?? ''));
$message   = (string)($p['message'] ?? '');
$account   = (string)($p['from_account'] ?? 'booking');
$subject   = trim((string)($p['subject'] ?? '')) ?: '[Hello Moving] ご連絡';
$bookingId = trim((string)($p['booking_id'] ?? ''));

if ($to === '' || strpos($to, '@') === false) email_err('Invalid recipient', 'bad_recipient', 400);
if (trim($message) === '') email_err('Empty message body', 'empty_message', 400);

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

// ── SMTP transport ───────────────────────────────────────────────────────────
//  Prefer PHPMailer ONLY if it is actually installed in vendor/; otherwise use
//  the native client in _smtp.php. On ANY failure we log + return an error and
//  STOP — we never fall through to mail() in smtp mode.
if ($mode === 'smtp') {
  // Two interchangeable SMTP transports: PHPMailer if it is installed in vendor/,
  // otherwise the native client in _smtp.php. We fail loudly (and never fall
  // through to mail()) only when NEITHER is available — a host that ships
  // PHPMailer but no _smtp.php must still be able to send.
  $hasPhpmailer = is_file(__DIR__ . '/vendor/autoload.php');
  if (!$hasPhpmailer && !$HM_SMTP_READY) {
    hm_log_error('send-email smtp unavailable', ['reason' => 'no PHPMailer in vendor/ and _smtp.php missing', 'to' => $to, 'from_account' => $account]);
    email_err('SMTP transport unavailable (install PHPMailer in vendor/ or deploy _smtp.php)', 'smtp_unavailable', 500);
  }
  try {
    $res = $hasPhpmailer
      ? send_via_phpmailer($cfg, $acc, $to, $subject, $html, trim($message))
      : hm_smtp_send($cfg, $acc['email'], $acc['name'], $to, $subject, $html, trim($message));
    email_ok(['from' => $acc['email'], 'messageId' => $res['messageId'], 'transport' => $res['transport'] ?? 'smtp']);
  } catch (Throwable $e) {
    // The native client throws HM_SMTP_Exception (carries a structured ->smtpCode);
    // PHPMailer / anything else has none. instanceof is safe even when the class
    // is undefined (PHPMailer-only host without _smtp.php) — it just yields false.
    $typed    = $e instanceof HM_SMTP_Exception;
    $smtpCode = $typed ? $e->smtpCode : 'smtp_error';
    hm_log_error('send-email smtp failed', [
      'code' => $smtpCode, 'err' => $e->getMessage(),
      'host' => (string)($cfg['smtp_host'] ?? ''), 'to' => $to, 'from_account' => $account,
    ]);
    // A rejected/injected recipient is a client error (400); everything else is
    // an upstream/transport failure (502).
    $status = $smtpCode === 'invalid_recipient' ? 400 : 502;
    $public = $typed ? hm_smtp_public_msg($smtpCode) : 'Email send failed';
    email_err(hm_debug() ? $e->getMessage() : $public, $smtpCode, $status);
  }
}

// ── Default transport: PHP mail() ────────────────────────────────────────────
$headers  = 'MIME-Version: 1.0' . "\r\n";
$headers .= 'Content-Type: text/html; charset=UTF-8' . "\r\n";
$headers .= 'From: ' . mb_encode_mimeheader($acc['name'], 'UTF-8') . ' <' . $acc['email'] . '>' . "\r\n";
$headers .= 'Reply-To: ' . $acc['email'] . "\r\n";
$encSubject = mb_encode_mimeheader($subject, 'UTF-8');

$ok = @mail($to, $encSubject, $html, $headers, '-f' . $acc['email']);
if ($ok) email_ok(['from' => $acc['email'], 'messageId' => 'mail-' . time(), 'transport' => 'mail']);

hm_log_error('send-email mail() failed', ['to' => $to, 'from' => $acc['email'], 'from_account' => $account]);
email_err('mail() delivery failed (check cPanel mail / SPF / from address)', 'mail_send', 502);

// ── PHPMailer adapter (used only when hm-api/vendor/autoload.php exists) ──────
function send_via_phpmailer(array $cfg, array $acc, string $to, string $subject, string $html, string $text): array {
  require_once __DIR__ . '/vendor/autoload.php';
  $mail = new PHPMailer\PHPMailer\PHPMailer(true);
  try {
    $mail->isSMTP();
    $mail->CharSet    = 'UTF-8';
    $mail->Host       = (string)($cfg['smtp_host'] ?? '');
    $mail->Port       = (int)($cfg['smtp_port'] ?? 587);
    $mail->SMTPAuth   = true;
    $mail->Username   = (string)($cfg['smtp_user'] ?? '');
    $mail->Password   = (string)($cfg['smtp_pass'] ?? '');
    $mail->SMTPSecure = ((string)($cfg['smtp_secure'] ?? 'tls')) ?: 'tls';
    $mail->setFrom($acc['email'], $acc['name']);
    $mail->addAddress($to);
    $mail->addReplyTo($acc['email'], $acc['name']);
    $mail->isHTML(true);
    $mail->Subject = $subject;
    $mail->Body    = $html;
    $mail->AltBody = $text;
    $mail->send();
    return ['messageId' => $mail->getLastMessageID() ?: ('smtp-' . time()), 'transport' => 'smtp-phpmailer'];
  } catch (Throwable $e) {
    // Surface as a generic transport failure for the caller to log + map. We
    // deliberately avoid HM_SMTP_Exception here so the PHPMailer path has NO
    // dependency on _smtp.php being present on the server.
    throw new RuntimeException('PHPMailer send failed: ' . $e->getMessage(), 0, $e);
  }
}
