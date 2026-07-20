<?php
// ════════════════════════════════════════════════════════════════════════════
//  EmailService.php — centralized outbound-email abstraction for Hello Moving.
//
//  WHY: previously the sender identity, HTML template, header assembly and
//  transport branching lived inline in send-email.php, and a second, orphaned
//  copy lived in the repo-root send_email.php. This class is the single source
//  of truth for:
//    • ROUTING     — the three company mailboxes (booking@/support@/contact@),
//                    each with a From display name and an admin recipient.
//    • HEADERS     — From, Reply-To, Return-Path (envelope) and the optional
//                    Sender: disclosure (see below), applied identically across
//                    every transport.
//    • TEMPLATES   — the branded customer email + a simple notification email.
//    • TRANSPORT   — delegates to the existing, unchanged _smtp.php (native SMTP)
//                    or PHP mail(); PHPMailer is used only if vendor/ exists.
//
//  It does NOT re-implement SMTP — the self-hosted SMTP infrastructure in
//  _smtp.php is reused as-is.
//
//  HEADER STANDARD (verified):
//    From         = the routed mailbox (booking@ / support@ / contact@)
//    Reply-To     = that mailbox by default; a caller may override (contact form
//                   sets it to the submitter so staff reply to the customer)
//    Return-Path  = envelope sender = the From mailbox (SMTP MAIL FROM / mail() -f)
//    Sender       = the authenticated SMTP mailbox (smtp_user), emitted ONLY when
//                   it differs from From — RFC 5322 §3.6.2 disclosure of the
//                   authenticated agent (AUTH booking@ but send From support@…).
//
//  deliver() NEVER throws — it returns a result array so endpoints stay thin:
//    success → ['ok'=>true,  'from'=>…, 'messageId'=>…, 'transport'=>…]
//    failure → ['ok'=>false, 'error'=>publicMsg, 'error_raw'=>internalMsg,
//               'code'=>errCode, 'status'=>httpStatus]
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

// Reuse the existing native SMTP client. Guarded so a missing _smtp.php cannot
// fatal mail() mode (smtp mode then reports smtp_unavailable via deliver()).
if (is_file(__DIR__ . '/_smtp.php')) {
  require_once __DIR__ . '/_smtp.php';
}

