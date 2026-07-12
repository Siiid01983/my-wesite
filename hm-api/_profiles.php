<?php
// ════════════════════════════════════════════════════════════════════════════
//  _profiles.php — Customer Profile service layer (Phase 1)
//
//  LAZY-COMPUTE strategy (approved): profile statistics are derived from the
//  `bookings` table on demand; the customer_profiles columns are a cache that
//  the read endpoints refresh best-effort. NO triggers, NO booking-engine
//  changes — including this file only defines functions.
//
//  Also provides the ownership primitive reused by every customer-* endpoint:
//  an (email, reference) pair must match a booking (same check as auth.php),
//  after which data is scoped to that email only.
//
//  Callers pass their own PDO. Never writes to bookings / booking_slots.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

if (!function_exists('hm_profile_compute_stats')) {

  /** UUID v4 — reuse hm_uuid4() if present, else a local fallback (test-safe). */
  function hm_profile_uuid(): string {
    if (function_exists('hm_uuid4')) return hm_uuid4();
    $d = random_bytes(16);
    $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
    $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
  }

  /** CREATE TABLE IF NOT EXISTS customer_profiles (idempotent; matches schema). */
  function hm_profile_ensure_table(PDO $db): void {
    $db->exec(
      "CREATE TABLE IF NOT EXISTS customer_profiles (
        id                 CHAR(36)     NOT NULL,
        customer_email     VARCHAR(255) NOT NULL,
        customer_name      TEXT,
        customer_phone     VARCHAR(60),
        total_bookings     INT          NOT NULL DEFAULT 0,
        first_booking_date VARCHAR(40),
        last_booking_date  VARCHAR(40),
        notes              TEXT,
        created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY customer_email_unique (customer_email),
        KEY profile_last_booking_idx (last_booking_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
  }

  /** Extract the packed `ref:` / `service:` from a booking's [HM_EXTRAS] notes. */
  function hm_profile_ref_from_notes(?string $notes): ?string {
    if (preg_match('/^ref:\s*(\S+)/m', (string)$notes, $m)) return trim($m[1]);
    return null;
  }
  function hm_profile_service_from_notes(?string $notes): ?string {
    if (preg_match('/^service:\s*(.+)$/m', (string)$notes, $m)) return trim($m[1]);
    return null;
  }

  /** Ownership check — (email, reference) must match a booking (as auth.php does). */
  function hm_profile_verify_owner(PDO $db, string $email, string $ref): bool {
    $email = strtolower(trim($email));
    $ref   = trim($ref);
    if ($email === '' || $ref === '') return false;
    $st = $db->prepare('SELECT customer_email FROM bookings WHERE notes LIKE ? ORDER BY created_at DESC LIMIT 1');
    $st->execute(['%ref:' . $ref . '%']);
    $row = $st->fetch();
    return $row && strtolower(trim((string)($row['customer_email'] ?? ''))) === $email;
  }

  /** Compute cached stats for an email from `bookings` (non-cancelled only). */
  function hm_profile_compute_stats(PDO $db, string $email): array {
    $email = strtolower(trim($email));
    $latest = $db->prepare('SELECT customer_name, customer_phone FROM bookings WHERE LOWER(customer_email)=? ORDER BY created_at DESC LIMIT 1');
    $latest->execute([$email]);
    $lr = $latest->fetch() ?: [];
    $agg = $db->prepare(
      "SELECT COUNT(*) AS n, MIN(booking_date) AS first_d, MAX(booking_date) AS last_d
       FROM bookings WHERE LOWER(customer_email)=? AND status NOT IN ('cancelled','キャンセル')"
    );
    $agg->execute([$email]);
    $ar = $agg->fetch() ?: [];
    return [
      'customer_name'      => (string)($lr['customer_name']  ?? ''),
      'customer_phone'     => (string)($lr['customer_phone'] ?? ''),
      'total_bookings'     => (int)($ar['n'] ?? 0),
      'first_booking_date' => $ar['first_d'] ?? null,
      'last_booking_date'  => $ar['last_d']  ?? null,
    ];
  }

  /** Upsert the profile cache (leaves admin `notes` + created_at untouched). */
  function hm_profile_upsert(PDO $db, string $email, array $s): void {
    $email = strtolower(trim($email));
    $st = $db->prepare(
      'INSERT INTO customer_profiles
        (id, customer_email, customer_name, customer_phone, total_bookings, first_booking_date, last_booking_date)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        customer_name=VALUES(customer_name), customer_phone=VALUES(customer_phone),
        total_bookings=VALUES(total_bookings), first_booking_date=VALUES(first_booking_date),
        last_booking_date=VALUES(last_booking_date)'
    );
    $st->execute([hm_profile_uuid(), $email, $s['customer_name'], $s['customer_phone'],
                  $s['total_bookings'], $s['first_booking_date'], $s['last_booking_date']]);
  }

  /**
   * Lazy read: compute fresh stats, refresh the cache best-effort, and return the
   * profile shape. Resilient — if customer_profiles doesn't exist yet, still
   * returns the freshly computed stats (cache refresh is a bonus, not required).
   */
  function hm_profile_get_or_refresh(PDO $db, string $email): array {
    $email = strtolower(trim($email));
    $s = hm_profile_compute_stats($db, $email);
    $notes = null;
    try {
      hm_profile_upsert($db, $email, $s);
      $r = $db->prepare('SELECT notes FROM customer_profiles WHERE customer_email=?');
      $r->execute([$email]);
      $row = $r->fetch();
      if ($row) $notes = $row['notes'] ?? null;
    } catch (Throwable $e) { /* table not migrated yet — return computed stats */ }
    return [
      'customer_email'     => $email,
      'customer_name'      => $s['customer_name'],
      'customer_phone'     => $s['customer_phone'],
      'total_bookings'     => $s['total_bookings'],
      'first_booking_date' => $s['first_booking_date'],
      'last_booking_date'  => $s['last_booking_date'],
      'notes'              => $notes,
    ];
  }

  /** Most-booked service for an email (for the future dashboard card). */
  function hm_profile_favorite_service(PDO $db, string $email): ?string {
    $email = strtolower(trim($email));
    $st = $db->prepare("SELECT service_id, notes FROM bookings WHERE LOWER(customer_email)=? AND status NOT IN ('cancelled','キャンセル')");
    $st->execute([$email]);
    $counts = [];
    foreach ($st as $r) {
      $svc = trim((string)($r['service_id'] ?? ''));
      if ($svc === '') $svc = (string)(hm_profile_service_from_notes($r['notes'] ?? '') ?? '');
      if ($svc === '') continue;
      $counts[$svc] = ($counts[$svc] ?? 0) + 1;
    }
    if (!$counts) return null;
    arsort($counts);
    return (string)array_key_first($counts);
  }

  /** Status of the customer's most recent booking. */
  function hm_profile_current_status(PDO $db, string $email): ?string {
    $email = strtolower(trim($email));
    $st = $db->prepare('SELECT status FROM bookings WHERE LOWER(customer_email)=? ORDER BY created_at DESC LIMIT 1');
    $st->execute([$email]);
    $row = $st->fetch();
    return $row ? (string)($row['status'] ?? '') : null;
  }
}
