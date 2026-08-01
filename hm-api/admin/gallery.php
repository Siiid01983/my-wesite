<?php
// ════════════════════════════════════════════════════════════════════════════
//  admin/gallery.php — Works Gallery admin CRUD (作業事例ギャラリー)
//
//  Reached at:  <API_BASE>/admin/gallery.php
//
//  Actions (verb → action):
//    GET                         list      → { data:[rows], count }
//    POST  (multipart)           create    → { data:{row} }        image required
//    PUT   (application/json)    update     → { data:{row} }        image optional (base64)
//    DELETE                      delete     → { data:{deleted:id} }  removes row + 3 files
//    POST  ?action=reorder       reorder    → { data:{updated:n} }   one transaction
//
//  Auth (EVERY request): API-key gate + staff gate. The staff gate requires a
//  valid, non-revoked admin/manager X-ADMIN-TOKEN. That custom header IS the CSRF
//  defense — a browser cannot attach it cross-site without a CORS grant, so every
//  mutating verb (POST/PUT/DELETE) is CSRF-protected by construction. Unauthenticated
//  callers get the standard 401 JSON envelope from the gate (never an HTML redirect).
//
//  Uploads: extension whitelist (jpg/jpeg/png/webp) + REAL MIME via finfo + 5 MB
//  cap + server-side RE-ENCODE (never stores the raw bytes when GD is present) +
//  randomized filename. Files land in the storage.php `media` bucket under gallery/,
//  where hm-api/_uploads/.htaccess already disables PHP execution. On upload we also
//  generate a full-size WebP and a 400px WebP thumbnail and record real width/height.
//
//  GD dependency: if the GD extension is absent on the host, we DEGRADE GRACEFULLY —
//  the validated raw upload is stored (still MIME-checked, size-checked, randomized),
//  image_webp/thumb_url are left NULL, and dimensions come from getimagesize() when
//  available. A warning is logged. Re-encoding resumes automatically once GD exists.
//
//  Error shape (handler errors): { "error": "message", "code": <httpStatus> }.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/../_db.php';
require_once __DIR__ . '/../_ratelimit.php';

hm_cors();                                  // CORS + OPTIONS + access log
hm_require_api_key();                       // public key gate
hm_rate_limit('gallery_admin', 60, 60);     // 60 req / min / IP
hm_require_staff_write();                   // admin/manager X-ADMIN-TOKEN (also the CSRF gate)

// ── Config / constants ──────────────────────────────────────────────────────
$cfg   = hm_config();
$ROOT  = rtrim((string)($cfg['storage_dir'] ?? (__DIR__ . '/../_uploads')), '/\\');
$GDIR  = $ROOT . '/media/gallery';          // media bucket, gallery/ prefix (public bucket)
const GALLERY_MAX_BYTES  = 5 * 1024 * 1024; // 5 MB — spec cap (below the 15 MB storage cap)
const GALLERY_THUMB_W    = 400;             // admin-list thumbnail width
// real MIME → canonical extension (the ONLY accepted image types)
$GALLERY_MIME_EXT = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

// ── Routing ─────────────────────────────────────────────────────────────────
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$action = (string)($_GET['action'] ?? '');

try {
  if ($method === 'GET')                        { gallery_list(); }
  elseif ($method === 'POST' && $action === 'reorder') { gallery_reorder(); }
  elseif ($method === 'POST')                   { gallery_create(); }
  elseif ($method === 'PUT')                    { gallery_update(); }
  elseif ($method === 'DELETE')                 { gallery_delete(); }
  else {
    header('Allow: GET, POST, PUT, DELETE');
    g_err('Method Not Allowed', 405);
  }
} catch (Throwable $e) {
  hm_log_error('admin/gallery fatal', ['err' => $e->getMessage()]);
  g_err(hm_debug() ? $e->getMessage() : 'Request failed', 500);
}

// ════════════════════════════════════════════════════════════════════════════
//  Handlers
// ════════════════════════════════════════════════════════════════════════════