if (!class_exists('EmailService')) {

class EmailService {

  // ── Routing table: account key → From mailbox, display name, admin recipient ──
  //  Fed by _config.php (mail_from_*); defaults keep the three company mailboxes.
  public static function accounts(array $cfg): array {
    return [
      'booking' => [
        'email' => (string)($cfg['mail_from_booking'] ?? 'booking@hello-moving.com'),
        'name'  => 'Hello Moving 予約センター',
        'admin' => (string)($cfg['mail_from_booking'] ?? 'booking@hello-moving.com'),
      ],
      'support' => [
        'email' => (string)($cfg['mail_from_support'] ?? 'support@hello-moving.com'),
        'name'  => 'Hello Moving アフターサービス',
        'admin' => (string)($cfg['mail_from_support'] ?? 'support@hello-moving.com'),
      ],
      'contact' => [
        'email' => (string)($cfg['mail_from_contact'] ?? 'contact@hello-moving.com'),
        'name'  => 'Hello Moving カスタマーサポート',
        'admin' => (string)($cfg['mail_from_contact'] ?? 'contact@hello-moving.com'),
      ],
    ];
  }

  // Resolve one account descriptor; unknown keys fall back to 'booking'.
  public static function account(array $cfg, string $key): array {
    $a = self::accounts($cfg);
    return $a[$key] ?? $a['booking'];
  }

  public static function esc($s): string {
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
  }

  // ── Chat deep-link ───────────────────────────────────────────────────────────
  //  Build the customer's "chat with our team" URL from the booking reference.
  //  There is NO zero-auth portalV2.html; the real authenticated entry is
  //  login.html, which prefills the reference (?ref=) and — via ?view=chat — is
  //  honoured by portal.html to open the Chat tab straight after login. The base
  //  host comes from config (site_url), defaulting to the production domain.
  public static function chatUrl(array $cfg, string $ref): string {
    $ref  = trim($ref);
    if ($ref === '') return '';
    $base = rtrim((string)($cfg['site_url'] ?? 'https://hello-moving.com'), '/');
    return $base . '/login.html?ref=' . rawurlencode($ref) . '&view=chat';
  }

  //  Bulletproof CTA button (Gmail / Outlook desktop-VML / Apple Mail / mobile).
  //  Fixed 320px width for Outlook via VML roundrect; the non-MSO anchor adds
  //  max-width:80% so it stays inside narrow mobile viewports. $url is assumed
  //  pre-validated (built by chatUrl from the booking ref) and is attribute-escaped.
  private static function chatButton(string $url): string {
    $u = self::esc($url);
    return
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px"><tr><td align="center">'
      . '<!--[if mso]>'
      . '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="' . $u . '" style="height:50px;v-text-anchor:middle;width:320px;" arcsize="16%" strokecolor="#1d4ed8" fillcolor="#1d4ed8">'
      . '<w:anchorlock/><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">&#128172; 担当者とチャットする</center>'
      . '</v:roundrect>'
      . '<![endif]-->'
      . '<!--[if !mso]><!-- -->'
      . '<a href="' . $u . '" style="display:inline-block;background:#1d4ed8;color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:700;line-height:50px;text-align:center;text-decoration:none;width:320px;max-width:80%;border-radius:8px;mso-hide:all">&#128172; 担当者とチャットする</a>'
      . '<!--<![endif]-->'
      . '<div style="margin-top:8px;font-size:12px;color:#94a3b8;font-family:sans-serif">Chat with our team about your booking</div>'
      . '</td></tr></table>';
  }

  // ── Send. Returns a result array (never throws). ────────────────────────────
  //  $p: ['account','to','subject','html','text','replyTo'?,'inReplyTo'?,'references'?]
  //  inReplyTo/references thread a reply to an inbound message (In-Reply-To / References).
  public static function deliver(array $cfg, array $p): array {
    $account = (string)($p['account'] ?? 'booking');
    $acc     = self::account($cfg, $account);
    $to      = trim((string)($p['to'] ?? ''));
    $subject = (string)($p['subject'] ?? '') ?: '[Hello Moving] ご連絡';
    $html    = (string)($p['html'] ?? '');
    $text    = (string)($p['text'] ?? '');
    $replyTo = trim((string)($p['replyTo'] ?? '')) ?: $acc['email'];
    // Threading headers (CR/LF-guarded downstream in _smtp / here).
    $inReplyTo  = trim((string)($p['inReplyTo']  ?? $p['in_reply_to'] ?? ''));
    $references = trim((string)($p['references'] ?? ''));
    if ($references === '' && $inReplyTo !== '') $references = $inReplyTo;
    $hdrSafe = fn(string $v) => strpbrk($v, "\r\n") === false ? $v : '';
    $inReplyTo  = $hdrSafe($inReplyTo);
    $references = $hdrSafe($references);

    // The authenticated SMTP mailbox — used only to decide whether a Sender:
    // header is warranted (From ≠ auth mailbox).
    $authMailbox = (string)($cfg['smtp_user'] ?? '');
    $mode = (string)($cfg['mail_mode'] ?? 'mail');

    if ($mode === 'smtp') {
      $hasPhpmailer = is_file(__DIR__ . '/vendor/autoload.php');
      $hasNative    = function_exists('hm_smtp_send');
      if (!$hasPhpmailer && !$hasNative) {
        return self::fail('SMTP transport unavailable (install PHPMailer in vendor/ or deploy _smtp.php)',
                          null, 'smtp_unavailable', 500);
      }
      try {
        $res = $hasPhpmailer
          ? self::viaPhpmailer($cfg, $acc, $to, $subject, $html, $text, $replyTo, $authMailbox, $inReplyTo, $references)
          : hm_smtp_send($cfg, $acc['email'], $acc['name'], $to, $subject, $html, $text,
                         ['replyTo' => $replyTo, 'sender' => $authMailbox,
                          'inReplyTo' => $inReplyTo, 'references' => $references]);
        return ['ok' => true, 'from' => $acc['email'],
                'messageId' => $res['messageId'], 'transport' => $res['transport'] ?? 'smtp'];
      } catch (\Throwable $e) {
        // Native client throws HM_SMTP_Exception (carries ->smtpCode); PHPMailer
        // / anything else has none. instanceof is safe even when the class is
        // undefined — it just yields false.
        $typed  = class_exists('HM_SMTP_Exception') && $e instanceof \HM_SMTP_Exception;
        $code   = $typed ? $e->smtpCode : 'smtp_error';
        $status = $code === 'invalid_recipient' ? 400 : 502;
        $public = $typed ? hm_smtp_public_msg($code) : 'Email send failed';
        return self::fail($public, $e->getMessage(), $code, $status);
      }
    }

    // ── Default transport: PHP mail() ─────────────────────────────────────────
    if ($to === '' || strpbrk($to, "\r\n") !== false || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
      return self::fail('Invalid recipient address', null, 'invalid_recipient', 400);
    }
    $headers  = 'MIME-Version: 1.0' . "\r\n";
    $headers .= 'Content-Type: text/html; charset=UTF-8' . "\r\n";
    $headers .= 'From: ' . mb_encode_mimeheader($acc['name'], 'UTF-8') . ' <' . $acc['email'] . '>' . "\r\n";
    $headers .= 'Reply-To: ' . $replyTo . "\r\n";
    if ($authMailbox !== '' && filter_var($authMailbox, FILTER_VALIDATE_EMAIL)
        && strcasecmp($authMailbox, $acc['email']) !== 0) {
      $headers .= 'Sender: ' . $authMailbox . "\r\n";
    }
    if ($inReplyTo  !== '') $headers .= 'In-Reply-To: ' . $inReplyTo . "\r\n";
    if ($references !== '') $headers .= 'References: ' . $references . "\r\n";
    $encSubject = mb_encode_mimeheader($subject, 'UTF-8');
    // '-f' sets the envelope sender → Return-Path = the From mailbox.
    $ok = @mail($to, $encSubject, $html, $headers, '-f' . $acc['email']);
    if ($ok) {
      return ['ok' => true, 'from' => $acc['email'], 'messageId' => 'mail-' . time(), 'transport' => 'mail'];
    }
    return self::fail('mail() delivery failed (check cPanel mail / SPF / from address)', null, 'mail_send', 502);
  }

  private static function fail(string $public, ?string $raw, string $code, int $status): array {
    return ['ok' => false, 'error' => $public, 'error_raw' => $raw ?? $public,
            'code' => $code, 'status' => $status];
  }

  // ── PHPMailer adapter (used only when hm-api/vendor/autoload.php exists) ─────
  private static function viaPhpmailer(array $cfg, array $acc, string $to, string $subject,
                                       string $html, string $text, string $replyTo, string $authMailbox,
                                       string $inReplyTo = '', string $references = ''): array {
    require_once __DIR__ . '/vendor/autoload.php';
    $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
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
    $mail->addReplyTo($replyTo);
    // Keep Return-Path aligned with From across all transports.
    $mail->Sender = $acc['email'];
    // Disclose the authenticated mailbox via a Sender: header when it differs.
    if ($authMailbox !== '' && strcasecmp($authMailbox, $acc['email']) !== 0) {
      $mail->addCustomHeader('Sender', $authMailbox);
    }
    if ($inReplyTo  !== '') $mail->addCustomHeader('In-Reply-To', $inReplyTo);
    if ($references !== '') $mail->addCustomHeader('References', $references);
    $mail->isHTML(true);
    $mail->Subject = $subject;
    $mail->Body    = $html;
    $mail->AltBody = $text !== '' ? $text : strip_tags($html);
    $mail->send();
    return ['messageId' => $mail->getLastMessageID() ?: ('smtp-' . time()), 'transport' => 'smtp-phpmailer'];
  }

  // ── Templates ───────────────────────────────────────────────────────────────
  //  Branded customer email (moved verbatim from send-email.php). $acc supplies
  //  the "返信先" footer address; $bookingId adds the reference row when present.
  public static function customerHtml(array $acc, string $message, string $bookingId = '', string $chatUrl = ''): string {
    $msgHtml    = nl2br(self::esc(trim($message)));
    $bookingRow = $bookingId
      ? '<tr><td style="padding:10px 16px;border-top:1px solid #e8e8e4;font-size:12px;font-weight:600;color:#666;width:130px">受付番号</td><td style="padding:10px 16px;border-top:1px solid #e8e8e4;font-size:13px;font-weight:700;color:#1d4ed8">' . self::esc($bookingId) . '</td></tr>'
      : '';
    // Optional chat CTA — rendered only when a chat URL is supplied (lifecycle
    // emails pass it; generic admin sends do not).
    $chatCta = $chatUrl !== '' ? self::chatButton($chatUrl) : '';

    return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head>'
      . '<body style="margin:0;padding:0;background:#f2f2ef;font-family:sans-serif">'
      . '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2ef;padding:32px 0"><tr><td align="center">'
      . '<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;width:100%">'
      . '<tr><td style="background:#0a1f44;padding:28px 36px"><p style="margin:0;font-size:22px;font-weight:700;color:#fff">Hello Moving</p>'
      . '<p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,.55)">TOKYO MOVING SERVICE</p></td></tr>'
      . '<tr><td style="padding:36px"><p style="margin:0 0 20px;font-size:14px;line-height:1.9;color:#0b0f17">' . $msgHtml . '</p>'
      . ($bookingId ? '<table width="100%" style="border:1px solid #e8e8e4;border-radius:8px;margin-bottom:20px">' . $bookingRow . '</table>' : '')
      . $chatCta
      . '</td></tr>'
      . '<tr><td style="background:#f7f7f4;padding:18px 36px;border-top:1px solid #e8e8e4"><p style="margin:0;font-size:11px;color:#aaa">'
      . 'このメールは Hello Moving より送信されています。<br>返信先: ' . self::esc($acc['email']) . '</p></td></tr>'
      . '</table></td></tr></table></body></html>';
  }

  //  Simple internal notification email (e.g. contact-form submissions to staff).
  //  $rows: ['ラベル' => '値', …]; $bodyText is rendered as a free-text block.
  public static function notifyHtml(string $heading, array $rows, string $bodyText = ''): string {
    $rowsHtml = '';
    foreach ($rows as $label => $val) {
      $rowsHtml .= '<tr><td style="padding:10px 16px;border-top:1px solid #e8e8e4;font-size:12px;font-weight:600;color:#666;width:130px;white-space:nowrap">'
        . self::esc($label) . '</td><td style="padding:10px 16px;border-top:1px solid #e8e8e4;font-size:13px;color:#0b0f17">'
        . self::esc($val) . '</td></tr>';
    }
    $body = $bodyText !== ''
      ? '<p style="margin:20px 0 0;font-size:14px;line-height:1.9;color:#0b0f17;white-space:pre-wrap">' . self::esc($bodyText) . '</p>'
      : '';

    return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head>'
      . '<body style="margin:0;padding:0;background:#f2f2ef;font-family:sans-serif">'
      . '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2ef;padding:32px 0"><tr><td align="center">'
      . '<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;width:100%">'
      . '<tr><td style="background:#0a1f44;padding:28px 36px"><p style="margin:0;font-size:22px;font-weight:700;color:#fff">Hello Moving</p>'
      . '<p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,.55)">' . self::esc($heading) . '</p></td></tr>'
      . '<tr><td style="padding:36px">'
      . '<table width="100%" style="border:1px solid #e8e8e4;border-radius:8px;overflow:hidden">' . $rowsHtml . '</table>'
      . $body
      . '</td></tr></table></td></tr></table></body></html>';
  }
}

} // end if (!class_exists('EmailService'))
