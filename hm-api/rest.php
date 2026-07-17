<?php
// ════════════════════════════════════════════════════════════════════════════
//  rest.php — generic, PostgREST-compatible data endpoint
//
//  The browser-side client (js/lib/apiClient.js) POSTs a JSON "spec" here and
//  receives a { data, error } envelope. All identifiers (table,
//  columns, filter/order columns) are validated against the allowlist below, so
//  only bound parameters ever reach MySQL — no SQL injection surface.
//
//  Request body:
//  {
//    table, action: select|insert|upsert|update|delete,
//    columns: "*" | "a,b",
//    filters: [ { col, op, val, negate? } ],   op: eq neq gt gte lt lte like ilike in is
//    order:   [ { col, ascending } ],
//    limit:   int|null,
//    single:  false | "maybe" | "one",
//    values:  row | [rows],          (insert/upsert/update)
//    onConflict: "reference_id",     (upsert)
//    returning: bool                 (whether to return affected rows)
//  }
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_cache.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/_slots.php';   // Phase 2 (slice 2): slot sync (feature-flagged, OFF by default)
hm_cors();
hm_require_api_key();
// Authenticated data API: the admin/portal SPA legitimately bursts many reads on
// load (initial sync + 12s realtime poll across several tables), so this is set
// well above the 20/min "general" tier to throttle abuse without breaking the
// app. Tune via _config.php rate_limit_* if needed.
hm_rate_limit('data', 300, 60);

// ── Table allowlist: columns + type hints + pk strategy + unique keys ─────────
$SCHEMA = [
  'hm_data' => [
    'cols' => ['id','key','value','updated_at'],
    'json' => ['value'], 'bool' => [], 'int' => [],
    'uuid_pk' => true, 'unique' => ['key'],
  ],
  'bookings' => [
    'cols' => ['id','customer_name','customer_email','customer_phone','booking_date','start_at','end_at','preferred_start_1','preferred_start_2','service_id','status','notes','items','created_at','updated_at'],
    'json' => ['items'], 'bool' => [], 'int' => [],
    'uuid_pk' => true, 'unique' => ['id'],
  ],
  'calendar_availability' => [
    'cols' => ['id','date','status','updated_at'],
    'json' => [], 'bool' => [], 'int' => [],
    'uuid_pk' => true, 'unique' => ['date'],
  ],
  'reviews' => [
    'cols' => ['id','reference_id','customer_name','rating','review_text','approved','published','headline','service','date_label','location','source','booking_reference','created_at'],
    'json' => [], 'bool' => ['approved','published'], 'int' => ['rating'],
    'uuid_pk' => true, 'unique' => ['reference_id'],
  ],
  'services' => [
    'cols' => ['id','reference_id','title','description','display_order','active','badge','cta_text'],
    'json' => [], 'bool' => ['active'], 'int' => ['display_order'],
    'uuid_pk' => true, 'unique' => ['reference_id'],
  ],
  'blog_posts' => [
    'cols' => ['id','reference_id','slug','title','content','excerpt','featured_image','categories','tags','status','featured','author','author_bio','scheduled_at','published_at','created_at','updated_at'],
    'json' => ['categories','tags'], 'bool' => ['featured'], 'int' => [],
    'uuid_pk' => true, 'unique' => ['reference_id'],
  ],
  'communications' => [
    'cols' => ['id','booking_id','customer_email','sender_email','subject','message','direction','created_at','created_by','email_status','email_error','sent_at'],
    'json' => [], 'bool' => [], 'int' => ['id'],
    'uuid_pk' => false, 'unique' => ['id'],
  ],
  'inbox_messages' => [
    'cols' => ['id','sender','email','subject','body','booking_id','created_at',
               'mailbox','body_html','body_text','message_id','in_reply_to','thread_id',
               'is_read','starred','archived','status','assignee','labels',
               'sender_name','received_at'],
    'json' => ['labels'], 'bool' => ['is_read','starred','archived'], 'int' => [],
    'uuid_pk' => true, 'unique' => ['id'],
  ],
  'audit_log' => [
    'cols' => ['id','created_at','actor','action','target_type','target_id','details'],
    'json' => [], 'bool' => [], 'int' => [],
    'uuid_pk' => true, 'unique' => ['id'],
  ],
];

