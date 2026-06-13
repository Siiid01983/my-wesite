<?php
/**
 * Hello Moving — PHP confirmation mailer
 * Upload to: public_html/send_email.php  (cPanel root)
 *
 * Sends:
 *   1. HTML confirmation email → customer
 *   2. Plain-text new-enquiry alert → admin
 *
 * No dependencies — uses PHP's built-in mail().
 * For SMTP / Gmail relay, see the PHPMailer block at the bottom (commented out).
 */

/* ── Configuration ─────────────────────────────────────────────── */
define('ADMIN_EMAIL',  'hellomoving1@gmail.com');       // you receive alerts here
define('FROM_EMAIL',   'noreply@hello-moving.com'); // must exist in cPanel → Email Accounts
define('FROM_NAME',    'Hello Moving');
define('SITE_ORIGIN',  'https://hello-moving.com');

/* ── CORS + response type ──────────────────────────────────────── */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: ' . SITE_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

/* ── Parse JSON body ────────────────────────────────────────────── */
$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON body']);
    exit;
}

/* ── Sanitise helpers ───────────────────────────────────────────── */
function clean(string $v): string {
    return htmlspecialchars(strip_tags(trim($v)), ENT_QUOTES, 'UTF-8');
}

function utf8_subject(string $s): string {
    return '=?UTF-8?B?' . base64_encode($s) . '?=';
}

/* ── Extract + validate fields ─────────────────────────────────── */
$to_name    = clean($data['to_name']    ?? '');
$to_email   = filter_var(trim($data['to_email'] ?? ''), FILTER_VALIDATE_EMAIL);
$booking_ref = clean($data['booking_ref'] ?? '');
$service    = clean($data['service']    ?? '—');
$move_date  = clean($data['move_date']  ?? '—');
$time_slot  = clean($data['time_slot']  ?? '未定');
$from_addr  = clean($data['from_addr']  ?? '—');
$to_addr    = clean($data['to_addr']    ?? '—');

if (!$to_email) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid or missing email address']);
    exit;
}

if (!$booking_ref) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing booking_ref']);
    exit;
}

/* ── Shared mail headers ─────────────────────────────────────────
   Using \r\n per RFC 2822; PHP's mail() adds its own MIME-Version.   */
$base_headers = [
    'From: '    . FROM_NAME . ' <' . FROM_EMAIL . '>',
    'X-Mailer: PHP/' . PHP_VERSION,
];

/* ══════════════════════════════════════════════════════════════
   1.  Customer confirmation — HTML email
   ══════════════════════════════════════════════════════════════ */
$customer_subject = utf8_subject('[Hello Moving] お問い合わせを受け付けました — ' . $booking_ref);

$customer_body = <<<HTML
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f2ef;font-family:'Hiragino Sans','Meiryo',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2ef;padding:32px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:600px;width:100%">

  <!-- Header -->
  <tr><td style="background:#0a1f44;padding:28px 36px">
    <p style="margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:.04em">Hello Moving</p>
    <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,.55);letter-spacing:.06em">TOKYO MOVING SERVICE</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:36px 36px 24px">
    <p style="margin:0 0 20px;font-size:15px;color:#0b0f17">{$to_name}様</p>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#444">
      この度はHello Movingへのお問い合わせありがとうございます。<br>
      以下の内容で受け付けいたしました。通常<strong>当日〜翌営業日</strong>にご連絡いたします。
    </p>

    <!-- Booking details table -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e4;border-radius:8px;overflow:hidden;margin-bottom:28px">
      <tr style="background:#f7f7f4">
        <td colspan="2" style="padding:12px 16px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#888">予約内容</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:12px;font-weight:600;color:#666;width:130px;white-space:nowrap">受付番号</td>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:14px;font-weight:700;color:#1d4ed8">{$booking_ref}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:12px;font-weight:600;color:#666">サービス</td>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:13px;color:#0b0f17">{$service}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:12px;font-weight:600;color:#666">引越し希望日</td>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:13px;color:#0b0f17">{$move_date}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:12px;font-weight:600;color:#666">希望時間帯</td>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:13px;color:#0b0f17">{$time_slot}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:12px;font-weight:600;color:#666">引越し元</td>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:13px;color:#0b0f17">{$from_addr}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:12px;font-weight:600;color:#666">引越し先</td>
        <td style="padding:12px 16px;border-top:1px solid #e8e8e4;font-size:13px;color:#0b0f17">{$to_addr}</td>
      </tr>
    </table>

    <!-- Contact strip -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;margin-bottom:28px">
      <tr><td style="padding:16px 20px">
        <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#0369a1">お急ぎの場合はこちらへ</p>
        <p style="margin:0;font-size:13px;color:#444;line-height:1.8">
          📞 <a href="tel:+819024893402" style="color:#0369a1">090-2489-3402</a>（08:00〜20:00）<br>
          💬 <a href="https://line.me/R/ti/p/~hellomoving" style="color:#0369a1">LINE で相談する</a>
        </p>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f7f7f4;padding:20px 36px;border-top:1px solid #e8e8e4">
    <p style="margin:0;font-size:11px;color:#aaa;line-height:1.7">
      このメールはHello Moving予約システムより自動送信されています。<br>
      お心当たりのない場合はこのメールを破棄してください。<br>
      〒 東京都 — 国土交通省 認可 第431320058126号
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>
HTML;

