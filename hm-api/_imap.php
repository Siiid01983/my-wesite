<?php
// ════════════════════════════════════════════════════════════════════════════
//  _imap.php — IMAP + MIME parsing helpers for the Email Center inbound poller.
//
//  Self-hosted IMAP only (Dovecot on mail.hello-moving.com). Uses the PHP `imap`
//  extension. This file is DB-free: it opens mailboxes, lists new UIDs, and
//  parses a message into a normalized array. All persistence / threading /
//  dedup lives in inbox-poll.php.
//
//  PUBLIC API:
//    hm_imap_ref($cfg)                    → "{host:port/imap/ssl}" mailbox prefix
//    hm_imap_open($cfg, $user, $pass)     → imap resource (OP_READONLY) | throws
//    hm_imap_status($imap, $ref)          → ['uidvalidity','uidnext','messages']
//    hm_imap_new_uids($imap, $startUid)   → [int uid, …] with uid >= startUid
//    hm_imap_parse($imap, $uid)           → normalized message array (below)
//    hm_imap_norm_subject($s)             → subject with Re:/Fwd: prefixes stripped
//    hm_imap_ids_from($header)            → ['<id>', …] extracted from a header value
//
//  parse() returns:
//    ['uid','message_id','in_reply_to','references'(array),'from_name','from_email',
//     'subject','body_text','body_html','received_at'(Y-m-d H:i:s),'udate'(int)]
//
//  NEVER logs credentials. FT_PEEK + OP_READONLY so server \Seen flags are left
//  untouched (staff read-state is tracked in inbox_messages.is_read instead).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

