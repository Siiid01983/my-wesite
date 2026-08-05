<?php
// ════════════════════════════════════════════════════════════════════════════
//  admin/service-images.php — Service Card Images admin CRUD (サービス画像管理)
//
//  Reached at:  <API_BASE>/admin/service-images.php
//
//  Actions (verb → action):
//    GET                         list      → { data:[rows], count }   (all slugs, inc inactive)
//    POST  (multipart)           upload    → { data:{row} }           image + service_slug required
//                                            (UPSERT by slug — re-uploading REPLACES the image
//                                             and deletes the old files)
//    PUT   (application/json)    update     → { data:{row} }           active/alt_text/display_order
//                                            + optional base64 image replacement
//    DELETE                      delete     → { data:{deleted:id} }    removes row + files
//    POST  ?action=reorder       reorder    → { data:{updated:n} }     one transaction
//
//  Auth (EVERY request): API-key gate + staff gate (admin/manager X-ADMIN-TOKEN,
//  which is also the CSRF defense) — identical to admin/gallery.php.
//
//  Uploads: extension/MIME whitelist (jpg/png/webp) + 5 MB cap + server-side
//  RE-ENCODE via GD (strips embedded payloads) + full-size WebP + 400px thumb +
//  real width/height. Files land in the storage.php `media` bucket under
//  service-images/. Degrades gracefully to the validated raw upload when GD is
//  absent (image_webp/thumb_url NULL, dims via getimagesize()).
//
//  One row per service_slug (UNIQUE) — the 6 homepage cards. An inactive or
//  missing row makes the card fall back to its built-in placeholder image.
//
//  Error shape (handler errors): { "error": "message", "code": <httpStatus> }.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/../_db.php';
require_once __DIR__ . '/../_ratelimit.php';

hm_cors();                                  // CORS + OPTIONS + access log
hm_require_api_key();                       // public key gate
hm_rate_limit('service_images_admin', 60, 60);
hm_require_staff_write();                   // admin/manager X-ADMIN-TOKEN (also the CSRF gate)

// ── Config / constants ──────────────────────────────────────────────────────
$cfg   = hm_config();
$ROOT  = rtrim((string)($cfg['storage_dir'] ?? (__DIR__ . '/../_uploads')), '/\\');
$SDIR  = $ROOT . '/media/service-images';   // media bucket, service-images/ prefix
const SVCIMG_MAX_BYTES = 5 * 1024 * 1024;   // 5 MB
const SVCIMG_THUMB_W   = 400;
// canonical service slugs (index.html SERVICE_CONFIG ids). 'emergency' is a legacy
// alias for 'sameday' accepted on write and normalized.
const SVCIMG_SLUGS = ['sameday', 'single', 'couple', 'student', 'disposal', 'furniture'];
$SVCIMG_MIME_EXT = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

// ── Routing ─────────────────────────────────────────────────────────────────
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$action = (string)($_GET['action'] ?? '');

try {
  if ($method === 'GET')                               { svcimg_list(); }
  elseif ($method === 'POST' && $action === 'reorder') { svcimg_reorder(); }
  elseif ($method === 'POST')                          { svcimg_upload(); }
  elseif ($method === 'PUT')                           { svcimg_update(); }
  elseif ($method === 'DELETE')                        { svcimg_delete(); }
  else {
    header('Allow: GET, POST, PUT, DELETE');
    s_err('Method Not Allowed', 405);
  }
} catch (Throwable $e) {
  hm_log_error('admin/service-images fatal', ['err' => $e->getMessage()]);
  s_err(hm_debug() ? $e->getMessage() : 'Request failed', 500);
}

// ════════════════════════════════════════════════════════════════════════════
//  Handlers
// ════════════════════════════════════════════════════════════════════════════

// GET → all rows (incl. inactive) for the admin panel.
function svcimg_list(): void {
  $st = hm_db()->query('SELECT * FROM hm_service_images ORDER BY display_order ASC, id ASC');
  $rows = array_map('svcimg_shape_row', $st->fetchAll());
  s_json(['data' => $rows, 'count' => count($rows)], 200);
}

