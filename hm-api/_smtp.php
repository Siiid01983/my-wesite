<?php
// ════════════════════════════════════════════════════════════════════════════
//  _smtp.php — dependency-free authenticated SMTP client for Hello Moving.
//
//  Why this exists: the host (shared cPanel) has no Composer / PHPMailer, so the
//  old SMTP branch in send-email.php (gated on vendor/autoload.php) could never
//  run and every "smtp" send silently fell back to mail(). This implements SMTP
//  over a raw fsockopen() socket — STARTTLS (587), implicit TLS (465) or plain
//  (25) — with AUTH LOGIN (PLAIN fallback), so authenticated SMTP works with NO
//  external dependency.
//
//  PUBLIC API:
//    hm_smtp_send($cfg, $fromEmail, $fromName, $to, $subject, $html, $text)
//        → ['messageId'=>'<…>', 'response'=>'250 …', 'transport'=>'smtp']
//        → throws HM_SMTP_Exception (carries ->smtpCode) on any failure.
//    hm_smtp_selftest($cfg, $sendTo=null)
//        → ['ok'=>bool, 'data'=>[...], 'error'?=>string, 'code'?=>string]
//          data includes: dns, smtp:"connected", starttls:"ok", auth:"success".
//    hm_smtp_public_msg($code) → safe, human string for an error code.
//
//  Error codes (HM_SMTP_Exception->smtpCode):
//    smtp_config  smtp_dns  smtp_connect  smtp_tls  smtp_auth  smtp_send  smtp_error
//
//  Logging: this file NEVER logs on its own — callers (send-email.php) decide
//  what to log via hm_log_error so logging stays in one place. AUTH credentials
//  are never retained in any transcript.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