$OPS = [
  'eq' => '=', 'neq' => '<>', 'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<=',
  'like' => 'LIKE', 'ilike' => 'LIKE',
];

$req   = hm_body(true);
$table = (string)($req['table'] ?? '');
if (!isset($SCHEMA[$table])) hm_err('Unknown table: ' . $table, 400, 'bad_table');
$S      = $SCHEMA[$table];
$action = (string)($req['action'] ?? 'select');

// ── Admin authorization gate (additive; enforced only when admin_auth_enabled) ─
// Customer/portal writes — bookings update, reviews/communications/audit_log
// insert+update — stay on the API-key gate above. Admin-only operations require
// a valid server admin session token (X-ADMIN-TOKEN from admin-session.php):
//   • ANY delete (the portal never deletes via rest.php)
//   • insert/upsert/update on admin-only tables (site content/services/calendar/inbox)
// hm_require_admin() is a no-op while enforcement is disabled, so this changes
// nothing until the server flips admin_auth_enabled on.
// RC-D — content-write protection. These tables hold site content and must never
// be mutable with only the page-served (public) API key. Writes now require a
// valid staff token via hm_require_staff_write() EVEN WHEN admin_auth_enabled is
// off. Reads stay fully public (no gate on 'select').
//   • FULL gate  → every write (insert/upsert/update/delete) needs staff.
//   • MODERATION → reviews: INSERT stays public (customer/portal submissions),
//                  but upsert/update/delete (approve/publish/edit) need staff.
$CONTENT_TABLES_FULL = ['hm_data', 'services', 'calendar_availability', 'inbox_messages', 'blog_posts'];
$CONTENT_TABLES_MOD  = ['reviews'];
if ($action === 'delete') {
  hm_require_staff_write();                                   // no public deletes, any table
} elseif (in_array($action, ['insert', 'upsert', 'update'], true)) {
  if (in_array($table, $CONTENT_TABLES_FULL, true)) {
    hm_require_staff_write();
  } elseif (in_array($table, $CONTENT_TABLES_MOD, true) && $action !== 'insert') {
    hm_require_staff_write();                                 // reviews moderation only
  }
}
// RC-E — read protection for tables holding customer PII / internal data. SELECT
// on these now requires a valid staff token (the same identity ops/admin already
// send: apiClient always attaches X-ADMIN-TOKEN). The page-served public API key
// can no longer read customer data. Fails CLOSED. Customer-facing reads use the
// ownership-gated endpoints: customer-bookings.php / customer-profile.php /
// portal-communications.php.
$SENSITIVE_READ_TABLES = ['bookings', 'communications', 'inbox_messages', 'audit_log'];
if ($action === 'select' && in_array($table, $SENSITIVE_READ_TABLES, true)) {
  hm_require_staff_read();
}

$db     = hm_db();

// ── helpers ──────────────────────────────────────────────────────────────────
$qid = fn(string $c) => '`' . str_replace('`', '', $c) . '`';   // safe (already allowlisted)
$valid_col = fn(string $c) => in_array($c, $S['cols'], true);

function cast_row(array $row, array $S): array {
  foreach ($S['json'] as $c) if (isset($row[$c]) && is_string($row[$c])) {
    $dec = json_decode($row[$c], true); if ($dec !== null || $row[$c] === 'null') $row[$c] = $dec;
  }
  foreach ($S['bool'] as $c) if (array_key_exists($c, $row) && $row[$c] !== null) $row[$c] = (bool)(int)$row[$c];
  foreach ($S['int']  as $c) if (array_key_exists($c, $row) && $row[$c] !== null) $row[$c] = (int)$row[$c];
  return $row;
}

// Prepare a value for binding given its column type.
function enc_val(string $col, $val, array $S) {
  if (in_array($col, $S['json'], true)) return json_encode($val, JSON_UNESCAPED_UNICODE);
  if (in_array($col, $S['bool'], true)) return $val === null ? null : (int)(bool)$val;
  return $val;
}

