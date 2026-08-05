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
//  Deliberately NEVER exposes `active`, thumb_url, or timestamps.
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
    'SELECT service_slug, image_url, image_webp, alt_text, width, height, display_order
       FROM hm_service_images
      WHERE active = 1
      ORDER BY display_order ASC, id ASC'
  );
  $rows = $st->fetchAll();

  $out = [];
  foreach ($rows as $r) {
    $out[] = [
      'service_slug' => (string)$r['service_slug'],
      'image_url'    => (string)$r['image_url'],
      'image_webp'   => $r['image_webp'] !== null ? (string)$r['image_webp'] : null,
      'alt_text'     => (string)$r['alt_text'],
      'width'        => $r['width']  !== null ? (int)$r['width']  : null,
      'height'       => $r['height'] !== null ? (int)$r['height'] : null,
      'display_order'=> (int)$r['display_order'],
    ];
  }

  svcimg_public_json(['data' => $out, 'count' => count($out)], 200, true);
} catch (Throwable $e) {
  hm_log_error('service-images public feed failed', ['err' => $e->getMessage()]);
  // Fail soft: empty feed → homepage keeps its default placeholder images.
  svcimg_public_json(['data' => [], 'count' => 0], 200);
}

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
