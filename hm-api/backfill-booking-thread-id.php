<?php
// ════════════════════════════════════════════════════════════════════════════
//  backfill-booking-thread-id.php — one-time repair for booking notification rows
//  that were inserted WITHOUT a thread_id (create-booking.php / booking-status.php
//  before the fix). Those rows grouped under the raw booking_id in the Ops
//  Communication Center, so the derived threadId was empty and quote Save failed
//  with "missing thread_id".
//
//  WHAT IT DOES — for every booking@ notification row missing a thread_id, stamp
//  the canonical conversation key thread_id = 'chat:<booking_id>' (the same key
//  chat.php / the Communication Center use). Rows with no labels are also flagged
//  labels.internal so they stay staff-only (chat.php skips internal rows — the
//  customer portal chat is unchanged; the customer is notified by email).
//
//  SCOPE (deliberately narrow): only rows where
//      mailbox    = 'booking@hello-moving.com'   (the notification channel)
//      thread_id  IS NULL
//      booking_id IS NOT NULL
//  Inbound customer email (receive-email.php) and any already-threaded row are
//  left untouched. Existing labels are NEVER overwritten (only NULL/empty ones
//  get the internal flag).
//
//  SAFETY (this touches PRODUCTION data):
//    • DRY-RUN by default — prints the count + a sample of what WOULD change.
//      Nothing is written unless you pass --apply.
//    • Idempotent: once thread_id is set the WHERE no longer matches, so it is
//      safe to re-run (a second run reports 0 rows).
//    • Single transaction (all-or-nothing) on --apply.
//    • CLI-only: refuses to run over HTTP.
//
//  USAGE (from the cPanel account shell / SSH):
//    php hm-api/backfill-booking-thread-id.php            # dry run (preview)
//    php hm-api/backfill-booking-thread-id.php --apply    # perform the backfill
//
//  EXIT CODE: 0 on success (incl. a dry run), 1 on error.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
  http_response_code(403);
  header('Content-Type: text/plain; charset=utf-8');
  echo "Forbidden: run this from the command line.\n";
  exit(1);
}

$apply = in_array('--apply', $argv, true);

require_once __DIR__ . '/_db.php';   // pulls _lib.php → hm_config() → _config.php

// The exact set of rows the fix targets. Keep this WHERE identical between the
// preview SELECT and the UPDATE so the dry run reflects reality.
$WHERE = "mailbox = 'booking@hello-moving.com'
            AND thread_id IS NULL
            AND booking_id IS NOT NULL";

$db = hm_db();

try {
  // ── Preview ────────────────────────────────────────────────────────────────
  $cnt = (int) $db->query("SELECT COUNT(*) FROM inbox_messages WHERE $WHERE")->fetchColumn();

  fwrite(STDOUT, ($apply ? "APPLY" : "DRY-RUN") . " — booking notification rows missing thread_id: $cnt\n");

  if ($cnt === 0) {
    fwrite(STDOUT, "Nothing to backfill. (Already repaired, or no matching rows.)\n");
    exit(0);
  }

  // Show up to 10 examples of what will change.
  $sample = $db->query(
    "SELECT id, booking_id, subject, received_at, created_at,
            (labels IS NULL OR labels = '') AS labels_empty
       FROM inbox_messages
      WHERE $WHERE
      ORDER BY COALESCE(received_at, created_at) DESC
      LIMIT 10"
  )->fetchAll(PDO::FETCH_ASSOC);

  fwrite(STDOUT, "\nSample (up to 10):\n");
  foreach ($sample as $r) {
    $subj = (string)($r['subject'] ?? '');
    if (function_exists('mb_strimwidth')) $subj = mb_strimwidth($subj, 0, 48, '…');
    $when = (string)($r['received_at'] ?? $r['created_at'] ?? '');
    fwrite(STDOUT, sprintf(
      "  • %s  booking=%s  → thread_id=chat:%s%s  [%s]  %s\n",
      substr((string)$r['id'], 0, 8),
      (string)$r['booking_id'],
      (string)$r['booking_id'],
      ((int)$r['labels_empty'] === 1 ? '  +labels.internal' : ''),
      $when,
      $subj
    ));
  }

  if (!$apply) {
    fwrite(STDOUT, "\nDry run only. Re-run with --apply to write these changes.\n");
    exit(0);
  }

  // ── Apply ────────────────────────────────────────────────────────────────────
  $db->beginTransaction();
  $upd = $db->prepare(
    "UPDATE inbox_messages
        SET thread_id = CONCAT('chat:', booking_id),
            labels    = CASE WHEN labels IS NULL OR labels = ''
                             THEN '{\"internal\":true}'
                             ELSE labels END
      WHERE $WHERE"
  );
  $upd->execute();
  $affected = $upd->rowCount();
  $db->commit();

  if (function_exists('hm_cache_invalidate_table')) hm_cache_invalidate_table('inbox_messages');

  fwrite(STDOUT, "\nBackfilled $affected row(s). Done.\n");
  exit(0);

} catch (Throwable $e) {
  if ($db->inTransaction()) $db->rollBack();
  fwrite(STDERR, "ERROR: " . $e->getMessage() . "\n");
  exit(1);
}
