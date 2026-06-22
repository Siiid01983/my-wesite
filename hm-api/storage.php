<?php
// ════════════════════════════════════════════════════════════════════════════
//  storage.php — file storage (server-filesystem buckets)
//
//  Buckets are folders under storage_dir/<bucket>/. Public buckets are served
//  directly; private buckets require a short-lived HMAC-signed URL.
//
//  Actions (?action=):
//    upload  POST multipart: bucket, path, file        → { data:{path}, error }
//    list    GET  ?bucket=&prefix=                      → { data:[{name,...}], error }
//    remove  POST JSON { bucket, paths:[...] }          → { data, error }
//    sign    GET  ?bucket=&path=&ttl=                   → { data:{signedUrl}, error }
//    get     GET  ?bucket=&path=[&exp=&sig=]            → streams the file bytes
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';

$cfg     = hm_config();
$ROOT    = rtrim((string)($cfg['storage_dir'] ?? (__DIR__ . '/_uploads')), '/\\');
$SECRET  = (string)($cfg['storage_secret'] ?? 'change-me');
// Public vs private buckets — this is why retrieval "behaves differently" per
// surface, NOT a bug: 'media' (the WMC media library) is world-readable via a
// plain ?action=get URL (getPublicUrl). Every OTHER bucket — customer portal
// photos/documents/attachments — is PRIVATE and only reachable through a
// short-lived HMAC-signed URL (createSignedUrl). Uploads use the identical path
// for all buckets; only read access differs.
$PUBLIC  = ['media'];   // buckets readable without a signed URL