// GET → full row list for the admin table (all columns, active + inactive).
function gallery_list(): void {
  $st = hm_db()->query(
    'SELECT id, title, description, alt_text, image_url, image_webp, thumb_url,
            width, height, category, display_order, is_active, is_featured,
            created_at, updated_at
       FROM website_gallery
      ORDER BY display_order ASC, id ASC'
  );
  $rows = array_map('gallery_shape_row', $st->fetchAll());
  g_json(['data' => $rows, 'count' => count($rows)], 200);
}

// POST multipart → create one item (image required).
function gallery_create(): void {
  global $GALLERY_MIME_EXT;

  if (!isset($_FILES['image']) || ($_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
    g_err('画像ファイルが必要です / Image file is required', 422);
  }
  $f = $_FILES['image'];
  if (($f['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
    g_err('アップロードに失敗しました（コード ' . (int)$f['error'] . '）', 400);
  }
  $tmp = (string)($f['tmp_name'] ?? '');
  if ($tmp === '' || !is_uploaded_file($tmp)) g_err('Invalid upload', 400);
  if ((int)($f['size'] ?? 0) > GALLERY_MAX_BYTES) g_err('ファイルが大きすぎます（最大 5MB）', 413);

  $img = gallery_process_image($tmp);   // validates MIME + re-encodes + variants (or throws g_err)

  // Text fields (from multipart $_POST)
  $title    = gallery_str($_POST['title'] ?? '', 120);
  $altText  = gallery_str($_POST['alt_text'] ?? '', 200);
  $desc     = gallery_str($_POST['description'] ?? '', 400);
  $category = gallery_str($_POST['category'] ?? 'general', 40) ?: 'general';
  if ($title === '')   { gallery_unlink($img['files']); g_err('タイトルは必須です', 422); }
  if ($altText === '') { gallery_unlink($img['files']); g_err('代替テキスト（alt）は必須です', 422); }

  $isActive   = gallery_bool($_POST['is_active']   ?? '1');
  $isFeatured = gallery_bool($_POST['is_featured'] ?? '0');
  $order      = array_key_exists('display_order', $_POST) && $_POST['display_order'] !== ''
              ? (int)$_POST['display_order'] : gallery_next_order();

  try {
    $st = hm_db()->prepare(
      'INSERT INTO website_gallery
         (title, description, alt_text, image_url, image_webp, thumb_url,
          width, height, category, display_order, is_active, is_featured)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    $st->execute([
      $title, ($desc !== '' ? $desc : null), $altText,
      $img['image_url'], $img['image_webp'], $img['thumb_url'],
      $img['width'], $img['height'], $category, $order, $isActive, $isFeatured,
    ]);
    $id = (int)hm_db()->lastInsertId();
  } catch (Throwable $e) {
    gallery_unlink($img['files']);                       // don't orphan files on a failed insert
    hm_log_error('gallery insert failed', ['err' => $e->getMessage()]);
    g_err('保存に失敗しました', 500);
  }
  g_json(['data' => gallery_fetch_row($id)], 201);
}

// PUT application/json → update metadata/flags; optional base64 image replacement.
function gallery_update(): void {
  $body = gallery_json_body();
  $id   = (int)($body['id'] ?? ($_GET['id'] ?? 0));
  if ($id <= 0) g_err('id が必要です', 422);

  $existing = gallery_fetch_raw($id);
  if (!$existing) g_err('対象が見つかりません', 404);

  $sets = [];
  $args = [];
  $addStr = function (string $col, $val, int $max, bool $nullable = false) use (&$sets, &$args) {
    $v = gallery_str((string)$val, $max);
    if ($nullable) { $sets[] = "$col = ?"; $args[] = ($v !== '' ? $v : null); }
    else {
      if ($v === '') g_err("$col は空にできません", 422);
      $sets[] = "$col = ?"; $args[] = $v;
    }
  };

  if (array_key_exists('title', $body))       $addStr('title', $body['title'], 120);
  if (array_key_exists('alt_text', $body))    $addStr('alt_text', $body['alt_text'], 200);
  if (array_key_exists('description', $body)) $addStr('description', $body['description'], 400, true);
  if (array_key_exists('category', $body)) {
    $c = gallery_str((string)$body['category'], 40); $sets[] = 'category = ?'; $args[] = ($c !== '' ? $c : 'general');
  }
  if (array_key_exists('display_order', $body)) { $sets[] = 'display_order = ?'; $args[] = (int)$body['display_order']; }
  if (array_key_exists('is_active', $body))     { $sets[] = 'is_active = ?';     $args[] = gallery_bool($body['is_active']); }
  if (array_key_exists('is_featured', $body))   { $sets[] = 'is_featured = ?';   $args[] = gallery_bool($body['is_featured']); }

  // Optional image replacement — base64 payload (data URI or bare base64).
  $newFiles = null;
  if (!empty($body['image_base64'])) {
    $tmp = gallery_base64_to_tmp((string)$body['image_base64']);   // validates size, or throws g_err
    $img = gallery_process_image($tmp);
    @unlink($tmp);
    $newFiles = $img['files'];
    $sets[] = 'image_url = ?';  $args[] = $img['image_url'];
    $sets[] = 'image_webp = ?'; $args[] = $img['image_webp'];
    $sets[] = 'thumb_url = ?';  $args[] = $img['thumb_url'];
    $sets[] = 'width = ?';      $args[] = $img['width'];
    $sets[] = 'height = ?';     $args[] = $img['height'];
  }

  if (!$sets) g_err('更新する項目がありません', 422);

  try {
    $args[] = $id;
    $st = hm_db()->prepare('UPDATE website_gallery SET ' . implode(', ', $sets) . ' WHERE id = ?');
    $st->execute($args);
  } catch (Throwable $e) {
    if ($newFiles) gallery_unlink($newFiles);
    hm_log_error('gallery update failed', ['err' => $e->getMessage(), 'id' => $id]);
    g_err('更新に失敗しました', 500);
  }

  // Image was replaced → delete the old files from disk (post-commit).
  if ($newFiles) {
    gallery_unlink(array_filter([
      gallery_disk_from_url($existing['image_url']  ?? ''),
      gallery_disk_from_url($existing['image_webp'] ?? ''),
      gallery_disk_from_url($existing['thumb_url']  ?? ''),
    ]));
  }
  g_json(['data' => gallery_fetch_row($id)], 200);
}

// DELETE → remove the row AND all three files from disk.
function gallery_delete(): void {
  $id = (int)($_GET['id'] ?? 0);
  if ($id <= 0) { $b = gallery_json_body(); $id = (int)($b['id'] ?? 0); }
  if ($id <= 0) g_err('id が必要です', 422);

  $row = gallery_fetch_raw($id);
  if (!$row) g_err('対象が見つかりません', 404);

  try {
    $st = hm_db()->prepare('DELETE FROM website_gallery WHERE id = ?');
    $st->execute([$id]);
  } catch (Throwable $e) {
    hm_log_error('gallery delete failed', ['err' => $e->getMessage(), 'id' => $id]);
    g_err('削除に失敗しました', 500);
  }
  // Row gone → clear its files (best-effort; a leftover file is harmless).
  gallery_unlink(array_filter([
    gallery_disk_from_url($row['image_url']  ?? ''),
    gallery_disk_from_url($row['image_webp'] ?? ''),
    gallery_disk_from_url($row['thumb_url']  ?? ''),
  ]));
  g_json(['data' => ['deleted' => $id]], 200);
}

// POST ?action=reorder → apply [{id,display_order}, ...] atomically.
function gallery_reorder(): void {
  $body  = gallery_json_body();
  $items = $body['items'] ?? $body;                  // accept {items:[...]} or a bare array
  if (!is_array($items) || !$items) g_err('items 配列が必要です', 422);

  $pairs = [];
  foreach ($items as $it) {
    if (!is_array($it) || !isset($it['id'])) g_err('各要素に id と display_order が必要です', 422);
    $pairs[] = [(int)$it['id'], (int)($it['display_order'] ?? 0)];
  }

  $db = hm_db();
  try {
    $db->beginTransaction();
    $st = $db->prepare('UPDATE website_gallery SET display_order = ? WHERE id = ?');
    foreach ($pairs as [$pid, $ord]) $st->execute([$ord, $pid]);
    $db->commit();
  } catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    hm_log_error('gallery reorder failed', ['err' => $e->getMessage()]);
    g_err('並び替えに失敗しました', 500);
  }
  g_json(['data' => ['updated' => count($pairs)]], 200);
}

// ════════════════════════════════════════════════════════════════════════════
//  Image processing
// ════════════════════════════════════════════════════════════════════════════

// Validate + store an image from a local temp file. Returns:
//   [ image_url, image_webp|null, thumb_url|null, width|null, height|null, files:[disk paths] ]
// Emits a g_err (and exits) on any validation failure. Re-encodes via GD when
// present; degrades to storing the validated raw bytes when GD is absent.
function gallery_process_image(string $srcTmp): array {
  global $GDIR, $GALLERY_MIME_EXT;

  // Real MIME from the bytes — never trust any client-declared type.
  $mime = '';
  if (function_exists('finfo_open')) {
    $fi = finfo_open(FILEINFO_MIME_TYPE);
    $mime = $fi ? (finfo_file($fi, $srcTmp) ?: '') : '';
  } elseif (function_exists('mime_content_type')) {
    $mime = mime_content_type($srcTmp) ?: '';
  }
  if (!isset($GALLERY_MIME_EXT[$mime])) {
    g_err('対応形式は JPG / PNG / WebP のみです（検出: ' . ($mime ?: '不明') . '）', 415);
  }
  $ext = $GALLERY_MIME_EXT[$mime];

  if (!is_dir($GDIR) && !@mkdir($GDIR, 0775, true) && !is_dir($GDIR)) {
    hm_log_error('gallery mkdir failed', ['dir' => $GDIR]);
    g_err('保存先フォルダを作成できません', 500);
  }

  $rand = 'g_' . bin2hex(random_bytes(10));
  $origDisk = "$GDIR/$rand.$ext";
  $webpDisk = "$GDIR/$rand.webp";
  $thumbDisk = "$GDIR/{$rand}_400.webp";

  $files = [];
  $width = null; $height = null;
  $webpUrl = null; $thumbUrl = null;

  $gd = extension_loaded('gd') && function_exists('imagecreatetruecolor');
  if ($gd) {
    $src = gallery_gd_load($srcTmp, $mime);
    if ($src === null) g_err('画像を読み込めませんでした', 422);
    $width  = imagesx($src);
    $height = imagesy($src);

    // 1) Re-encoded original (same format family — strips any embedded payload).
    if (!gallery_gd_save($src, $mime, $origDisk)) { imagedestroy($src); g_err('画像の保存に失敗しました', 500); }
    $files[] = $origDisk;

    // 2) Full-size WebP copy (when this GD build supports WebP output).
    if (function_exists('imagewebp')) {
      if (@imagewebp($src, $webpDisk, 82)) { $files[] = $webpDisk; $webpUrl = gallery_media_url("$rand.webp"); }
    }

    // 3) 400px-wide thumbnail (WebP preferred, JPEG fallback).
    $thumb = gallery_gd_thumb($src, GALLERY_THUMB_W);
    if ($thumb !== null) {
      if (function_exists('imagewebp') && @imagewebp($thumb, $thumbDisk, 80)) {
        $files[] = $thumbDisk; $thumbUrl = gallery_media_url("{$rand}_400.webp");
      } else {
        $thumbJpg = "$GDIR/{$rand}_400.jpg";
        if (@imagejpeg($thumb, $thumbJpg, 82)) { $files[] = $thumbJpg; $thumbUrl = gallery_media_url("{$rand}_400.jpg"); }
      }
      imagedestroy($thumb);
    }
    imagedestroy($src);
  } else {
    // GD unavailable → store the validated raw bytes (still safe: MIME-checked,
    // size-checked, randomized name, PHP execution denied in the uploads dir).
    hm_log_error('gallery GD missing — storing raw upload (no re-encode/webp/thumb)', ['mime' => $mime]);
    if (!@copy($srcTmp, $origDisk)) g_err('画像の保存に失敗しました', 500);
    $files[] = $origDisk;
    $dim = @getimagesize($origDisk);
    if (is_array($dim)) { $width = (int)$dim[0]; $height = (int)$dim[1]; }
  }
  @chmod($origDisk, 0644);

  return [
    'image_url'  => gallery_media_url("$rand.$ext"),
    'image_webp' => $webpUrl,
    'thumb_url'  => $thumbUrl,
    'width'      => $width,
    'height'     => $height,
    'files'      => $files,
  ];
}

function gallery_gd_load(string $path, string $mime) {
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

function gallery_gd_save($img, string $mime, string $dest): bool {
  switch ($mime) {
    case 'image/jpeg': return @imagejpeg($img, $dest, 82);
    case 'image/png':
      @imagealphablending($img, false); @imagesavealpha($img, true);
      return @imagepng($img, $dest, 6);
    case 'image/webp': return function_exists('imagewebp') ? @imagewebp($img, $dest, 82) : false;
  }
  return false;
}

// Downscale-only thumbnail to $targetW wide, alpha preserved. Returns a NEW GD
// image the caller must destroy, or null.
function gallery_gd_thumb($src, int $targetW) {
  $w = imagesx($src); $h = imagesy($src);
  if ($w <= 0 || $h <= 0) return null;
  if ($w <= $targetW) { $targetW = $w; }               // never upscale
  $targetH = max(1, (int)round($h * ($targetW / $w)));
  $dst = imagecreatetruecolor($targetW, $targetH);
  if (!$dst) return null;
  imagealphablending($dst, false); imagesavealpha($dst, true);
  $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
  imagefilledrectangle($dst, 0, 0, $targetW, $targetH, $transparent);
  imagecopyresampled($dst, $src, 0, 0, 0, 0, $targetW, $targetH, $w, $h);
  return $dst;
}

// Decode a base64 (optionally data-URI-prefixed) image into a temp file.
function gallery_base64_to_tmp(string $b64): string {
  if (preg_match('#^data:[^;]+;base64,#i', $b64)) $b64 = preg_replace('#^data:[^;]+;base64,#i', '', $b64);
  $bytes = base64_decode(strtr(trim($b64), ' ', '+'), true);
  if ($bytes === false || $bytes === '') g_err('画像データが不正です', 422);
  if (strlen($bytes) > GALLERY_MAX_BYTES) g_err('ファイルが大きすぎます（最大 5MB）', 413);
  $tmp = tempnam(sys_get_temp_dir(), 'hmg');
  if ($tmp === false || file_put_contents($tmp, $bytes) === false) g_err('一時ファイルの作成に失敗しました', 500);
  return $tmp;
}

// ════════════════════════════════════════════════════════════════════════════
//  URL / disk mapping (media bucket, served by storage.php?action=get)
// ════════════════════════════════════════════════════════════════════════════

// Absolute URL for a file stored under media/gallery/<name>, pointing at the
// public `media` bucket via storage.php on THIS API host.
function gallery_media_url(string $name): string {
  $rel = 'gallery/' . $name;
  return gallery_api_origin() . '/storage.php?action=get&bucket=media&path=' . rawurlencode($rel);
}

// scheme://host + the hm-api base path (this script is at <base>/admin/gallery.php).
function gallery_api_origin(): string {
  $https  = (($_SERVER['HTTPS'] ?? '') === 'on') || ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443);
  $scheme = $https ? 'https' : 'http';
  $host   = (string)($_SERVER['HTTP_HOST'] ?? 'localhost');
  $base   = str_replace('\\', '/', dirname(dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/hm-api/admin/gallery.php'))));
  $base   = rtrim($base, '/');
  return $scheme . '://' . $host . $base;
}

// Map a stored media URL back to its disk path (for deletion). Returns null when
// the URL is not one of our media-bucket storage URLs.
function gallery_disk_from_url(string $url): ?string {
  global $ROOT;
  if ($url === '') return null;
  $q = parse_url($url, PHP_URL_QUERY);
  if (!$q) return null;
  parse_str($q, $p);
  if (($p['bucket'] ?? '') !== 'media' || empty($p['path'])) return null;
  // Reuse storage.php's path sanitizer semantics: no traversal, safe chars only.
  $parts = array_filter(explode('/', str_replace('\\', '/', (string)$p['path'])), fn($x) => $x !== '' && $x !== '.' && $x !== '..');
  $clean = implode('/', array_map(fn($x) => preg_replace('/[^A-Za-z0-9._-]/', '', $x), $parts));
  if ($clean === '') return null;
  return "$ROOT/media/$clean";
}

// ════════════════════════════════════════════════════════════════════════════
//  Small DB / value helpers
// ════════════════════════════════════════════════════════════════════════════

function gallery_next_order(): int {
  $v = hm_db()->query('SELECT COALESCE(MAX(display_order), -1) + 1 AS n FROM website_gallery')->fetch();
  return (int)($v['n'] ?? 0);
}

function gallery_fetch_raw(int $id): ?array {
  $st = hm_db()->prepare('SELECT * FROM website_gallery WHERE id = ? LIMIT 1');
  $st->execute([$id]);
  $r = $st->fetch();
  return $r ?: null;
}

function gallery_fetch_row(int $id): array {
  $r = gallery_fetch_raw($id);
  return $r ? gallery_shape_row($r) : ['id' => $id];
}

// Normalize a DB row into the admin JSON shape (typed).
function gallery_shape_row(array $r): array {
  return [
    'id'            => (int)$r['id'],
    'title'         => (string)$r['title'],
    'description'   => $r['description'] !== null ? (string)$r['description'] : null,
    'alt_text'      => (string)$r['alt_text'],
    'image_url'     => (string)$r['image_url'],
    'image_webp'    => $r['image_webp'] !== null ? (string)$r['image_webp'] : null,
    'thumb_url'     => $r['thumb_url']  !== null ? (string)$r['thumb_url']  : null,
    'width'         => $r['width']  !== null ? (int)$r['width']  : null,
    'height'        => $r['height'] !== null ? (int)$r['height'] : null,
    'category'      => (string)$r['category'],
    'display_order' => (int)$r['display_order'],
    'is_active'     => (int)$r['is_active'] === 1,
    'is_featured'   => (int)$r['is_featured'] === 1,
    'created_at'    => $r['created_at'] ?? null,
    'updated_at'    => $r['updated_at'] ?? null,
  ];
}

function gallery_str($v, int $max): string {
  $s = trim((string)$v);
  if ($s === '') return '';
  // Multibyte-safe truncation to the column's char budget.
  return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
}

function gallery_bool($v): int {
  if (is_bool($v)) return $v ? 1 : 0;
  $s = strtolower(trim((string)$v));
  return ($s === '1' || $s === 'true' || $s === 'on' || $s === 'yes') ? 1 : 0;
}

function gallery_json_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === '' || $raw === false) return [];
  $j = json_decode($raw, true);
  if (!is_array($j)) g_err('Invalid JSON body', 400);
  return $j;
}

function gallery_unlink(array $paths): void {
  foreach ($paths as $p) { if (is_string($p) && $p !== '' && is_file($p)) @unlink($p); }
}

// ── Response emitters (spec shape: {data|error, code}) ──────────────────────
function g_json(array $payload, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
  if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
  echo json_encode($payload, $flags);
  exit;
}
function g_err(string $message, int $status = 400): void {
  g_json(['error' => $message, 'code' => $status], $status);
}
