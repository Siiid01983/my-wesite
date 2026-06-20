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
$PUBLIC  = ['media'];   // buckets readable without a signed URL

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
    $bucket = sanitize_seg($_POST['bucket'] ?? '');
    $path   = sanitize_path($_POST['path'] ?? '');
    if ($bucket === '' || $path === '' || !isset($_FILES['file'])) hm_err('Missing bucket/path/file', 400);
    $dest = "$ROOT/$bucket/$path";
    $dir  = dirname($dest);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    if (!@move_uploaded_file($_FILES['file']['tmp_name'], $dest)) hm_err('Upload write failed', 500);
    hm_ok(['path' => $path]);
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
  hm_err('Storage error: ' . $e->getMessage(), 500);
}
