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
  function cc_insert_message(PDO $db, string $code, string $category, string $name,
                             string $email, string $body, bool $out, string $mailbox): string {
    $mid    = '<contact-' . hm_uuid4() . '@hello-moving.com>';
    $labels = ['contact' => true, 'cid' => $code, 'category' => $category];
    if ($out) { $labels['outbound'] = true; $labels['chat'] = true; }
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
                             string $mailbox, bool $emailReady): array {
    $category = (string)($row['category'] ?? '');
    cc_insert_message($db, $code, $category, 'Hello Moving', (string)$row['email'], $message, true, $mailbox);
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
      $bodyText = $message
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
