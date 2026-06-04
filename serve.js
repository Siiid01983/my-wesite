const http = require('http');
const fs = require('fs');
const path = require('path');
const root = 'C:/Users/DELL/my-website';
http.createServer((req, res) => {
  const f = path.join(root, req.url === '/' ? '/index.html' : req.url);
  try {
    const d = fs.readFileSync(f);
    const ext = path.extname(f).slice(1);
    const ct = { html: 'text/html', css: 'text/css', js: 'application/javascript' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(d);
  } catch (e) {
    res.writeHead(404); res.end();
  }
}).listen(8787, () => console.log('ready'));