$customer_headers = array_merge($base_headers, [
    'Reply-To: '    . ADMIN_EMAIL,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
]);

/* ══════════════════════════════════════════════════════════════
   2.  Admin new-enquiry alert — plain text
   ══════════════════════════════════════════════════════════════ */
$admin_subject = utf8_subject('[新規予約] ' . $to_name . '様 — ' . $booking_ref);

$admin_body = implode("\n", [
    '新規お問い合わせが届きました。',
    '',
    "お客様名　：{$to_name}",
    "メール　　：{$to_email}",
    "受付番号　：{$booking_ref}",
    "サービス　：{$service}",
    "引越し日　：{$move_date}",
    "希望時間帯：{$time_slot}",
    "引越し元　：{$from_addr}",
    "引越し先　：{$to_addr}",
    '',
    '管理パネル: https://hello-moving.com/admin.html',
]);

$admin_headers = array_merge($base_headers, [
    'Reply-To: '    . $to_email,   // reply goes straight to customer
    'Content-Type: text/plain; charset=UTF-8',
]);

/* ── Send ───────────────────────────────────────────────────── */
$sent_customer = mail(
    $to_email,
    $customer_subject,
    $customer_body,
    implode("\r\n", $customer_headers)
);

$sent_admin = mail(
    ADMIN_EMAIL,
    $admin_subject,
    $admin_body,
    implode("\r\n", $admin_headers)
);

if ($sent_customer) {
    echo json_encode(['ok' => true, 'admin_notified' => $sent_admin]);
} else {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'mail() returned false — check server sendmail config']);
}

/* ══════════════════════════════════════════════════════════════
   OPTIONAL: PHPMailer via SMTP (Gmail / cPanel SMTP)
   ──────────────────────────────────────────────────────────────
   1. Upload PHPMailer: composer require phpmailer/phpmailer
      OR download the single-file version from GitHub.
   2. Uncomment below and delete the mail() calls above.

require 'vendor/autoload.php';
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

function sendViaSMTP(string $to, string $toName, string $subject, string $body, bool $isHtml): bool {
    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host       = 'mail.hello-moving.com'; // cPanel SMTP host
        $mail->SMTPAuth   = true;
        $mail->Username   = 'noreply@hello-moving.com';
        $mail->Password   = 'YOUR_CPANEL_EMAIL_PASSWORD';
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = 587;
        $mail->CharSet    = 'UTF-8';

        $mail->setFrom('noreply@hello-moving.com', 'Hello Moving');
        $mail->addAddress($to, $toName);
        $mail->Subject  = $subject;
        $mail->isHTML($isHtml);
        $mail->Body     = $body;
        return $mail->send();
    } catch (Exception $e) {
        error_log('[PHPMailer] ' . $e->getMessage());
        return false;
    }
}
   ══════════════════════════════════════════════════════════════ */
