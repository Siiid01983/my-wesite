<?php
// ════════════════════════════════════════════════════════════════════════════
//  _contact.php — shared Contact Chat helpers (side-effect-free library)
//
//  Extracted from contact-chat.php so the SAME message-insert + company-reply
//  behavior can be reused by the scoped worker endpoint (conversations.php)
//  WITHOUT duplicating the notify/active-rule logic and WITHOUT executing the
//  contact-chat.php action dispatcher on include. Defining-only: requiring this
//  file runs no endpoint code.
//
//  Depends on _lib.php (hm_uuid4, hm_cache_invalidate_table, hm_log_error) and,
//  for cc_do_admin_reply's optional email, the EmailService class (guarded by the
//  caller-supplied $emailReady flag). Functions are guarded with function_exists
//  so double-inclusion (both endpoints requiring it) is safe.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

if (!function_exists('cc_thread')) {
  // The stable conversation key for a Contact Chat code. All of a conversation's
  // inbox_messages rows share thread_id = 'contact:<CODE>'.
  function cc_thread(string $code): string { return 'contact:' . $code; }
}

if (!function_exists('cc_insert_message')) {
  // Insert one message row into the conversation's thread. $out = admin/company.
  // $attachments (optional, Phase 1) is an already-VALIDATED list of
  // {path,name,mime,size} stored in the EXISTING labels.attachments JSON — the same
  // no-migration pattern chat.php uses for booking-chat media.
  function cc_insert_message(PDO $db, string $code, string $category, string $name,
                             string $email, string $body, bool $out, string $mailbox,
                             array $attachments = []): string {
    $mid    = '<contact-' . hm_uuid4() . '@hello-moving.com>';
    $labels = ['contact' => true, 'cid' => $code, 'category' => $category];
    if ($out) { $labels['outbound'] = true; $labels['chat'] = true; }
    if ($attachments) $labels['attachments'] = $attachments;
    $st = $db->prepare(
      'INSERT INTO inbox_messages
         (id, sender, sender_name, email, subject, body, body_text, mailbox,
          message_id, thread_id, labels, received_at, is_read, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, NOW(), ?, \'open\')'
    );
    $st->execute([
      hm_uuid4(), $name, $name, $email,
      'お問い合わせ（' . $code . '）', $body, $body, $mailbox,
      $mid, cc_thread($code), json_encode($labels, JSON_UNESCAPED_UNICODE),
      $out ? 1 : 0,
    ]);
    return $mid;
  }
}

if (!function_exists('cc_clean_attachments')) {
  // Validate a staff-supplied attachment list for a Contact Chat reply. Mirrors
  // chat.php::chat_clean_attachments EXACTLY (same MIME allow-list, same traversal
  // guard, same 10-item cap) but scopes the path to THIS conversation's own folder
  // ('contact/<CODE>/…') so a reply can never reference another conversation's or an
  // arbitrary file. Returns the sanitised list to persist in labels.attachments.
  function cc_clean_attachments($raw, string $code, array $allowedMime): array {
    if (!is_array($raw)) return [];
    $prefix = 'contact/' . $code . '/';
    $out = [];
    foreach ($raw as $a) {
      if (!is_array($a)) continue;
      $path = str_replace('\\', '/', trim((string)($a['path'] ?? '')));
      if ($path === '' || strpos($path, '..') !== false) continue;
      if (strncmp($path, $prefix, strlen($prefix)) !== 0) continue;   // must be THIS conversation's file
      $mime = strtolower(trim((string)($a['mime'] ?? '')));
      if ($mime !== '' && !in_array($mime, $allowedMime, true)) continue;
      $out[] = [
        'path' => $path,
        'name' => mb_substr(trim((string)($a['name'] ?? 'file')), 0, 200),
        'mime' => $mime,
        'size' => (int)($a['size'] ?? 0),
      ];
      if (count($out) >= 10) break;
    }
    return $out;
  }
}

if (!function_exists('cc_sign_url')) {
  // Short-lived HMAC-signed read URL for a private `chat`-bucket file — identical
  // scheme to storage.php's `sign`/`get`, so customers (and Ops) can view Contact
  // Chat attachments without a public bucket. Same secret, same signature string.
  function cc_storage_url(): string {
    $https  = (($_SERVER['HTTPS'] ?? '') === 'on') || (($_SERVER['SERVER_PORT'] ?? '') == 443);
    $scheme = $https ? 'https' : 'http';
    $dir    = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/hm-api/contact-chat.php'))), '/');
    return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/storage.php';
  }
  function cc_sign_url(string $path, string $secret, int $ttl = 300): string {
    $bucket = 'chat';
    $exp = time() + $ttl;
    $sig = hash_hmac('sha256', "$bucket/$path:$exp", $secret);
    return cc_storage_url() . '?action=get&bucket=' . rawurlencode($bucket)
         . '&path=' . rawurlencode($path) . '&exp=' . $exp . '&sig=' . $sig;
  }
}

if (!function_exists('cc_do_admin_reply')) {
  // Shared reply core — a staff company reply into a Contact Chat thread. Byte-for-
  // byte the behavior action=admin-reply used:
  //   • append an OUTBOUND company message (the sender shown to the customer stays
  //     "Hello Moving" — staff identity is NEVER exposed to the customer);
  //   • roll last_admin_activity / updated_at / retention;
  //   • email the customer ONLY when they are not recently active (active rule).
  // The caller supplies the already-loaded contact_conversations $row and has
  // already AUTHORIZED the actor (admin/manager inline gate, or the worker
  // conversation-access gate). Returns ['emailed'=>bool,'notify'=>string]. Throws on
  // a DB error (caller maps to 500).
  function cc_do_admin_reply(PDO $db, array $cfg, array $row, string $code, string $message,
                             int $retentionDays, int $activeWindow, string $siteUrl,
                             string $mailbox, bool $emailReady, array $attachments = []): array {
    $category = (string)($row['category'] ?? '');
    // Attachment-only reply → a placeholder body so the admin Inbox / thread list is
    // never blank (mirrors chat.php); the display layer hides this text.
    $body = $message !== '' ? $message : ($attachments ? '[' . count($attachments) . '件の添付ファイルを送信しました]' : '');
    cc_insert_message($db, $code, $category, 'Hello Moving', (string)$row['email'], $body, true, $mailbox, $attachments);
    $db->prepare(
      'UPDATE contact_conversations
          SET last_admin_activity = NOW(), updated_at = NOW(),
              expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)
        WHERE id = ?'
    )->execute([$retentionDays, (string)$row['id']]);
    hm_cache_invalidate_table('inbox_messages');

    $lastActTs = !empty($row['last_customer_activity']) ? (int)strtotime((string)$row['last_customer_activity']) : 0;
    $isActive  = $lastActTs > 0 && (time() - $lastActTs) < $activeWindow;
    $emailed   = false; $reason = $isActive ? 'customer_active' : 'no_mailer';

    if (!$isActive && $emailReady && class_exists('EmailService')) {
      $acc      = EmailService::account($cfg, 'contact');
      $bodyText = ($message !== '' ? $message : '添付ファイルをお送りしました。チャットからご確認ください。')
        . "\n\n────────────\n"
        . "お問い合わせ番号：{$code}\n"
        . "この番号とご登録のメールアドレスで、いつでもお問い合わせを再開できます。\n{$siteUrl}";
      $html = EmailService::customerHtml($acc, $bodyText, '');
      $res  = EmailService::deliver($cfg, [
        'account' => 'contact',
        'to'      => (string)$row['email'],
        'subject' => '[Hello Moving] お問い合わせへのご返信（' . $code . '）',
        'html'    => $html,
        'text'    => $bodyText,
      ]);
      $emailed = (bool)($res['ok'] ?? false);
      $reason  = $emailed ? 'emailed' : 'email_failed';
      if (!$emailed) {
        hm_log_error('contact reply email failed', ['code' => $code, 'err' => $res['error_raw'] ?? $res['error'] ?? '']);
      }
    }
    return ['emailed' => $emailed, 'notify' => $reason];
  }
}