if (!class_exists('HM_SMTP_Exception')) {

class HM_SMTP_Exception extends RuntimeException {
  public string $smtpCode;
  public function __construct(string $message, string $code, ?Throwable $prev = null) {
    parent::__construct($message, 0, $prev);
    $this->smtpCode = $code;
  }
}

class HM_SMTP {
  /** @var resource|null */
  private $fp = null;
  private array $opt;
  private array $caps = [];          // EHLO capabilities (UPPERCASE => args)
  private string $lastResponse = '';
  private int    $lastCode = 0;

  public function __construct(array $opt) {
    $this->opt = $opt + [
      'host' => '', 'port' => 587, 'user' => '', 'pass' => '',
      'secure' => 'tls', 'timeout' => 15, 'helo' => null,
    ];
  }

  public function lastResponse(): string { return $this->lastResponse; }
  public function capabilities(): array  { return $this->caps; }

  // ── Open the socket with fsockopen() and read the 220 greeting ────────────
  public function connect(): void {
    $secure = strtolower((string)$this->opt['secure']);
    $host   = (string)$this->opt['host'];
    $port   = (int)$this->opt['port'];
    $timeout= (int)$this->opt['timeout'] ?: 15;

    if ($host === '') throw new HM_SMTP_Exception('SMTP host not configured', 'smtp_config');

    // 'ssl' = implicit TLS (465): connect with the ssl:// transport.
    // 'tls'/'' = connect plain, then upgrade via STARTTLS later.
    $remote = ($secure === 'ssl') ? 'ssl://' . $host : $host;

    $errno = 0; $errstr = '';
    $fp = @fsockopen($remote, $port, $errno, $errstr, $timeout);
    if (!$fp) {
      throw new HM_SMTP_Exception(
        sprintf('Connect to %s:%d failed: %s (%d)', $host, $port, $errstr ?: 'no route', $errno),
        'smtp_connect'
      );
    }
    $this->fp = $fp;
    stream_set_timeout($this->fp, $timeout);

    [$code] = $this->read();
    if ($code !== 220) {
      throw new HM_SMTP_Exception('Unexpected greeting: ' . $this->lastResponse, 'smtp_connect');
    }
  }

  // ── EHLO (falls back to HELO) and capture advertised capabilities ─────────
  public function ehlo(): array {
    $helo = (string)($this->opt['helo'] ?: ($_SERVER['SERVER_NAME'] ?? '')) ?: (gethostname() ?: 'localhost');
    $helo = preg_replace('/[^A-Za-z0-9\.\-]/', '', $helo) ?: 'localhost';

    $this->command('EHLO ' . $helo);
    [$code, $resp] = $this->read();
    if ($code !== 250) {
      // Some legacy servers only speak HELO.
      $this->command('HELO ' . $helo);
      [$code] = $this->read();
      if ($code !== 250) throw new HM_SMTP_Exception('EHLO/HELO rejected: ' . $this->lastResponse, 'smtp_connect');
      $this->caps = [];
      return $this->caps;
    }

    $this->caps = [];
    foreach (preg_split('/\r?\n/', trim($resp)) as $line) {
      $line = preg_replace('/^\d{3}[ \-]/', '', $line); // strip "250-" / "250 "
      if ($line === '') continue;
      $parts = preg_split('/\s+/', strtoupper(trim($line)));
      $this->caps[$parts[0]] = array_slice($parts, 1);
    }
    return $this->caps;
  }

  // ── STARTTLS upgrade (for secure='tls' on the plain port) ─────────────────
  public function startTls(): void {
    $this->command('STARTTLS');
    [$code] = $this->read();
    if ($code !== 220) throw new HM_SMTP_Exception('STARTTLS refused: ' . $this->lastResponse, 'smtp_tls');

    $crypto = STREAM_CRYPTO_METHOD_TLS_CLIENT;
    if (defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')) {
      $crypto |= STREAM_CRYPTO_METHOD_TLSv1_1_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
    }
    if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT')) {
      $crypto |= STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
    }
    $ok = @stream_socket_enable_crypto($this->fp, true, $crypto);
    if ($ok !== true) throw new HM_SMTP_Exception('TLS handshake failed after STARTTLS', 'smtp_tls');
  }

  // ── AUTH (LOGIN preferred, PLAIN fallback) ────────────────────────────────
  public function authenticate(): void {
    $user = (string)$this->opt['user'];
    $pass = (string)$this->opt['pass'];
    if ($user === '' || $pass === '') {
      throw new HM_SMTP_Exception('SMTP username/password not set', 'smtp_config');
    }

    $methods  = $this->caps['AUTH'] ?? [];
    $useLogin = empty($methods) || in_array('LOGIN', $methods, true);

    if ($useLogin) {
      $this->command('AUTH LOGIN');
      [$code] = $this->read();
      if ($code !== 334) throw new HM_SMTP_Exception('AUTH LOGIN not accepted: ' . $this->lastResponse, 'smtp_auth');
      $this->command(base64_encode($user));        // sensitive — not retained
      [$code] = $this->read();
      if ($code !== 334) throw new HM_SMTP_Exception('SMTP username rejected', 'smtp_auth');
      $this->command(base64_encode($pass));        // sensitive — not retained
      [$code] = $this->read();
      if ($code !== 235) throw new HM_SMTP_Exception('SMTP authentication failed (check user/password)', 'smtp_auth');
      return;
    }

    // AUTH PLAIN: base64( \0 user \0 pass )
    $token = base64_encode("\0" . $user . "\0" . $pass);
    $this->command('AUTH PLAIN ' . $token);
    [$code] = $this->read();
    if ($code !== 235) throw new HM_SMTP_Exception('SMTP authentication failed (check user/password)', 'smtp_auth');
  }

  // ── Envelope + DATA. $raw is the full pre-built message (headers + body) ───
  public function mail(string $from, string $to, string $raw): string {
    $this->command('MAIL FROM:<' . $from . '>');
    [$code] = $this->read();
    if ($code !== 250) throw new HM_SMTP_Exception('MAIL FROM rejected: ' . $this->lastResponse, 'smtp_send');

    $this->command('RCPT TO:<' . $to . '>');
    [$code] = $this->read();
    if ($code !== 250 && $code !== 251) throw new HM_SMTP_Exception('RCPT TO rejected: ' . $this->lastResponse, 'smtp_send');

    $this->command('DATA');
    [$code] = $this->read();
    if ($code !== 354) throw new HM_SMTP_Exception('DATA refused: ' . $this->lastResponse, 'smtp_send');

    // Normalise to CRLF and dot-stuff any line beginning with '.'.
    $body = preg_replace('/\r\n|\r|\n/', "\r\n", $raw);
    $body = preg_replace('/^\./m', '..', $body);
    $this->write($body . "\r\n.\r\n");
    [$code] = $this->read();
    if ($code !== 250) throw new HM_SMTP_Exception('Message rejected on send: ' . $this->lastResponse, 'smtp_send');
    return $this->lastResponse;
  }

  public function quit(): void {
    if (!$this->fp) return;
    try { $this->command('QUIT'); $this->read(); } catch (Throwable $e) { /* ignore */ }
  }

  public function close(): void {
    if ($this->fp) { @fclose($this->fp); $this->fp = null; }
  }

  // ── low-level I/O ─────────────────────────────────────────────────────────
  private function command(string $line): void {
    $this->write($line . "\r\n");
  }

  private function write(string $data): void {
    if (!$this->fp) throw new HM_SMTP_Exception('SMTP socket not open', 'smtp_send');
    $len = @fwrite($this->fp, $data);
    if ($len === false) {
      $this->failOnTimeout();
      throw new HM_SMTP_Exception('Write to SMTP socket failed', 'smtp_send');
    }
  }

  /** @return array{0:int,1:string} [code, full response text] */
  private function read(): array {
    if (!$this->fp) throw new HM_SMTP_Exception('SMTP socket not open', 'smtp_send');
    $data = '';
    while (($line = @fgets($this->fp, 515)) !== false) {
      $data .= $line;
      // A multiline reply uses "250-text"; the final line uses "250 text".
      if (strlen($line) < 4 || $line[3] === ' ') break;
    }
    if ($data === '') { $this->failOnTimeout(); throw new HM_SMTP_Exception('No response from SMTP server', 'smtp_connect'); }
    $this->lastResponse = trim($data);
    $this->lastCode = (int)substr($data, 0, 3);
    return [$this->lastCode, $this->lastResponse];
  }

  private function failOnTimeout(): void {
    if ($this->fp) {
      $meta = @stream_get_meta_data($this->fp);
      if (!empty($meta['timed_out'])) throw new HM_SMTP_Exception('SMTP server timed out', 'smtp_connect');
    }
  }
}