if (!function_exists('hm_imap_available')) {

function hm_imap_available(): bool { return function_exists('imap_open'); }

// Build the IMAP mailbox reference prefix, e.g. {mail.hello-moving.com:993/imap/ssl}
function hm_imap_ref(array $cfg): string {
  $host   = (string)($cfg['imap_host'] ?? 'mail.hello-moving.com');
  $port   = (int)($cfg['imap_port'] ?? 993);
  $secure = strtolower((string)($cfg['imap_secure'] ?? 'ssl'));
  $flags  = '/imap';
  if ($secure === 'ssl')      $flags .= '/ssl';
  elseif ($secure === 'tls')  $flags .= '/tls';
  else                        $flags .= '/notls';
  if (!empty($cfg['imap_novalidate_cert'])) $flags .= '/novalidate-cert';
  return '{' . $host . ':' . $port . $flags . '}';
}

// Open the INBOX for one account. Read-only; short timeouts. Throws RuntimeException.
function hm_imap_open(array $cfg, string $user, string $pass) {
  if (!hm_imap_available()) throw new RuntimeException('php-imap extension not installed');
  foreach ([IMAP_OPENTIMEOUT, IMAP_READTIMEOUT, IMAP_WRITETIMEOUT, IMAP_CLOSETIMEOUT] as $t) {
    @imap_timeout($t, 20);
  }
  $mbox = hm_imap_ref($cfg) . 'INBOX';
  $imap = @imap_open($mbox, $user, $pass, OP_READONLY, 1);
  if ($imap === false) {
    // imap_last_error may include the server text but NEVER the password.
    $err = imap_last_error() ?: 'connection failed';
    @imap_errors(); @imap_alerts();                 // drain so later calls are clean
    // Actionable hint for the classic shared-cPanel case: c-client sends no SNI,
    // so the server returns its DEFAULT (own-hostname) certificate — connecting as
    // mail.<domain> then fails TLS hostname verification. Production-safe fix: set
    // imap_host to that certificate hostname (same mail server, cert validates).
    // imap_novalidate_cert=true is a last-resort fallback (TLS stays encrypted).
    if (stripos($err, 'certificate') !== false || stripos($err, 'hostname') !== false) {
      $err .= ' — set imap_host to the certificate hostname (same mail server, keeps full TLS validation), or imap_novalidate_cert=true as a last resort';
    }
    throw new RuntimeException('IMAP open failed: ' . $err);
  }
  return $imap;
}

// UIDVALIDITY / UIDNEXT / message count for incremental polling.
function hm_imap_status($imap, array $cfg): array {
  $st = @imap_status($imap, hm_imap_ref($cfg) . 'INBOX', SA_UIDVALIDITY | SA_UIDNEXT | SA_MESSAGES);
  if ($st === false) return ['uidvalidity' => 0, 'uidnext' => 0, 'messages' => 0];
  return [
    'uidvalidity' => (int)($st->uidvalidity ?? 0),
    'uidnext'     => (int)($st->uidnext ?? 0),
    'messages'    => (int)($st->messages ?? 0),
  ];
}

// New UIDs with uid >= $startUid, ascending. Guards the IMAP "N:*" quirk (a
// range whose low bound exceeds the highest UID returns the last message).
function hm_imap_new_uids($imap, int $startUid, int $uidnext): array {
  if ($startUid < 1) $startUid = 1;
  if ($uidnext > 0 && $startUid >= $uidnext) return [];   // nothing newer
  $ov = @imap_fetch_overview($imap, $startUid . ':*', FT_UID);
  if (!is_array($ov)) return [];
  $uids = [];
  foreach ($ov as $o) {
    $uid = (int)($o->uid ?? 0);
    if ($uid >= $startUid) $uids[] = $uid;                 // drop the quirk straggler
  }
  sort($uids, SORT_NUMERIC);
  return $uids;
}

// ── MIME-encoded-word decode (Subject / display name) → UTF-8 ────────────────
function hm_imap_decode_mime(string $s): string {
  if ($s === '') return '';
  $out = '';
  foreach ((array)imap_mime_header_decode($s) as $p) {
    $cs  = strtoupper((string)($p->charset ?? 'default'));
    $txt = (string)($p->text ?? '');
    if ($cs !== 'DEFAULT' && $cs !== 'UTF-8' && $cs !== '') {
      $conv = @mb_convert_encoding($txt, 'UTF-8', $cs);
      if ($conv !== false && $conv !== '') $txt = $conv;
    }
    $out .= $txt;
  }
  return $out;
}

// Decode a transfer-encoded body part.
function hm_imap_decode_body(string $data, int $encoding): string {
  switch ($encoding) {
    case 3: return (string)base64_decode($data);            // BASE64
    case 4: return (string)quoted_printable_decode($data);  // QUOTED-PRINTABLE
    default: return $data;                                  // 7BIT/8BIT/BINARY/OTHER
  }
}

// Convert a decoded part to UTF-8 given its declared charset.
function hm_imap_to_utf8(string $s, string $charset): string {
  $charset = strtoupper(trim($charset));
  if ($s === '' || $charset === '' || $charset === 'UTF-8' || $charset === 'US-ASCII') return $s;
  $conv = @mb_convert_encoding($s, 'UTF-8', $charset);
  return ($conv === false || $conv === '') ? $s : $conv;
}

// Find a (d)parameter value (e.g. charset, filename) on a structure part.
function hm_imap_param($part, string $attr): string {
  $attr = strtolower($attr);
  foreach (['parameters', 'dparameters'] as $bag) {
    if (!empty($part->$bag)) {
      foreach ($part->$bag as $p) {
        if (strtolower((string)($p->attribute ?? '')) === $attr) return (string)($p->value ?? '');
      }
    }
  }
  return '';
}

function hm_imap_is_attachment($part): bool {
  if (!empty($part->ifdisposition) && strtoupper((string)$part->disposition) === 'ATTACHMENT') return true;
  if (hm_imap_param($part, 'filename') !== '' || hm_imap_param($part, 'name') !== '') return true;
  return false;
}

// Extract [body_text, body_html] from a message, walking multipart structures.
// FT_PEEK keeps the server \Seen flag untouched.
function hm_imap_bodies($imap, int $uid): array {
  $struct = @imap_fetchstructure($imap, $uid, FT_UID);
  $text = ''; $html = '';
  if ($struct === false) {
    $raw = (string)@imap_body($imap, $uid, FT_UID | FT_PEEK);
    return [$raw, ''];
  }

  if (empty($struct->parts)) {
    // Single-part message — whole body is section "1".
    $raw = (string)@imap_fetchbody($imap, $uid, '1', FT_UID | FT_PEEK);
    $dec = hm_imap_to_utf8(hm_imap_decode_body($raw, (int)($struct->encoding ?? 0)), hm_imap_param($struct, 'charset'));
    if (strtoupper((string)($struct->subtype ?? '')) === 'HTML') $html = $dec; else $text = $dec;
    return [$text, $html];
  }

  $walk = function ($parts, string $prefix) use (&$walk, $imap, $uid, &$text, &$html) {
    foreach ($parts as $i => $part) {
      $section = ($prefix === '') ? (string)($i + 1) : $prefix . '.' . ($i + 1);
      if (!empty($part->parts)) { $walk($part->parts, $section); continue; }
      if (hm_imap_is_attachment($part)) continue;
      if ((int)($part->type ?? 0) !== 0) continue;         // 0 = text
      $subtype = strtoupper((string)($part->subtype ?? ''));
      $raw = (string)@imap_fetchbody($imap, $uid, $section, FT_UID | FT_PEEK);
      $dec = hm_imap_to_utf8(hm_imap_decode_body($raw, (int)($part->encoding ?? 0)), hm_imap_param($part, 'charset'));
      if ($subtype === 'HTML') { if ($html === '') $html = $dec; }
      else                     { if ($text === '') $text = $dec; }
    }
  };
  $walk($struct->parts, '');
  return [$text, $html];
}

// Extract angle-bracket message-ids from a raw header value: "<a> <b>" → ['<a>','<b>'].
function hm_imap_ids_from(string $header): array {
  if ($header === '' || !preg_match_all('/<[^<>@\s]+@[^<>\s]+>/', $header, $m)) return [];
  return array_values(array_unique($m[0]));
}

// Strip Re:/Fwd:/Fw:/Aw: prefixes for subject-based thread fallback.
function hm_imap_norm_subject(string $s): string {
  $s = trim($s);
  do {
    $prev = $s;
    $s = preg_replace('/^\s*(re|fwd|fw|aw|antw)\s*(\[\d+\])?\s*:\s*/iu', '', $s);
  } while ($s !== $prev);
  return trim($s);
}

// Parse one message (by UID) into the normalized array. Never throws on a single
// bad message — returns what it can.
function hm_imap_parse($imap, int $uid): array {
  $rawHeader = (string)@imap_fetchheader($imap, $uid, FT_UID | FT_PREFETCHTEXT);
  $hdr = @imap_rfc822_parse_headers($rawHeader);

  $messageId = trim((string)($hdr->message_id ?? ''));
  $subject   = hm_imap_decode_mime((string)($hdr->subject ?? ''));

  $fromName = ''; $fromEmail = '';
  if (!empty($hdr->from) && is_array($hdr->from)) {
    $f = $hdr->from[0];
    $fromName  = hm_imap_decode_mime((string)($f->personal ?? ''));
    $mbox = (string)($f->mailbox ?? ''); $host = (string)($f->host ?? '');
    if ($mbox !== '' && $host !== '') $fromEmail = $mbox . '@' . $host;
  }
  if ($fromName === '') $fromName = $fromEmail;

  // Reply-To — the preferred reply target when it differs from From (e.g. the
  // contact-form notification: From = contact@, customer address in Reply-To).
  $replyToName = ''; $replyToEmail = '';
  if (!empty($hdr->reply_to) && is_array($hdr->reply_to)) {
    $r = $hdr->reply_to[0];
    $replyToName = hm_imap_decode_mime((string)($r->personal ?? ''));
    $mbox = (string)($r->mailbox ?? ''); $host = (string)($r->host ?? '');
    if ($mbox !== '' && $host !== '') $replyToEmail = $mbox . '@' . $host;
  }

  // In-Reply-To / References — regex the raw header (parse_headers is inconsistent).
  $inReplyTo = '';
  if (preg_match('/^In-Reply-To:\s*(.+)$/im', $rawHeader, $m)) {
    $ids = hm_imap_ids_from(trim($m[1]));
    $inReplyTo = $ids[0] ?? '';
  }
  $references = [];
  if (preg_match_all('/^References:\s*(.+(?:\r?\n[ \t].+)*)$/im', $rawHeader, $mm)) {
    foreach ($mm[1] as $line) $references = array_merge($references, hm_imap_ids_from($line));
    $references = array_values(array_unique($references));
  }

  // Received time from the Date header (udate), fallback now.
  $udate = isset($hdr->date) ? (int)@strtotime((string)$hdr->date) : 0;
  if ($udate <= 0) $udate = time();

  [$text, $html] = hm_imap_bodies($imap, $uid);

  return [
    'uid'         => $uid,
    'message_id'  => $messageId,
    'in_reply_to' => $inReplyTo,
    'references'  => $references,
    'from_name'      => $fromName,
    'from_email'     => $fromEmail,
    'reply_to_name'  => $replyToName,
    'reply_to_email' => $replyToEmail,
    'subject'     => $subject,
    'body_text'   => $text,
    'body_html'   => $html,
    'udate'       => $udate,
    'received_at' => date('Y-m-d H:i:s', $udate),
  ];
}

} // end if (!function_exists('hm_imap_available'))