// Build WHERE from filters. Returns [sql, params].
function build_where(array $filters, array $S, array $OPS, callable $qid, callable $valid_col): array {
  $clauses = []; $params = [];
  foreach ($filters as $f) {
    $col = (string)($f['col'] ?? ''); $op = (string)($f['op'] ?? 'eq');
    if (!$valid_col($col)) continue;
    $neg = !empty($f['negate']);
    $val = $f['val'] ?? null;

    if ($op === 'in') {
      $arr = is_array($val) ? $val : [$val];
      if (!$arr) { $clauses[] = $neg ? '1=1' : '1=0'; continue; }
      $ph = implode(',', array_fill(0, count($arr), '?'));
      $clauses[] = ($neg ? 'NOT ' : '') . $qid($col) . " IN ($ph)";
      foreach ($arr as $v) $params[] = $v;
    } elseif ($op === 'is') {
      if ($val === null) {
        $clauses[] = $qid($col) . ($neg ? ' IS NOT NULL' : ' IS NULL');
      } else {
        $clauses[] = $qid($col) . ($neg ? ' <> ?' : ' = ?'); $params[] = (int)(bool)$val;
      }
    } elseif (isset($OPS[$op])) {
      $sql = $qid($col) . ' ' . $OPS[$op] . ' ?';
      $clauses[] = $neg ? "NOT ($sql)" : $sql;
      $params[] = ($op === 'like' || $op === 'ilike') ? $val : $val;
    }
  }
  return [$clauses ? (' WHERE ' . implode(' AND ', $clauses)) : '', $params];
}

// Phase 2 (slice 2) slot synchronisation gate. TRUE only when the feature flag
// is ON *and* the write targets the bookings table. When FALSE, every branch
// below runs its ORIGINAL statements unchanged — production behaviour is
// byte-for-byte identical while slot_lock_enabled is OFF.
$slotSync = hm_slot_lock_enabled() && $table === 'bookings';

