<?php
// ════════════════════════════════════════════════════════════════════════════
//  gallery.php — public Works Gallery feed (作業事例ギャラリー)
//
//  Reached at:  <API_BASE>/gallery.php
//  Method:      GET only. Any other verb → 405.
//
//  Returns active gallery items for the public homepage carousel, ordered by
//  display_order ASC, id ASC. Response shape is a lean public contract — it is
//  NOT the {ok,data,error} admin envelope:
//
//      { "data": [ {id,title,description,alt_text,image_url,image_webp,
//                   width,height,category,is_featured}, ... ], "count": n }
//
//  Deliberately NEVER exposes is_active, thumb_url, or timestamps.
//
//  Auth: API-key gate only (page-shipped X-API-KEY, same as availability.php).
//  No staff token — this is public read. The frontend apiClient/fetch sends
//  window.API_KEY. Response is browser-cacheable (max-age=300); the admin write
//  path is hm-api/admin/gallery.php.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_ratelimit.php';

hm_cors();                              // emits CORS, answers OPTIONS, access-logs
hm_require_api_key();                   // public key gate (empty api_key ⇒ off)
hm_rate_limit('gallery', 120, 60);      // read tier: 120 req / min / IP

// GET-only contract. hm_cors() already short-circuited OPTIONS.
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
  header('Allow: GET');
  gallery_public_json(['error' => 'Method Not Allowed', 'code' => 405], 405);
}

try {
  $db = hm_db();
  $st = $db->query(
    'SELECT id, title, description, alt_text, image_url, image_webp,
            width, height, category, is_featured
       FROM website_gallery
      WHERE is_active = 1
      ORDER BY display_order ASC, id ASC'
  );
  $rows = $st->fetchAll();

  $out = [];
  foreach ($rows as $r) {
    $out[] = [
      'id'          => (int)$r['id'],
      'title'       => (string)$r['title'],
      'description' => $r['description'] !== null ? (string)$r['description'] : null,
      'alt_text'    => (string)$r['alt_text'],
      'image_url'   => (string)$r['image_url'],
      'image_webp'  => $r['image_webp'] !== null ? (string)$r['image_webp'] : null,
      'width'       => $r['width']  !== null ? (int)$r['width']  : null,
      'height'      => $r['height'] !== null ? (int)$r['height'] : null,
      'category'    => (string)$r['category'],
      'is_featured' => (int)$r['is_featured'] === 1,
    ];
  }

  gallery_public_json(['data' => $out, 'count' => count($out)], 200, true);
} catch (Throwable $e) {
  hm_log_error('gallery public feed failed', ['err' => $e->getMessage()]);
  // Fail soft: an empty feed lets the public carousel hide itself rather than
  // surfacing an error on the marketing site (Phase 3 spec 3.6).
  gallery_public_json(['data' => [], 'count' => 0], 200);
}

// Local emitter — the shared hm_json() forces Cache-Control: no-store, which is
// wrong for this cacheable public feed, and wraps the {ok,data,error} envelope
// we intentionally do NOT use here. So we emit the lean shape + our own caching
// header directly.
function gallery_public_json(array $payload, int $status = 200, bool $cache = false): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  if ($cache) {
    header('Cache-Control: public, max-age=300');
  } else {
    header('Cache-Control: no-store');
  }
  $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
  if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
  echo json_encode($payload, $flags);
  exit;
}
