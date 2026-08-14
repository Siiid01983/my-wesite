<?php
// ════════════════════════════════════════════════════════════════════════════
//  service-images.php — public Service Card Images feed (サービス画像)
//
//  Reached at:  <API_BASE>/service-images.php
//  Method:      GET only. Any other verb → 405.
//
//  Returns the ACTIVE custom image for each service card, ordered by
//  display_order ASC, id ASC. Lean public contract (NOT the {ok,data,error}
//  admin envelope):
//
//      { "data": [ {service_slug,image_url,image_webp,alt_text,width,height,
//                   display_order}, ... ], "count": n }
//
//  ⚠ SCHEMA NOTE: reads the EXISTING production `hm_service_images` table
//  (columns: id,title,category,image_path,alt_text,description,display_order,
//  is_active,created_at,updated_at). The public contract above is unchanged:
//  `service_slug` is resolved from `category` (title fallback), `image_url` is
//  `image_path`, and `image_webp`/`width`/`height` are always null (the schema
//  has no variant columns). Deliberately NEVER exposes `is_active`, `title`,
//  `description`, or timestamps.
//
//  Auth: API-key gate only (page-shipped X-API-KEY, same as gallery.php /
//  availability.php). No staff token — public read. The admin write path is
//  hm-api/admin/service-images.php.
//
//  Fail-soft: on ANY error (including the table not existing before the
//  migration is applied) it returns an EMPTY feed so the homepage silently falls
//  back to its built-in SERVICE_CONFIG placeholder images — never an error.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_ratelimit.php';

// Canonical slug mapping. Prefer the shared file; self-heal inline if it was not
// deployed (never fatal on a missing include). In sync with hm-api/_svcimg_slug.php.
$__svcimgSlug = __DIR__ . '/_svcimg_slug.php';
if (is_file($__svcimgSlug)) require_once $__svcimgSlug;
if (!defined('SVCIMG_SLUGS')) {
  define('SVCIMG_SLUGS', ['sameday', 'single', 'couple', 'student', 'disposal', 'furniture']);
}
if (!function_exists('svcimg_norm_slug')) {
  function svcimg_norm_slug(string $s): string {
    $s = strtolower(trim($s));
    if ($s === 'emergency') $s = 'sameday';
    return in_array($s, SVCIMG_SLUGS, true) ? $s : '';
  }
}
if (!function_exists('svcimg_canon_slug')) {
  function svcimg_canon_slug(array $r): string {
    $byCat = svcimg_norm_slug((string)($r['category'] ?? ''));
    if ($byCat !== '') return $byCat;
    return svcimg_norm_slug((string)($r['title'] ?? ''));
  }
}

hm_cors();                                 // CORS + OPTIONS + access log
hm_require_api_key();                       // public key gate (empty api_key ⇒ off)
hm_rate_limit('service_images', 120, 60);   // read tier: 120 req / min / IP

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
  header('Allow: GET');
  svcimg_public_json(['error' => 'Method Not Allowed', 'code' => 405], 405);
}

try {
  $db = hm_db();
  $st = $db->query(
    'SELECT category, title, image_path, alt_text, display_order, updated_at
       FROM hm_service_images
      WHERE is_active = 1
      ORDER BY display_order ASC, id ASC'
  );
  $rows = $st->fetchAll();

  $out = [];
  foreach ($rows as $r) {
    $slug = svcimg_canon_slug($r);                // STRICT: canonical slug or '' (category→title)
    $path = (string)($r['image_path'] ?? '');
    if ($slug === '' || $path === '') continue;   // skip rows that don't map to a card
    $out[] = [
      'service_slug' => $slug,
      'image_url'    => $path,
      'image_webp'   => null,                       // no variant column in the schema
      'alt_text'     => (string)($r['alt_text'] ?? ''),
      'width'        => null,
      'height'       => null,
      'display_order'=> (int)($r['display_order'] ?? 0),
      // Stable per-image version → the homepage appends it as ?v=<digits> so a
      // REPLACED image is fetched fresh while an unchanged one keeps a cacheable
      // URL. Never a random value (that would defeat browser/CDN caching).
      'updated_at'   => $r['updated_at'] ?? null,
    ];
  }

  // no-store: this feed carries the freshest image_path + updated_at version so a
  // replaced image is reflected on the very next reload. The image BYTES stay
  // cacheable (immutable per ?v= token) — only this tiny JSON is always revalidated.
  svcimg_public_json(['data' => $out, 'count' => count($out)], 200, false);
} catch (Throwable $e) {
  hm_log_error('service-images public feed failed', ['err' => $e->getMessage()]);
  // Fail soft: empty feed → homepage keeps its default placeholder images.
  svcimg_public_json(['data' => [], 'count' => 0], 200);
}

// (svcimg_canon_slug — the category→title→'' resolver — lives in _svcimg_slug.php.)

// Local emitter — mirrors gallery.php: lean shape + a cacheable header (the shared
// hm_json() forces no-store + the {ok,data,error} envelope we don't use here).
function svcimg_public_json(array $payload, int $status = 200, bool $cache = false): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header($cache ? 'Cache-Control: public, max-age=300' : 'Cache-Control: no-store');
  $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
  if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
  echo json_encode($payload, $flags);
  exit;
}