// ── Build a multipart/alternative message (text + HTML), base64 bodies ───────
// Base64 sidesteps line-length/dot-stuffing pitfalls and is safe for Japanese.
// Returns [rawMessage, messageId].
function hm_smtp_build_message(string $fromEmail, string $fromName, string $to,
                               string $replyTo, string $subject, string $html, string $text): array {
  $domain    = substr((string)strrchr($fromEmail, '@'), 1) ?: 'hello-moving.com';
  $messageId = '<' . bin2hex(random_bytes(16)) . '@' . $domain . '>';
  $boundary  = 'hm_' . bin2hex(random_bytes(8));

  $h   = [];
  $h[] = 'Date: ' . date('r');
  $h[] = 'From: ' . hm_smtp_encode_name($fromName) . ' <' . $fromEmail . '>';
  $h[] = 'To: <' . $to . '>';
  $h[] = 'Reply-To: ' . hm_smtp_encode_name($fromName) . ' <' . $replyTo . '>';
  $h[] = 'Subject: ' . mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n");
  $h[] = 'Message-ID: ' . $messageId;
  $h[] = 'MIME-Version: 1.0';
  $h[] = 'Content-Type: multipart/alternative; boundary="' . $boundary . '"';

  $b  = '--' . $boundary . "\r\n";
  $b .= "Content-Type: text/plain; charset=UTF-8\r\n";
  $b .= "Content-Transfer-Encoding: base64\r\n\r\n";
  $b .= chunk_split(base64_encode($text !== '' ? $text : strip_tags($html)));
  $b .= '--' . $boundary . "\r\n";
  $b .= "Content-Type: text/html; charset=UTF-8\r\n";
  $b .= "Content-Transfer-Encoding: base64\r\n\r\n";
  $b .= chunk_split(base64_encode($html));
  $b .= '--' . $boundary . "--\r\n";

  return [implode("\r\n", $h) . "\r\n\r\n" . $b, $messageId];
}

function hm_smtp_encode_name(string $name): string {
  // ASCII display names get a simple quoted form; non-ASCII is MIME-B encoded.
  if (preg_match('/^[\x20-\x7E]*$/', $name)) return '"' . str_replace('"', '', $name) . '"';
  return mb_encode_mimeheader($name, 'UTF-8', 'B', "\r\n");
}

// ── Normalised options from _config.php ───────────────────────────────────────
function hm_smtp_opts(array $cfg): array {
  return [
    'host'    => (string)($cfg['smtp_host'] ?? ''),
    'port'    => (int)($cfg['smtp_port'] ?? 587),
    'user'    => (string)($cfg['smtp_user'] ?? ''),
    'pass'    => (string)($cfg['smtp_pass'] ?? ''),
    'secure'  => strtolower((string)($cfg['smtp_secure'] ?? 'tls')),
    'timeout' => (int)($cfg['smtp_timeout'] ?? 15),
    'helo'    => $cfg['smtp_helo'] ?? null,
  ];
}