// Upload guards (server-enforced — the OS-level PHP limits should be raised in
// hm-api/.user.ini so large phone photos are not silently rejected first).
$MAX_BYTES    = (int)($cfg['upload_max_bytes'] ?? 15 * 1024 * 1024);   // 15 MB default
$ALLOWED_MIME = is_array($cfg['upload_allowed_mime'] ?? null) ? $cfg['upload_allowed_mime'] : [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

$action  = $_GET['action'] ?? '';

// `get` streams binary — handle before the JSON CORS path.
if ($action === 'get') {
  $bucket = sanitize_seg($_GET['bucket'] ?? '');
  $path   = sanitize_path($_GET['path'] ?? '');
  if ($bucket === '' || $path === '') { http_response_code(400); exit('bad request'); }

  if (!in_array($bucket, $PUBLIC, true)) {
    $exp = (int)($_GET['exp'] ?? 0);
    $sig = (string)($_GET['sig'] ?? '');
    $expected = hash_hmac('sha256', "$bucket/$path:$exp", $SECRET);
    if ($exp < time() || !hash_equals($expected, $sig)) { http_response_code(403); exit('forbidden'); }
  }
  $file = "$ROOT/$bucket/$path";
  if (!is_file($file)) { http_response_code(404); exit('not found'); }
  header('Content-Type: ' . (mime_content_type($file) ?: 'application/octet-stream'));
  header('Content-Length: ' . filesize($file));
  header('Cache-Control: private, max-age=300');
  readfile($file);
  exit;
}

hm_cors();
hm_require_api_key();
require_once __DIR__ . '/_ratelimit.php';
hm_rate_limit('storage', 60, 60);   // upload/list/sign/remove; binary `get` returned above is unthrottled

function sanitize_seg(string $s): string { return preg_replace('/[^A-Za-z0-9._-]/', '', $s); }
function sanitize_path(string $s): string {
  $s = str_replace('\\', '/', $s);
  $parts = array_filter(explode('/', $s), fn($p) => $p !== '' && $p !== '.' && $p !== '..');
  return implode('/', array_map(fn($p) => preg_replace('/[^A-Za-z0-9._-]/', '', $p), $parts));
}
function self_url(): string {
  $https = (($_SERVER['HTTPS'] ?? '') === 'on') || (($_SERVER['SERVER_PORT'] ?? '') == 443);
  $scheme = $https ? 'https' : 'http';
  return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost')
    . strtok($_SERVER['REQUEST_URI'] ?? '/storage.php', '?');
}

try {
  if ($action === 'upload') {
    // When the POST body exceeds PHP's post_max_size, PHP discards BOTH $_POST
    // and $_FILES — yet the request still routes here (the action is in the query
    // string). An empty body with a non-zero Content-Length therefore means the
    // upload was too large for the server, NOT a missing field. This was the
    // silent "customers can't upload images" failure: phone photos exceed the
    // default post_max_size and produced a misleading "missing field" 400.
    $contentLen = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if (empty($_POST) && empty($_FILES) && $contentLen > 0) {
      hm_log_error('upload exceeds post_max_size', ['content_length' => $contentLen]);
      hm_err('ファイルが大きすぎます（サーバー上限を超過しています）/ Upload exceeds the server size limit', 413, 'post_too_large');
    }

    $bucket = sanitize_seg($_POST['bucket'] ?? '');
    $path   = sanitize_path($_POST['path'] ?? '');
    if ($bucket === '' || $path === '') hm_err('Missing bucket or path', 400, 'missing_field');
    if (!isset($_FILES['file']))        hm_err('No file received', 400, 'no_file');

    // Surface PHP's own per-file upload error codes with actionable messages
    // instead of an opaque 500.
    $uerr = $_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE;
    if ($uerr !== UPLOAD_ERR_OK) {
      $map = [
        UPLOAD_ERR_INI_SIZE   => ['ファイルが大きすぎます（upload_max_filesize 超過）', 413, 'ini_size'],
        UPLOAD_ERR_FORM_SIZE  => ['ファイルが大きすぎます', 413, 'form_size'],
        UPLOAD_ERR_PARTIAL    => ['アップロードが中断されました。再試行してください', 400, 'partial'],
        UPLOAD_ERR_NO_FILE    => ['ファイルが選択されていません', 400, 'no_file'],
        UPLOAD_ERR_NO_TMP_DIR => ['サーバー設定エラー（一時フォルダがありません）', 500, 'no_tmp_dir'],
        UPLOAD_ERR_CANT_WRITE => ['サーバーへの書き込みに失敗しました', 500, 'cant_write'],
        UPLOAD_ERR_EXTENSION  => ['アップロードが拒否されました', 500, 'ext'],
      ];
      [$m, $st, $slug] = $map[$uerr] ?? ['アップロードに失敗しました', 500, 'unknown'];
      hm_log_error('upload php-error', ['code' => $uerr, 'slug' => $slug, 'bucket' => $bucket]);
      hm_err($m, $st, $slug);
    }

    $tmp  = (string)($_FILES['file']['tmp_name'] ?? '');
    $size = (int)($_FILES['file']['size'] ?? 0);
    if ($tmp === '' || !is_uploaded_file($tmp)) hm_err('Invalid upload', 400, 'bad_tmp');
    if ($size <= 0)         hm_err('空のファイルです', 400, 'empty');
    if ($size > $MAX_BYTES) hm_err('ファイルが大きすぎます（最大 ' . (int)round($MAX_BYTES / 1048576) . 'MB）', 413, 'too_large');

    // Validate the MIME type from the actual file bytes — never trust the
    // client-declared content type.
    $mime = '';
    if (function_exists('finfo_open')) {
      $fi   = finfo_open(FILEINFO_MIME_TYPE);
      $mime = $fi ? (finfo_file($fi, $tmp) ?: '') : '';
    } elseif (function_exists('mime_content_type')) {
      $mime = mime_content_type($tmp) ?: '';
    }
    if ($ALLOWED_MIME && $mime && !in_array($mime, $ALLOWED_MIME, true)) {
      hm_log_error('upload bad mime', ['mime' => $mime, 'bucket' => $bucket]);
      hm_err('対応していないファイル形式です（' . $mime . '）', 415, 'bad_mime');
    }

    $dest = "$ROOT/$bucket/$path";
    $dir  = dirname($dest);
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
      hm_log_error('upload mkdir failed', ['dir' => $dir]);
      hm_err('保存先フォルダを作成できません', 500, 'mkdir_failed');
    }
    if (!is_writable($dir)) {
      hm_log_error('upload dir not writable', ['dir' => $dir]);
      hm_err('保存先フォルダに書き込めません（権限を確認してください）', 500, 'not_writable');
    }
    if (!@move_uploaded_file($tmp, $dest)) {
      hm_log_error('upload move failed', ['dest' => $dest]);
      hm_err('Upload write failed', 500, 'move_failed');
    }
    @chmod($dest, 0644);
    hm_ok(['path' => $path, 'size' => $size, 'mime' => $mime]);
  }

  if ($action === 'list') {
    $bucket = sanitize_seg($_GET['bucket'] ?? '');
    $prefix = sanitize_path($_GET['prefix'] ?? '');
    $dir = "$ROOT/$bucket" . ($prefix ? "/$prefix" : '');
    $out = [];
    if (is_dir($dir)) {
      foreach (scandir($dir) as $name) {
        if ($name === '.' || $name === '..') continue;
        $full = "$dir/$name";
        $out[] = [
          'name' => $name,
          'id'   => $name,
          'metadata' => is_file($full) ? ['size' => filesize($full), 'mimetype' => mime_content_type($full)] : null,
          'created_at' => is_file($full) ? date('c', filemtime($full)) : null,
        ];
      }
    }
    hm_ok($out);
  }

  if ($action === 'remove') {
    $p = hm_body();
    $bucket = sanitize_seg($p['bucket'] ?? '');
    $paths  = is_array($p['paths'] ?? null) ? $p['paths'] : [];
    $removed = [];
    foreach ($paths as $rel) {
      $rel = sanitize_path((string)$rel);
      $file = "$ROOT/$bucket/$rel";
      if (is_file($file) && @unlink($file)) $removed[] = ['name' => $rel];
    }
    hm_ok($removed);
  }

  if ($action === 'sign') {
    $bucket = sanitize_seg($_GET['bucket'] ?? '');
    $path   = sanitize_path($_GET['path'] ?? '');
    $ttl    = max(30, min(86400, (int)($_GET['ttl'] ?? 300)));
    if ($bucket === '' || $path === '') hm_err('Missing bucket/path', 400);
    $exp = time() + $ttl;
    $sig = hash_hmac('sha256', "$bucket/$path:$exp", $SECRET);
    $url = self_url() . '?action=get&bucket=' . rawurlencode($bucket)
         . '&path=' . rawurlencode($path) . '&exp=' . $exp . '&sig=' . $sig;
    hm_ok(['signedUrl' => $url]);
  }

  hm_err('Unknown action', 400);
} catch (Throwable $e) {
  hm_log_error('storage failed', ['err' => $e->getMessage()]);
  hm_err(hm_safe_msg('Request failed', $e), 500);
}
