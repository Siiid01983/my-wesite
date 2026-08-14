<?php
// ════════════════════════════════════════════════════════════════════════════
//  _svcimg_slug.php — shared, DB-free service-image slug mapping.
//
//  Required by BOTH service-image endpoints:
//     hm-api/admin/service-images.php   (admin CRUD)
//     hm-api/service-images.php         (public feed)
//  …and exercised standalone by tests/service-images-mapping.test.php.
//
//  The production `hm_service_images` table stores the service identity in its
//  `category` column (with `title` as a human label). These helpers map a row's
//  category/title onto the six CANONICAL homepage service slugs deterministically:
//
//     category → (normalize)         ─┐  first canonical match wins
//     title    → (normalize, fallback)┘
//
//  Pure functions only (no DB, no I/O) — safe to unit-test and to include from
//  any request path. Guarded so a double-include is harmless.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

// canonical service slugs (index.html SERVICE_CONFIG ids). 'emergency' is a
// legacy alias for 'sameday', normalized on both read and write.
if (!defined('SVCIMG_SLUGS')) {
  define('SVCIMG_SLUGS', ['sameday', 'single', 'couple', 'student', 'disposal', 'furniture']);
}

// Normalize + validate a single string against the canonical set ('' when invalid).
if (!function_exists('svcimg_norm_slug')) {
  function svcimg_norm_slug(string $s): string {
    $s = strtolower(trim($s));
    if ($s === 'emergency') $s = 'sameday';           // legacy alias
    return in_array($s, SVCIMG_SLUGS, true) ? $s : '';
  }
}

// STRICT row → canonical slug: prefer `category`, fall back to `title`, else ''.
// Used by the PUBLIC feed to SKIP rows that don't map to one of the six cards.
if (!function_exists('svcimg_canon_slug')) {
  function svcimg_canon_slug(array $r): string {
    $byCat = svcimg_norm_slug((string)($r['category'] ?? ''));
    if ($byCat !== '') return $byCat;
    return svcimg_norm_slug((string)($r['title'] ?? ''));
  }
}

// LENIENT row → slug: canonical if possible, otherwise the raw lowercased
// category (so non-canonical rows still carry a stable, non-destructive
// identifier in the admin list — they simply won't match any of the six cards).
if (!function_exists('svcimg_resolve_slug')) {
  function svcimg_resolve_slug(array $r): string {
    $canon = svcimg_canon_slug($r);
    if ($canon !== '') return $canon;
    return strtolower(trim((string)($r['category'] ?? '')));
  }
}
