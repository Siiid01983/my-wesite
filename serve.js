const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 5050;
const ROOT = path.resolve(__dirname);

const MIME = {
  html:  'text/html; charset=utf-8',
  css:   'text/css; charset=utf-8',
  js:    'application/javascript; charset=utf-8',
  json:  'application/json',
  png:   'image/png',
  jpg:   'image/jpeg',
  jpeg:  'image/jpeg',
  svg:   'image/svg+xml',
  ico:   'image/x-icon',
  woff:  'font/woff',
  woff2: 'font/woff2',
  ttf:   'font/ttf',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, X-Client-Info',
  'Referrer-Policy':              'strict-origin-when-cross-origin',
  'X-Content-Type-Options':       'nosniff',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Strip query string before resolving file path
  const urlPath  = req.url.split('?')[0];
  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);

  // Prevent path-traversal outside ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  try {
    const data = fs.readFileSync(filePath);
    const ext  = path.extname(filePath).slice(1).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain', ...CORS_HEADERS });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 — Not Found</h1>');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Hello Moving — dev server`);
  console.log(`  http://localhost:${PORT}/`);
  console.log(`  http://localhost:${PORT}/admin.html`);
  console.log(`  http://localhost:${PORT}/admin-reviews.html\n`);
});
