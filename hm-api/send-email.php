<?php
// ════════════════════════════════════════════════════════════════════════════
//  send-email.php — admin → customer email
//
//  Reached at:  <API_BASE>/send-email.php
//  Body (JSON): { communication_id?, from_account?, to, subject?, message, booking_id?,
//                 log_comm? }
//    log_comm (bool, default false): when true, a successful send is recorded in the
//    `communications` table. Callers that ALREADY log there (communications.js) MUST
//    omit it to avoid duplicate rows; admin-notification / gateway callers set it true.
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

// Guarded load of the centralized mailer. It is intentionally NOT a hard `require`
// so a missing/half-deployed EmailService.php (or _smtp.php it pulls in) can never
// fatal the endpoint (which would take down ALL email, including mail() mode).
// When absent we degrade to a structured error and keep mail() mode working.
// (EmailService.php itself require_once's _smtp.php, so the self-test helpers below
// are available whenever the class is.)
$HM_EMAIL_READY = false;
if (is_file(__DIR__ . '/EmailService.php')) {
  require_once __DIR__ . '/EmailService.php';
  $HM_EMAIL_READY = class_exists('EmailService');
}
$HM_SMTP_READY = function_exists('hm_smtp_send') && function_exists('hm_smtp_selftest');

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
//  Thin controller: validate → build the branded HTML → hand off to the
//  centralized EmailService (routing, headers, Sender:, transport all live there).
hm_rate_limit('email', 20, 60);   // max 20 sends / IP / minute
$p = hm_body();

$to        = trim((string)($p['to'] ?? ''));
$message   = trim((string)($p['message'] ?? ''));
$account   = (string)($p['from_account'] ?? 'booking');
$subject   = trim((string)($p['subject'] ?? '')) ?: '[Hello Moving] ご連絡';
$bookingId = trim((string)($p['booking_id'] ?? ''));
$inReplyTo = trim((string)($p['in_reply_to'] ?? ''));   // reply threading (optional)
$references = trim((string)($p['references'] ?? ''));

if ($to === '' || strpos($to, '@') === false) email_err('Invalid recipient', 'bad_recipient', 400);
if ($message === '') email_err('Empty message body', 'empty_message', 400);

if (!$HM_EMAIL_READY) {
  hm_log_error('send-email unavailable', ['reason' => 'EmailService.php missing or invalid', 'to' => $to, 'from_account' => $account]);
  email_err('Email service unavailable (EmailService.php missing on server)', 'smtp_unavailable', 500);
}

$acc  = EmailService::account($cfg, $account);
$html = EmailService::customerHtml($acc, $message, $bookingId);

$res = EmailService::deliver($cfg, [
  'account'    => $account,     // Reply-To defaults to this account's mailbox
  'to'         => $to,
  'subject'    => $subject,
  'html'       => $html,
  'text'       => $message,
  'inReplyTo'  => $inReplyTo,   // threading (optional)
  'references' => $references,
]);

if ($res['ok']) {
  // Optional server-side logging into `communications`. Opt-in so the
  // communications.js path (which self-logs before calling this endpoint) is
  // never double-logged. Failure to log NEVER fails the response — the email
  // is already sent; we just record the problem.
  if (!empty($p['log_comm'])) {
    try {
      require_once __DIR__ . '/_db.php';
      $st = hm_db()->prepare(
        'INSERT INTO communications
           (booking_id, customer_email, sender_email, subject, message, direction, created_by, email_status, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())'
      );
      $st->execute([
        $bookingId !== '' ? $bookingId : null,
        $to,
        (string)$res['from'],
        $subject,
        $message,
        'outbound',
        'system',
        'sent',
      ]);
    } catch (Throwable $e) {
      hm_log_error('send-email log_comm failed', ['err' => $e->getMessage(), 'to' => $to]);
    }
  }
  // Optional thread persistence into `inbox_messages` (admin Inbox 返信 flow).
  // Opt-in like log_comm; the row is marked labels.outbound so the Inbox UI can
  // render it as a sent reply inside the conversation. Never fails the response.
  if (!empty($p['log_inbox'])) {
    try {
      require_once __DIR__ . '/_db.php';
      // Thread resolution: caller-supplied thread_id → the replied-to message's
      // thread → this mail starts its own (its Message-ID).
      $threadId = trim((string)($p['thread_id'] ?? ''));
      if ($threadId === '' && $inReplyTo !== '') {
        $st = hm_db()->prepare('SELECT thread_id FROM inbox_messages WHERE message_id = ? LIMIT 1');
        $st->execute([$inReplyTo]);
        $r = $st->fetch();
        if ($r && (string)$r['thread_id'] !== '') $threadId = (string)$r['thread_id'];
      }
      if ($threadId === '') $threadId = (string)($res['messageId'] ?? '');
      $st = hm_db()->prepare(
        'INSERT INTO inbox_messages
           (id, sender, sender_name, email, subject, body, body_text, booking_id,
            mailbox, message_id, in_reply_to, thread_id, received_at, is_read, status, labels)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(),1,\'open\',\'{"outbound":true}\')'
      );
      $st->execute([
        hm_uuid4(),
        (string)$res['from'],
        $acc['name'] ?? 'Hello Moving',
        $to,
        $subject,
        $message,
        $message,
        $bookingId !== '' ? $bookingId : null,
        $acc['email'] ?? (string)$res['from'],
        (string)($res['messageId'] ?? '') ?: null,
        $inReplyTo !== '' ? $inReplyTo : null,
        $threadId !== '' ? $threadId : null,
      ]);
    } catch (Throwable $e) {
      hm_log_error('send-email log_inbox failed', ['err' => $e->getMessage(), 'to' => $to]);
    }
  }
  email_ok(['from' => $res['from'], 'messageId' => $res['messageId'], 'transport' => $res['transport']]);
}

// Failure: log the internal detail, return the public (or debug) message. In
// smtp mode this NEVER silently falls back to mail() — deliver() already decided.
hm_log_error('send-email failed', [
  'code' => $res['code'], 'err' => $res['error_raw'] ?? $res['error'],
  'host' => (string)($cfg['smtp_host'] ?? ''), 'to' => $to, 'from_account' => $account,
]);
email_err(hm_debug() ? ($res['error_raw'] ?? $res['error']) : $res['error'], $res['code'], $res['status'] ?? 502);