// POST multipart → upload an image for a slug (UPSERT: replaces an existing one).
function svcimg_upload(): void {
  $slug = svcimg_norm_slug((string)($_POST['service_slug'] ?? ''));
  if ($slug === '') s_err('service_slug が不正です（' . implode('/', SVCIMG_SLUGS) . '）', 422);

  if (!isset($_FILES['image']) || ($_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
    s_err('画像ファイルが必要です / Image file is required', 422);
  }
  $f = $_FILES['image'];
  if (($f['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
    s_err('アップロードに失敗しました（コード ' . (int)$f['error'] . '）', 400);
  }
  $tmp = (string)($f['tmp_name'] ?? '');
  if ($tmp === '' || !is_uploaded_file($tmp)) s_err('Invalid upload', 400);
  if ((int)($f['size'] ?? 0) > SVCIMG_MAX_BYTES) s_err('ファイルが大きすぎます（最大 5MB）', 413);

  $img = svcimg_process_image($tmp, $slug);   // validates + re-encodes + variants (or throws)

  $alt   = svcimg_str($_POST['alt_text'] ?? '', 200);
  $active = svcimg_bool($_POST['active'] ?? '1');

  $existing = svcimg_fetch_by_slug($slug);
  try {
    if ($existing) {
      // Replace: keep alt/order unless explicitly provided; swap image fields.
      $sets = ['image_url = ?', 'image_webp = ?', 'thumb_url = ?', 'width = ?', 'height = ?', 'active = ?'];
      $args = [$img['image_url'], $img['image_webp'], $img['thumb_url'], $img['width'], $img['height'], $active];
      if ($alt !== '') { $sets[] = 'alt_text = ?'; $args[] = $alt; }
      if (array_key_exists('display_order', $_POST) && $_POST['display_order'] !== '') {
        $sets[] = 'display_order = ?'; $args[] = (int)$_POST['display_order'];
      }
      $args[] = (int)$existing['id'];
      $st = hm_db()->prepare('UPDATE hm_service_images SET ' . implode(', ', $sets) . ' WHERE id = ?');
      $st->execute($args);
      $id = (int)$existing['id'];
    } else {
      $order = array_key_exists('display_order', $_POST) && $_POST['display_order'] !== ''
             ? (int)$_POST['display_order'] : svcimg_next_order();
      $st = hm_db()->prepare(
        'INSERT INTO hm_service_images
           (service_slug, image_url, image_webp, thumb_url, width, height, alt_text, active, display_order)
         VALUES (?,?,?,?,?,?,?,?,?)'
      );
      $st->execute([$slug, $img['image_url'], $img['image_webp'], $img['thumb_url'],
                    $img['width'], $img['height'], $alt, $active, $order]);
      $id = (int)hm_db()->lastInsertId();
    }
  } catch (Throwable $e) {
    svcimg_unlink($img['files']);                        // don't orphan files on a failed write
    hm_log_error('service-images upsert failed', ['err' => $e->getMessage(), 'slug' => $slug]);
    s_err('保存に失敗しました', 500);
  }

  // Replacement succeeded → delete the OLD image files from disk (best-effort).
  if ($existing) {
    svcimg_unlink(array_filter([
      svcimg_disk_from_url($existing['image_url']  ?? ''),
      svcimg_disk_from_url($existing['image_webp'] ?? ''),
      svcimg_disk_from_url($existing['thumb_url']  ?? ''),
    ]));
  }
  s_json(['data' => svcimg_fetch_row($id)], $existing ? 200 : 201);
}

// PUT application/json → update flags/metadata; optional base64 image replacement.
function svcimg_update(): void {
  $body = svcimg_json_body();
  $id   = (int)($body['id'] ?? ($_GET['id'] ?? 0));
  if ($id <= 0 && !empty($body['service_slug'])) {
    $row = svcimg_fetch_by_slug(svcimg_norm_slug((string)$body['service_slug']));
    $id  = $row ? (int)$row['id'] : 0;
  }
  if ($id <= 0) s_err('id が必要です', 422);

  $existing = svcimg_fetch_by_slug_or_id($id);
  if (!$existing) s_err('対象が見つかりません', 404);

  $sets = []; $args = [];
  if (array_key_exists('alt_text', $body))      { $sets[] = 'alt_text = ?';      $args[] = svcimg_str((string)$body['alt_text'], 200); }
  if (array_key_exists('active', $body))        { $sets[] = 'active = ?';        $args[] = svcimg_bool($body['active']); }
  if (array_key_exists('display_order', $body)) { $sets[] = 'display_order = ?'; $args[] = (int)$body['display_order']; }

  // Optional image replacement — base64 payload (data URI or bare base64).
  $newFiles = null;
  if (!empty($body['image_base64'])) {
    $tmp = svcimg_base64_to_tmp((string)$body['image_base64']);   // validates size, or throws
    $img = svcimg_process_image($tmp, (string)$existing['service_slug']);
    @unlink($tmp);
    $newFiles = $img['files'];
    $sets[] = 'image_url = ?';  $args[] = $img['image_url'];
    $sets[] = 'image_webp = ?'; $args[] = $img['image_webp'];
    $sets[] = 'thumb_url = ?';  $args[] = $img['thumb_url'];
    $sets[] = 'width = ?';      $args[] = $img['width'];
    $sets[] = 'height = ?';     $args[] = $img['height'];
  }

  if (!$sets) s_err('更新する項目がありません', 422);

  try {
    $args[] = $id;
    $st = hm_db()->prepare('UPDATE hm_service_images SET ' . implode(', ', $sets) . ' WHERE id = ?');
    $st->execute($args);
  } catch (Throwable $e) {
    if ($newFiles) svcimg_unlink($newFiles);
    hm_log_error('service-images update failed', ['err' => $e->getMessage(), 'id' => $id]);
    s_err('更新に失敗しました', 500);
  }

  if ($newFiles) {
    svcimg_unlink(array_filter([
      svcimg_disk_from_url($existing['image_url']  ?? ''),
      svcimg_disk_from_url($existing['image_webp'] ?? ''),
      svcimg_disk_from_url($existing['thumb_url']  ?? ''),
    ]));
  }
  s_json(['data' => svcimg_fetch_row($id)], 200);
}

// DELETE → remove the row AND its image files from disk.
function svcimg_delete(): void {
  $id = (int)($_GET['id'] ?? 0);
  if ($id <= 0) { $b = svcimg_json_body(); $id = (int)($b['id'] ?? 0);
    if ($id <= 0 && !empty($b['service_slug'])) {
      $r = svcimg_fetch_by_slug(svcimg_norm_slug((string)$b['service_slug']));
      $id = $r ? (int)$r['id'] : 0;
    }
  }
  if ($id <= 0) s_err('id が必要です', 422);

  $row = svcimg_fetch_by_slug_or_id($id);
  if (!$row) s_err('対象が見つかりません', 404);

  try {
    $st = hm_db()->prepare('DELETE FROM hm_service_images WHERE id = ?');
    $st->execute([$id]);
  } catch (Throwable $e) {
    hm_log_error('service-images delete failed', ['err' => $e->getMessage(), 'id' => $id]);
    s_err('削除に失敗しました', 500);
  }
  svcimg_unlink(array_filter([
    svcimg_disk_from_url($row['image_url']  ?? ''),
    svcimg_disk_from_url($row['image_webp'] ?? ''),
    svcimg_disk_from_url($row['thumb_url']  ?? ''),
  ]));
  s_json(['data' => ['deleted' => $id]], 200);
}

// POST ?action=reorder → apply [{id,display_order}, ...] atomically.
function svcimg_reorder(): void {
  $body  = svcimg_json_body();
  $items = $body['items'] ?? $body;
  if (!is_array($items) || !$items) s_err('items 配列が必要です', 422);

  $pairs = [];
  foreach ($items as $it) {
    if (!is_array($it) || !isset($it['id'])) s_err('各要素に id と display_order が必要です', 422);
    $pairs[] = [(int)$it['id'], (int)($it['display_order'] ?? 0)];
  }

  $db = hm_db();
  try {
    $db->beginTransaction();
    $st = $db->prepare('UPDATE hm_service_images SET display_order = ? WHERE id = ?');
    foreach ($pairs as [$pid, $ord]) $st->execute([$ord, $pid]);
    $db->commit();
  } catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    hm_log_error('service-images reorder failed', ['err' => $e->getMessage()]);
    s_err('並び替えに失敗しました', 500);
  }
  s_json(['data' => ['updated' => count($pairs)]], 200);
}

// ════════════════════════════════════════════════════════════════════════════
//  Image processing  (self-contained; mirrors admin/gallery.php)
// ════════════════════════════════════════════════════════════════════════════

// Validate + store an image from a local temp file. Returns:
//   [ image_url, image_webp|null, thumb_url|null, width|null, height|null, files:[disk paths] ]
// Emits s_err (and exits) on any validation failure.
function svcimg_process_image(string $srcTmp, string $slug): array {
  global $SDIR, $SVCIMG_MIME_EXT;

  $mime = '';
  if (function_exists('finfo_open')) {
    $fi = finfo_open(FILEINFO_MIME_TYPE);
    $mime = $fi ? (finfo_file($fi, $srcTmp) ?: '') : '';
  } elseif (function_exists('mime_content_type')) {
    $mime = mime_content_type($srcTmp) ?: '';
  }
  if (!isset($SVCIMG_MIME_EXT[$mime])) {
    s_err('対応形式は JPG / PNG / WebP のみです（検出: ' . ($mime ?: '不明') . '）', 415);
  }
  $ext = $SVCIMG_MIME_EXT[$mime];

  if (!is_dir($SDIR) && !@mkdir($SDIR, 0775, true) && !is_dir($SDIR)) {
    hm_log_error('service-images mkdir failed', ['dir' => $SDIR]);
    s_err('保存先フォルダを作成できません', 500);
  }

  $safeSlug = preg_replace('/[^a-z0-9_-]/', '', $slug) ?: 'svc';
  $rand = $safeSlug . '_' . bin2hex(random_bytes(8));
  $origDisk  = "$SDIR/$rand.$ext";
  $webpDisk  = "$SDIR/$rand.webp";
  $thumbDisk = "$SDIR/{$rand}_400.webp";

  $files = [];
  $width = null; $height = null;
  $webpUrl = null; $thumbUrl = null;

  $gd = extension_loaded('gd') && function_exists('imagecreatetruecolor');
  if ($gd) {
    $src = svcimg_gd_load($srcTmp, $mime);
    if ($src === null) s_err('画像を読み込めませんでした', 422);
    $width  = imagesx($src);
    $height = imagesy($src);

    if (!svcimg_gd_save($src, $mime, $origDisk)) { imagedestroy($src); s_err('画像の保存に失敗しました', 500); }
    $files[] = $origDisk;

    if (function_exists('imagewebp')) {
      if (@imagewebp($src, $webpDisk, 82)) { $files[] = $webpDisk; $webpUrl = svcimg_media_url("$rand.webp"); }
    }

    $thumb = svcimg_gd_thumb($src, SVCIMG_THUMB_W);
    if ($thumb !== null) {
      if (function_exists('imagewebp') && @imagewebp($thumb, $thumbDisk, 80)) {
        $files[] = $thumbDisk; $thumbUrl = svcimg_media_url("{$rand}_400.webp");
      } else {
        $thumbJpg = "$SDIR/{$rand}_400.jpg";
        if (@imagejpeg($thumb, $thumbJpg, 82)) { $files[] = $thumbJpg; $thumbUrl = svcimg_media_url("{$rand}_400.jpg"); }
      }
      imagedestroy($thumb);
    }
    imagedestroy($src);
  } else {
    hm_log_error('service-images GD missing — storing raw upload (no re-encode/webp/thumb)', ['mime' => $mime]);
    if (!@copy($srcTmp, $origDisk)) s_err('画像の保存に失敗しました', 500);
    $files[] = $origDisk;
    $dim = @getimagesize($origDisk);
    if (is_array($dim)) { $width = (int)$dim[0]; $height = (int)$dim[1]; }
  }
  @chmod($origDisk, 0644);

  return [
    'image_url'  => svcimg_media_url("$rand.$ext"),
    'image_webp' => $webpUrl,
    'thumb_url'  => $thumbUrl,
    'width'      => $width,
    'height'     => $height,
    'files'      => $files,
  ];
}

function svcimg_gd_load(string $path, string $mime) {
  try {
    switch ($mime) {
      case 'image/jpeg': $im = @imagecreatefromjpeg($path); break;
      case 'image/png':  $im = @imagecreatefrompng($path);  break;
      case 'image/webp': $im = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($path) : false; break;
      default: return null;
    }
  } catch (Throwable $e) { return null; }
  return $im ?: null;
}

function svcimg_gd_save($img, string $mime, string $dest): bool {
  switch ($mime) {
    case 'image/jpeg': return @imagejpeg($img, $dest, 82);
    case 'image/png':
      @imagealphablending($img, false); @imagesavealpha($img, true);
      return @imagepng($img, $dest, 6);
    case 'image/webp': return function_exists('imagewebp') ? @imagewebp($img, $dest, 82) : false;
  }
  return false;
}

function svcimg_gd_thumb($src, int $targetW) {
  $w = imagesx($src); $h = imagesy($src);
  if ($w <= 0 || $h <= 0) return null;
  if ($w <= $targetW) { $targetW = $w; }
  $targetH = max(1, (int)round($h * ($targetW / $w)));
  $dst = imagecreatetruecolor($targetW, $targetH);
  if (!$dst) return null;
  imagealphablending($dst, false); imagesavealpha($dst, true);
  $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
  imagefilledrectangle($dst, 0, 0, $targetW, $targetH, $transparent);
  imagecopyresampled($dst, $src, 0, 0, 0, 0, $targetW, $targetH, $w, $h);
  return $dst;
}

function svcimg_base64_to_tmp(string $b64): string {
  if (preg_match('#^data:[^;]+;base64,#i', $b64)) $b64 = preg_replace('#^data:[^;]+;base64,#i', '', $b64);
  $bytes = base64_decode(strtr(trim($b64), ' ', '+'), true);
  if ($bytes === false || $bytes === '') s_err('画像データが不正です', 422);
  if (strlen($bytes) > SVCIMG_MAX_BYTES) s_err('ファイルが大きすぎます（最大 5MB）', 413);
  $tmp = tempnam(sys_get_temp_dir(), 'hms');
  if ($tmp === false || file_put_contents($tmp, $bytes) === false) s_err('一時ファイルの作成に失敗しました', 500);
  return $tmp;
}

// ════════════════════════════════════════════════════════════════════════════
//  URL / disk mapping (media bucket, served by storage.php?action=get)
// ════════════════════════════════════════════════════════════════════════════

function svcimg_media_url(string $name): string {
  $rel = 'service-images/' . $name;
  return svcimg_api_origin() . '/storage.php?action=get&bucket=media&path=' . rawurlencode($rel);
}

function svcimg_api_origin(): string {
  $https  = (($_SERVER['HTTPS'] ?? '') === 'on') || ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443);
  $scheme = $https ? 'https' : 'http';
  $host   = (string)($_SERVER['HTTP_HOST'] ?? 'localhost');
  $base   = str_replace('\\', '/', dirname(dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/hm-api/admin/service-images.php'))));
  $base   = rtrim($base, '/');
  return $scheme . '://' . $host . $base;
}

function svcimg_disk_from_url(string $url): ?string {
  global $ROOT;
  if ($url === '') return null;
  $q = parse_url($url, PHP_URL_QUERY);
  if (!$q) return null;
  parse_str($q, $p);
  if (($p['bucket'] ?? '') !== 'media' || empty($p['path'])) return null;
  $parts = array_filter(explode('/', str_replace('\\', '/', (string)$p['path'])), fn($x) => $x !== '' && $x !== '.' && $x !== '..');
  $clean = implode('/', array_map(fn($x) => preg_replace('/[^A-Za-z0-9._-]/', '', $x), $parts));
  if ($clean === '') return null;
  return "$ROOT/media/$clean";
}

// ════════════════════════════════════════════════════════════════════════════
//  Small DB / value helpers
// ════════════════════════════════════════════════════════════════════════════

// Normalize + validate a service slug against the canonical set ('' when invalid).
function svcimg_norm_slug(string $s): string {
  $s = strtolower(trim($s));
  if ($s === 'emergency') $s = 'sameday';   // legacy alias
  return in_array($s, SVCIMG_SLUGS, true) ? $s : '';
}

function svcimg_next_order(): int {
  $v = hm_db()->query('SELECT COALESCE(MAX(display_order), -1) + 1 AS n FROM hm_service_images')->fetch();
  return (int)($v['n'] ?? 0);
}

function svcimg_fetch_by_slug(string $slug): ?array {
  if ($slug === '') return null;
  $st = hm_db()->prepare('SELECT * FROM hm_service_images WHERE service_slug = ? LIMIT 1');
  $st->execute([$slug]);
  $r = $st->fetch();
  return $r ?: null;
}

function svcimg_fetch_by_slug_or_id(int $id): ?array {
  $st = hm_db()->prepare('SELECT * FROM hm_service_images WHERE id = ? LIMIT 1');
  $st->execute([$id]);
  $r = $st->fetch();
  return $r ?: null;
}

function svcimg_fetch_row(int $id): array {
  $r = svcimg_fetch_by_slug_or_id($id);
  return $r ? svcimg_shape_row($r) : ['id' => $id];
}

// Normalize a DB row into the admin JSON shape (typed).
function svcimg_shape_row(array $r): array {
  return [
    'id'            => (int)$r['id'],
    'service_slug'  => (string)$r['service_slug'],
    'image_url'     => (string)$r['image_url'],
    'image_webp'    => $r['image_webp'] !== null ? (string)$r['image_webp'] : null,
    'thumb_url'     => $r['thumb_url']  !== null ? (string)$r['thumb_url']  : null,
    'width'         => $r['width']  !== null ? (int)$r['width']  : null,
    'height'        => $r['height'] !== null ? (int)$r['height'] : null,
    'alt_text'      => (string)$r['alt_text'],
    'active'        => (int)$r['active'] === 1,
    'display_order' => (int)$r['display_order'],
    'created_at'    => $r['created_at'] ?? null,
    'updated_at'    => $r['updated_at'] ?? null,
  ];
}

function svcimg_str($v, int $max): string {
  $s = trim((string)$v);
  if ($s === '') return '';
  return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
}

function svcimg_bool($v): int {
  if (is_bool($v)) return $v ? 1 : 0;
  $s = strtolower(trim((string)$v));
  return ($s === '1' || $s === 'true' || $s === 'on' || $s === 'yes') ? 1 : 0;
}

function svcimg_json_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === '' || $raw === false) return [];
  $j = json_decode($raw, true);
  if (!is_array($j)) s_err('Invalid JSON body', 400);
  return $j;
}

function svcimg_unlink(array $paths): void {
  foreach ($paths as $p) { if (is_string($p) && $p !== '' && is_file($p)) @unlink($p); }
}

// ── Response emitters (spec shape: {data|error, code}) ──────────────────────
function s_json(array $payload, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
  if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
  echo json_encode($payload, $flags);
  exit;
}
function s_err(string $message, int $status = 400): void {
  s_json(['error' => $message, 'code' => $status], $status);
}
