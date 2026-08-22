<?php
// ════════════════════════════════════════════════════════════════════════════
//  cleanup-test-data.php — CLI-ONLY removal of test Contact / Contact-Chat data.
//
//  Deletes rows created by end-to-end tests directly against the DB (it runs on
//  the server with _config.php, so it needs NO admin token and NO HTTP call). It
//  removes, for a given MATCH TOKEN:
//    • inbox_messages rows whose subject/body/sender contain the token, AND every
//      message in a Contact Chat thread whose conversation matches the token.
//    • contact_conversations rows whose customer_name/category contain the token
//      (a HARD delete — rest.php cannot do this; retention would take 180 days).
//
//  SAFETY (this touches PRODUCTION data):
//    • DRY-RUN by default — prints exactly what WOULD be deleted. Nothing is
//      removed unless you pass --apply.
//    • A non-empty match token of >= 4 chars is REQUIRED, so an empty/loose token
//      can never match (and delete) everything. LIKE wildcards in the token are
//      escaped, so the token is matched literally.
//    • All deletes run in a single transaction (all-or-nothing).
//    • CLI-only: refuses to run over HTTP.
//
//  USAGE (from the cPanel account shell / SSH):
//    php hm-api/cleanup-test-data.php "E2E-1787388688"           # dry run
//    php hm-api/cleanup-test-data.php "E2E-1787388688" --apply   # delete
//    php hm-api/cleanup-test-data.php "[TEST]" --apply           # broader token
//
//  Pick the NARROWEST token that identifies your test rows (e.g. the unique
//  run id printed by the test) to avoid catching anything real.
//
//  EXIT CODE: 0 on success (incl. a dry run), 1 on error / bad usage.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
  http_response_code(403);
  header('Content-Type: text/plain; charset=utf-8');
  echo "Forbidden: run this from the command line.\n";
  exit(1);
}

$token = isset($argv[1]) ? trim((string)$argv[1]) : '';
$apply = in_array('--apply', array_slice($argv, 2), true)
      || in_array('--apply', $argv, true);

if ($token === '' || strlen($token) < 4) {
  fwrite(STDERR, "Usage: php hm-api/cleanup-test-data.php <match-token (>=4 chars)> [--apply]\n");
  fwrite(STDERR, "Refusing to run without a specific match token (safety).\n");
  exit(1);
}

// Display-only truncation; uses mbstring when present, plain substr otherwise.
$trunc = function (string $s, int $w): string {
  if (function_exists('mb_strimwidth')) return mb_strimwidth($s, 0, $w, '…');
  return strlen($s) > $w ? substr($s, 0, $w - 1) . '…' : $s;
};

require_once __DIR__ . '/_db.php';   // pulls _lib.php → hm_config() → _config.php

// Escape LIKE wildcards so the token matches literally (ESCAPE '\' below).
$esc  = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $token);
$like = '%' . $esc . '%';

$db = hm_db();

// ── 1. Find matching Contact Chat conversations (by name/category) ────────────
$convSql = "SELECT public_contact_id, customer_name, email, status
              FROM contact_conversations
             WHERE customer_name LIKE ? ESCAPE '\\\\'
                OR category      LIKE ? ESCAPE '\\\\'";
$convs = [];
try {
  $st = $db->prepare($convSql);
  $st->execute([$like, $like]);
  $convs = $st->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
  // contact_conversations may not exist on a fresh install — treat as "none".
  $convs = [];
}
$codes   = array_values(array_filter(array_map(fn($r) => (string)$r['public_contact_id'], $convs)));
$threads = array_map(fn($c) => 'contact:' . $c, $codes);

// ── 2. Find matching inbox_messages (token in text fields, or in a matched thread)
$msgWhere = "(subject LIKE ? ESCAPE '\\\\'
           OR COALESCE(body_text,'') LIKE ? ESCAPE '\\\\'
           OR COALESCE(body,'')      LIKE ? ESCAPE '\\\\'
           OR COALESCE(sender_name,'') LIKE ? ESCAPE '\\\\'
           OR COALESCE(sender,'')      LIKE ? ESCAPE '\\\\')";
$msgArgs  = [$like, $like, $like, $like, $like];
if ($threads) {
  $ph        = implode(',', array_fill(0, count($threads), '?'));
  $msgWhere .= " OR thread_id IN ($ph)";
  $msgArgs   = array_merge($msgArgs, $threads);
}

$msgs = [];
try {
  $st = $db->prepare("SELECT id, subject, mailbox, thread_id, created_at FROM inbox_messages WHERE $msgWhere");
  $st->execute($msgArgs);
  $msgs = $st->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
  fwrite(STDERR, 'Query failed: ' . $e->getMessage() . "\n");
  exit(1);
}

// ── Report what matched ──────────────────────────────────────────────────────
echo "Match token : \"$token\"" . ($apply ? '  [APPLY]' : '  [DRY RUN]') . "\n";
echo "─────────────────────────────────────────────\n";
echo 'inbox_messages matched      : ' . count($msgs) . "\n";
foreach (array_slice($msgs, 0, 20) as $m) {
  echo '  · ' . substr((string)$m['id'], 0, 8) . '  ' . ($m['thread_id'] ?: '-')
     . '  ' . $trunc((string)($m['subject'] ?? ''), 60) . "\n";
}
if (count($msgs) > 20) echo '  … and ' . (count($msgs) - 20) . " more\n";
echo 'contact_conversations matched: ' . count($convs) . "\n";
foreach ($convs as $c) {
  echo '  · ' . $c['public_contact_id'] . '  ' . ($c['email'] ?? '')
     . '  (' . ($c['status'] ?? '') . ')  '
     . $trunc((string)($c['customer_name'] ?? ''), 40) . "\n";
}
echo "─────────────────────────────────────────────\n";

if (!count($msgs) && !count($convs)) {
  echo "Nothing matched — nothing to do.\n";
  exit(0);
}

if (!$apply) {
  echo "DRY RUN — no rows deleted. Re-run with --apply to delete the above.\n";
  exit(0);
}

// ── Delete (transactional) ───────────────────────────────────────────────────
try {
  $db->beginTransaction();

  $delMsg = $db->prepare("DELETE FROM inbox_messages WHERE $msgWhere");
  $delMsg->execute($msgArgs);
  $nMsg = $delMsg->rowCount();

  $nConv = 0;
  if ($convs) {
    $delConv = $db->prepare(
      "DELETE FROM contact_conversations
         WHERE customer_name LIKE ? ESCAPE '\\\\' OR category LIKE ? ESCAPE '\\\\'"
    );
    $delConv->execute([$like, $like]);
    $nConv = $delConv->rowCount();
  }

  $db->commit();
  echo "Deleted inbox_messages       : $nMsg\n";
  echo "Deleted contact_conversations: $nConv\n";
  echo "Done.\n";
  exit(0);
} catch (Throwable $e) {
  if ($db->inTransaction()) $db->rollBack();
  fwrite(STDERR, 'Delete failed (rolled back): ' . $e->getMessage() . "\n");
  exit(1);
}