// ── One-shot authenticated send. Throws HM_SMTP_Exception on any failure. ────
function hm_smtp_send(array $cfg, string $fromEmail, string $fromName, string $to,
                      string $subject, string $html, string $text): array {
  $opt = hm_smtp_opts($cfg);
  if ($opt['host'] === '' || $opt['user'] === '' || $opt['pass'] === '') {
    throw new HM_SMTP_Exception('SMTP not fully configured (need smtp_host, smtp_user, smtp_pass)', 'smtp_config');
  }

  [$raw, $mid] = hm_smtp_build_message($fromEmail, $fromName, $to, $fromEmail, $subject, $html, $text);

  $smtp = new HM_SMTP($opt);
  try {
    $smtp->connect();
    $smtp->ehlo();
    if ($opt['secure'] === 'tls') { $smtp->startTls(); $smtp->ehlo(); } // re-EHLO inside TLS
    $smtp->authenticate();
    $resp = $smtp->mail($fromEmail, $to, $raw);
    $smtp->quit();
    return ['messageId' => $mid, 'response' => $resp, 'transport' => 'smtp'];
  } finally {
    $smtp->close();
  }
}

// ── Self-test: DNS → connection → STARTTLS → auth → (optional) test send ─────
// Never throws. Returns:
//   success → ['ok'=>true,  'data'=>['dns'=>ip,'smtp'=>'connected',
//                                    'starttls'=>'ok','auth'=>'success', ...]]
//   failure → ['ok'=>false, 'data'=>[...partial...], 'error'=>msg, 'code'=>code]
function hm_smtp_selftest(array $cfg, ?string $sendTo = null): array {
  $opt  = hm_smtp_opts($cfg);
  $data = ['host' => $opt['host'], 'port' => $opt['port'], 'secure' => $opt['secure'], 'user' => $opt['user']];

  $fail = function (string $msg, string $code) use (&$data): array {
    return ['ok' => false, 'data' => $data, 'error' => $msg, 'code' => $code];
  };

  // 0. Config present?
  if ($opt['host'] === '' || $opt['user'] === '' || $opt['pass'] === '') {
    return $fail('SMTP not fully configured (need smtp_host, smtp_user, smtp_pass)', 'smtp_config');
  }

  // 1. DNS resolution.
  $ip = @gethostbyname($opt['host']);
  $resolved = ($ip !== $opt['host']) || filter_var($opt['host'], FILTER_VALIDATE_IP);
  if (!$resolved) return $fail('DNS resolution failed for ' . $opt['host'], 'smtp_dns');
  $data['dns'] = $ip;

  // 2-4. Connection / STARTTLS / auth (+ optional send).
  $smtp = new HM_SMTP($opt);
  try {
    $smtp->connect();                 $data['smtp'] = 'connected';
    $smtp->ehlo();
    if ($opt['secure'] === 'tls') { $smtp->startTls(); $data['starttls'] = 'ok'; $smtp->ehlo(); }
    elseif ($opt['secure'] === 'ssl') { $data['starttls'] = 'implicit'; }
    $smtp->authenticate();            $data['auth'] = 'success';
    $data['capabilities'] = array_keys($smtp->capabilities());

    if ($sendTo !== null && $sendTo !== '') {
      $stamp = date('c');
      [$raw, $mid] = hm_smtp_build_message(
        $opt['user'], 'Hello Moving SMTP self-test', $sendTo, $opt['user'],
        '[Hello Moving] SMTP self-test',
        '<p>SMTP self-test succeeded.</p><p>' . htmlspecialchars($stamp) . '</p>',
        'SMTP self-test succeeded. ' . $stamp
      );
      $smtp->mail($opt['user'], $sendTo, $raw);
      $data['send'] = 'sent';
      $data['messageId'] = $mid;
      $data['sentTo'] = $sendTo;
    }
    $smtp->quit();
    return ['ok' => true, 'data' => $data];
  } catch (HM_SMTP_Exception $e) {
    return ['ok' => false, 'data' => $data, 'error' => $e->getMessage(), 'code' => $e->smtpCode];
  } catch (Throwable $e) {
    return ['ok' => false, 'data' => $data, 'error' => $e->getMessage(), 'code' => 'smtp_error'];
  } finally {
    $smtp->close();
  }
}

// ── Public, non-leaking message for an SMTP error code ───────────────────────
function hm_smtp_public_msg(string $code): string {
  switch ($code) {
    case 'smtp_config':  return 'SMTP is not fully configured';
    case 'smtp_dns':     return 'Could not resolve the mail server hostname';
    case 'smtp_connect': return 'Could not connect to the mail server';
    case 'smtp_tls':     return 'Secure (TLS) handshake with the mail server failed';
    case 'smtp_auth':    return 'SMTP authentication failed';
    case 'smtp_send':    return 'The mail server rejected the message';
    default:             return 'Email send failed';
  }
}

} // end if (!class_exists('HM_SMTP_Exception'))