try {
  // ════════════════════════════ SELECT ══════════════════════════════════════
  if ($action === 'select') {
    $cols = '*';
    $req_cols = trim((string)($req['columns'] ?? '*'));
    if ($req_cols !== '' && $req_cols !== '*') {
      $picked = array_filter(array_map('trim', explode(',', $req_cols)), $valid_col);
      if ($picked) $cols = implode(',', array_map($qid, $picked));
    }
    [$where, $params] = build_where($req['filters'] ?? [], $S, $OPS, $qid, $valid_col);

    $order = '';
    if (!empty($req['order']) && is_array($req['order'])) {
      $parts = [];
      foreach ($req['order'] as $o) {
        $c = (string)($o['col'] ?? ''); if (!$valid_col($c)) continue;
        $parts[] = $qid($c) . ((isset($o['ascending']) && !$o['ascending']) ? ' DESC' : ' ASC');
      }
      if ($parts) $order = ' ORDER BY ' . implode(',', $parts);
    }
    $limit = '';
    if (isset($req['limit']) && is_numeric($req['limit'])) $limit = ' LIMIT ' . (int)$req['limit'];

    // Aggregate count: .select('*', { count:'exact', head:true })
    $count = null;
    if (!empty($req['count'])) {
      $cs = $db->prepare('SELECT COUNT(*) AS c FROM ' . $qid($table) . $where);
      $cs->execute($params);
      $count = (int)($cs->fetch()['c'] ?? 0);
      if (!empty($req['head'])) hm_json(['ok' => true, 'data' => null, 'count' => $count, 'error' => null], 200);
    }

    $st = $db->prepare("SELECT $cols FROM " . $qid($table) . "$where$order$limit");
    $st->execute($params);
    $rows = array_map(fn($r) => cast_row($r, $S), $st->fetchAll());
    if ($count !== null) hm_json(['ok' => true, 'data' => array_values($rows), 'count' => $count, 'error' => null], 200);
    return finish_rows($rows, $req);
  }

  // ════════════════════════════ INSERT / UPSERT ═════════════════════════════
  if ($action === 'insert' || $action === 'upsert') {
    $values = $req['values'] ?? [];
    $rows = (is_array($values) && array_keys($values) === range(0, count($values) - 1)) ? $values : [$values];
    if (!$rows) hm_ok([]);

    // Slot sync applies to a true INSERT of bookings only (not upsert). Reserve
    // each row's slot inside ONE transaction with the insert(s):
    //   reserve → insert → commit ; a slot collision rolls back → NO booking.
    $slotIns = $slotSync && $action === 'insert';
    if ($slotIns) $db->beginTransaction();
    try {
      $generated = [];   // ids/unique values to re-select for "returning"
      foreach ($rows as $row) {
        $data = [];
        foreach ($row as $c => $v) if ($valid_col($c)) $data[$c] = enc_val($c, $v, $S);
        if ($S['uuid_pk'] && empty($data['id'])) $data['id'] = hm_uuid4();

        $cols = array_keys($data);
        $ph   = implode(',', array_fill(0, count($cols), '?'));
        $sql  = 'INSERT INTO ' . $qid($table) . ' (' . implode(',', array_map($qid, $cols)) . ") VALUES ($ph)";

        if ($action === 'upsert') {
          $confCol = (string)($req['onConflict'] ?? ($S['unique'][0] ?? 'id'));
          $upd = [];
          foreach ($cols as $c) if ($c !== 'id' && $c !== $confCol) $upd[] = $qid($c) . '=VALUES(' . $qid($c) . ')';
          if ($upd) $sql .= ' ON DUPLICATE KEY UPDATE ' . implode(',', $upd);
          else      $sql .= ' ON DUPLICATE KEY UPDATE ' . $qid($confCol) . '=VALUES(' . $qid($confCol) . ')';
        }

        if ($slotIns) {   // reserve BEFORE the booking insert, same transaction
          $res = hm_slot_reserve($db, (string)($data['booking_date'] ?? ''), hm_slot_time_from_notes($data['notes'] ?? ''), (string)($data['id'] ?? ''));
          if (!empty($res['conflict'])) { $db->rollBack(); hm_err('slot_taken', 409, 'slot_taken'); }
        }

        $st = $db->prepare($sql);
        $st->execute(array_values($data));

        // Track how to fetch the affected row back.
        if (!$S['uuid_pk']) $generated[] = ['col' => 'id', 'val' => (int)$db->lastInsertId()];
        elseif (isset($data['id'])) $generated[] = ['col' => 'id', 'val' => $data['id']];
      }
      if ($slotIns) $db->commit();
    } catch (Throwable $e) {
      if ($slotIns && $db->inTransaction()) $db->rollBack();
      throw $e;
    }

    hm_cache_invalidate_table($table);
    if (empty($req['returning'])) hm_ok([]);
    return finish_returning($db, $table, $S, $generated, $qid, $req);
  }

  // ════════════════════════════ UPDATE ══════════════════════════════════════
  if ($action === 'update') {
    $patch = $req['values'] ?? [];
    $set = []; $setParams = [];
    foreach ($patch as $c => $v) if ($valid_col($c) && $c !== 'id') { $set[] = $qid($c) . '=?'; $setParams[] = enc_val($c, $v, $S); }
    if (!$set) hm_err('No valid columns to update', 400, 'no_cols');
    [$where, $whereParams] = build_where($req['filters'] ?? [], $S, $OPS, $qid, $valid_col);
    if ($where === '') hm_err('UPDATE requires a filter', 400, 'no_filter');

    if ($slotSync) {
      // Reschedule lock-move (+ cancel release), atomic per affected booking:
      //   release old slot → reserve new slot → UPDATE booking → commit.
      // FOR UPDATE locks the target rows for the duration of the transaction.
      $db->beginTransaction();
      try {
        $sel = $db->prepare('SELECT `id`,`booking_date`,`notes`,`status` FROM ' . $qid($table) . $where . ' FOR UPDATE');
        $sel->execute($whereParams);
        foreach ($sel->fetchAll() as $b) {
          $newStatus = array_key_exists('status', $patch)       ? (string)$patch['status']       : (string)($b['status'] ?? '');
          $newDate   = array_key_exists('booking_date', $patch) ? (string)$patch['booking_date'] : (string)($b['booking_date'] ?? '');
          $newNotes  = array_key_exists('notes', $patch)        ? (string)$patch['notes']        : (string)($b['notes'] ?? '');
          hm_slot_release($db, (string)$b['id']);              // free whatever this booking held (no-op if none)
          $cancelled = in_array($newStatus, ['cancelled', 'キャンセル'], true);
          if (!$cancelled) {                                   // re-reserve at the (possibly new) date/band
            $res = hm_slot_reserve($db, $newDate, hm_slot_time_from_notes($newNotes), (string)$b['id']);
            if (!empty($res['conflict'])) { $db->rollBack(); hm_err('slot_taken', 409, 'slot_taken'); }
          }
        }
        $st = $db->prepare('UPDATE ' . $qid($table) . ' SET ' . implode(',', $set) . $where);
        $st->execute(array_merge($setParams, $whereParams));
        $db->commit();
      } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
      }
    } else {
      $st = $db->prepare('UPDATE ' . $qid($table) . ' SET ' . implode(',', $set) . $where);
      $st->execute(array_merge($setParams, $whereParams));
    }

    hm_cache_invalidate_table($table);
    if (empty($req['returning'])) hm_ok([]);
    $st2 = $db->prepare('SELECT * FROM ' . $qid($table) . $where);
    $st2->execute($whereParams);
    return finish_rows(array_map(fn($r) => cast_row($r, $S), $st2->fetchAll()), $req);
  }

  // ════════════════════════════ DELETE ══════════════════════════════════════
  if ($action === 'delete') {
    [$where, $params] = build_where($req['filters'] ?? [], $S, $OPS, $qid, $valid_col);
    if ($where === '') hm_err('DELETE requires a filter', 400, 'no_filter');

    $returned = [];
    if ($slotSync) {
      // Delete-orphan prevention, atomic: delete booking(s) → release slot(s) →
      // commit. Release is by booking_id, so it is safe/idempotent even when a
      // booking held no slot (band-less, or created while the flag was OFF).
      $db->beginTransaction();
      try {
        $idSel = $db->prepare('SELECT `id` FROM ' . $qid($table) . $where);
        $idSel->execute($params);
        $ids = array_map(fn($r) => (string)$r['id'], $idSel->fetchAll());
        if (!empty($req['returning'])) {
          $st0 = $db->prepare('SELECT * FROM ' . $qid($table) . $where);
          $st0->execute($params);
          $returned = array_map(fn($r) => cast_row($r, $S), $st0->fetchAll());
        }
        $st = $db->prepare('DELETE FROM ' . $qid($table) . $where);
        $st->execute($params);
        foreach ($ids as $bid) hm_slot_release($db, $bid);
        $db->commit();
      } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
      }
    } else {
      if (!empty($req['returning'])) {
        $st0 = $db->prepare('SELECT * FROM ' . $qid($table) . $where);
        $st0->execute($params);
        $returned = array_map(fn($r) => cast_row($r, $S), $st0->fetchAll());
      }
      $st = $db->prepare('DELETE FROM ' . $qid($table) . $where);
      $st->execute($params);
    }
    hm_cache_invalidate_table($table);
    return finish_rows($returned, $req);
  }

  hm_err('Unknown action: ' . $action, 400, 'bad_action');

} catch (Throwable $e) {
  hm_log_error('rest query failed', ['table' => $table, 'action' => $action, 'err' => $e->getMessage()]);
  hm_err(hm_safe_msg('Request failed', $e), 500, 'query');
}

// ── output shaping (single / maybeSingle) ────────────────────────────────────
function finish_rows(array $rows, array $req): void {
  $single = $req['single'] ?? false;
  if ($single === 'one') {
    if (count($rows) !== 1) hm_err('Expected exactly one row', 406, 'PGRST116');
    hm_ok($rows[0]);
  }
  if ($single === 'maybe') hm_ok($rows[0] ?? null);
  hm_ok(array_values($rows));
}

function finish_returning(PDO $db, string $table, array $S, array $generated, callable $qid, array $req): void {
  if (!$generated) finish_rows([], $req);
  $col = $generated[0]['col'];
  $vals = array_map(fn($g) => $g['val'], $generated);
  $ph = implode(',', array_fill(0, count($vals), '?'));
  $st = $db->prepare('SELECT * FROM ' . $qid($table) . ' WHERE ' . $qid($col) . " IN ($ph)");
  $st->execute($vals);
  finish_rows(array_map(fn($r) => cast_row($r, $S), $st->fetchAll()), $req);
}
