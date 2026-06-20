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
hm_cors();
hm_require_api_key();

// ── Table allowlist: columns + type hints + pk strategy + unique keys ─────────
$SCHEMA = [
  'hm_data' => [
    'cols' => ['id','key','value','updated_at'],
    'json' => ['value'], 'bool' => [], 'int' => [],
    'uuid_pk' => true, 'unique' => ['key'],
  ],
  'bookings' => [
    'cols' => ['id','customer_name','customer_email','customer_phone','booking_date','service_id','status','notes','items','created_at','updated_at'],
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
  'communications' => [
    'cols' => ['id','booking_id','customer_email','sender_email','subject','message','direction','created_at','created_by','email_status','email_error','sent_at'],
    'json' => [], 'bool' => [], 'int' => ['id'],
    'uuid_pk' => false, 'unique' => ['id'],
  ],
  'inbox_messages' => [
    'cols' => ['id','sender','email','subject','body','booking_id','created_at'],
    'json' => [], 'bool' => [], 'int' => [],
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

$req   = hm_body();
$table = (string)($req['table'] ?? '');
if (!isset($SCHEMA[$table])) hm_err('Unknown table: ' . $table, 400, 'bad_table');
$S      = $SCHEMA[$table];
$action = (string)($req['action'] ?? 'select');
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
      if (!empty($req['head'])) hm_json(['data' => null, 'count' => $count, 'error' => null], 200);
    }

    $st = $db->prepare("SELECT $cols FROM " . $qid($table) . "$where$order$limit");
    $st->execute($params);
    $rows = array_map(fn($r) => cast_row($r, $S), $st->fetchAll());
    if ($count !== null) hm_json(['data' => array_values($rows), 'count' => $count, 'error' => null], 200);
    return finish_rows($rows, $req);
  }

  // ════════════════════════════ INSERT / UPSERT ═════════════════════════════
  if ($action === 'insert' || $action === 'upsert') {
    $values = $req['values'] ?? [];
    $rows = (is_array($values) && array_keys($values) === range(0, count($values) - 1)) ? $values : [$values];
    if (!$rows) hm_ok([]);

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
      $st = $db->prepare($sql);
      $st->execute(array_values($data));

      // Track how to fetch the affected row back.
      if (!$S['uuid_pk']) $generated[] = ['col' => 'id', 'val' => (int)$db->lastInsertId()];
      elseif (isset($data['id'])) $generated[] = ['col' => 'id', 'val' => $data['id']];
    }

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

    $st = $db->prepare('UPDATE ' . $qid($table) . ' SET ' . implode(',', $set) . $where);
    $st->execute(array_merge($setParams, $whereParams));

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
    if (!empty($req['returning'])) {
      $st0 = $db->prepare('SELECT * FROM ' . $qid($table) . $where);
      $st0->execute($params);
      $returned = array_map(fn($r) => cast_row($r, $S), $st0->fetchAll());
    }
    $st = $db->prepare('DELETE FROM ' . $qid($table) . $where);
    $st->execute($params);
    return finish_rows($returned, $req);
  }

  hm_err('Unknown action: ' . $action, 400, 'bad_action');

} catch (Throwable $e) {
  hm_err('Query failed: ' . $e->getMessage(), 500, 'query');
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
