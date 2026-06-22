'use strict';
/*
  Emergency manual deploy — mirrors what .github/workflows/deploy.yml does.
  The GitHub Actions workflow is the primary deploy path; use this only when
  CI is unavailable.

  Self-hosted build: the site talks to your own PHP API (hm-api/) on cPanel,
  not a third-party backend. API_BASE is the public URL of the uploaded hm-api/ folder.

  Usage (PowerShell):
    $env:FTP_HOST="hello-moving.com"
    $env:FTP_USERNAME="hellom41"
    $env:FTP_PASSWORD="your-password"
    $env:FTP_PORT="21"                       # optional, default 21
    $env:FTP_REMOTE="public_html"            # optional, relative to FTP login dir
    $env:API_BASE="https://hello-moving.com/hm-api"
    node deploy.js

  Usage (bash):
    FTP_HOST=... FTP_USERNAME=... FTP_PASSWORD=... API_BASE=... node deploy.js
*/

const ftp    = require('basic-ftp');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// ── Credentials from environment — NEVER hardcode these ──────────────────────
const HOST   = process.env.FTP_HOST;
const USER   = process.env.FTP_USERNAME;
const PASS   = process.env.FTP_PASSWORD;
const PORT   = parseInt(process.env.FTP_PORT || '21', 10);
const REMOTE = process.env.FTP_REMOTE || 'public_html';
// FTP_SECURE=true → explicit FTPS (STARTTLS on port 21, common on cPanel)
// FTP_SECURE=implicit → implicit FTPS (port 990)
// unset / false → plain FTP (default, backward-compatible)
const SECURE_RAW = (process.env.FTP_SECURE || '').toLowerCase();
const SECURE = SECURE_RAW === 'implicit' ? 'implicit' : SECURE_RAW === 'true';

// API_BASE = public URL of the self-hosted PHP API (hm-api/). Required.
const API_BASE = process.env.API_BASE;
// API_KEY = optional; must match 'api_key' in hm-api/_config.php when the gate
// is enabled. Leave unset to ship an empty key (gate disabled).
const API_KEY  = process.env.API_KEY || '';

if (!HOST || !USER || !PASS) {
  console.error('Missing FTP credentials. Set: FTP_HOST, FTP_USERNAME, FTP_PASSWORD');
  process.exit(1);
}
if (!API_BASE) {
  console.error('Missing API_BASE. Set API_BASE to your hm-api URL (e.g. https://hello-moving.com/hm-api).');
  process.exit(1);
}

// Top-level names to skip — mirrors the deploy.yml exclude list
const SKIP = new Set([
  '.git', '.github', 'node_modules', '.claude', 'tests',
  'serve.js', 'deploy.js', 'package.json', 'package-lock.json',
  'CLAUDE.md',
]);

/*
 * Upload localDir contents into the FTP server's current working directory.
 * Uses explicit cd/cdup so the CWD is always known and uploadFrom always
 * receives just the filename — no path-prefix double-nesting.
 */
async function uploadDir(client, localDir) {
  const isRoot = localDir === __dirname;
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  for (const entry of entries) {
    if (isRoot && SKIP.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.htaccess') continue;
    if (entry.name.endsWith('.test.js')) continue;

    const localPath = path.join(localDir, entry.name);

    if (entry.isDirectory()) {
      try { await client.send('MKD ' + entry.name); } catch (_) {}  // ignore if exists
      await client.cd(entry.name);
      await uploadDir(client, localPath);
      await client.cdup();
    } else {
      const rel = path.relative(__dirname, localPath).replace(/\\/g, '/');
      const isTarget = entry.name === 'wmcDashboard.html';
      if (isTarget) {
        const buf  = fs.readFileSync(localPath);
        const sha  = crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
        const size = buf.length;
        console.log('\n  ── wmcDashboard.html pre-upload ──');
        console.log('  local path : ' + localPath);
        console.log('  local size : ' + size + ' bytes');
        console.log('  local SHA256: ' + sha);
      }
      process.stdout.write('  ' + rel + ' … ');
      await client.uploadFrom(localPath, entry.name);
      process.stdout.write('done\n');
      if (isTarget) {
        // Check permissions and force 644 in case scanner set them to 000
        try {
          await client.send('SITE CHMOD 644 wmcDashboard.html');
          console.log('  chmod 644 applied');
        } catch (e) {
          console.log('  chmod 644 failed: ' + e.message);
        }
        // List to confirm size and read raw permissions line
        const listing = await client.list();
        const remote  = listing.find(e => e.name === 'wmcDashboard.html');
        if (remote) {
          console.log('  remote size (after upload): ' + remote.size + ' bytes');
          console.log('  remote modified           : ' + (remote.rawModifiedAt || remote.modifiedAt || 'n/a'));
          console.log('  remote rawList entry      : ' + JSON.stringify(remote));
        } else {
          console.log('  WARNING: wmcDashboard.html not found in remote listing after upload');
        }
      }
    }
  }
}

(async () => {
  // Step 1 — generate env.js pointing the data client at the self-hosted PHP API.
  const envPath    = path.join(__dirname, 'js', 'config', 'env.js');
  const envContent = [
    `// Generated by deploy.js — self-hosted PHP + MySQL API base.`,
    `// Same-origin: the API lives at /hm-api under whatever host the page loads`,
    `// on (apex or www), so API calls are never cross-origin and CORS never applies.`,
    `window.API_BASE = window.location.origin + '/hm-api';`,
    `window.API_KEY  = '${API_KEY}';`,
    `window.ENV = {`,
    `  API_BASE: window.API_BASE,`,
    `  API_KEY:  window.API_KEY,`,
    `  ready: !!window.API_BASE,`,
    `};`,
    `window.__APP_READY__ = false;`,
    '',
  ].join('\n');
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('✓ js/config/env.js generated → API_BASE:', API_BASE, '| API_KEY:', API_KEY ? 'set' : '(empty)');

  // Step 2 — upload everything to the server
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    console.log(`Connecting to ${HOST}:${PORT} …`);
    const accessOpts = { host: HOST, user: USER, password: PASS, port: PORT, secure: SECURE };
    if (SECURE) accessOpts.secureOptions = { rejectUnauthorized: false };
    await client.access(accessOpts);
    console.log('Connected.');
    const pwdAfterLogin = await client.pwd();
    console.log('CWD after login:', pwdAfterLogin);
    const lsRoot = await client.list();
    console.log('Root entries:', lsRoot.map(e => (e.isDirectory ? 'd' : '-') + ' ' + e.name).join(', '));
    // cPanel FTP may log in directly to public_html (login CWD = '/').
    // Calling ensureDir('public_html') in that state would create
    // public_html/public_html/ (double-nesting) and silently upload
    // everything to the wrong path.  Navigate in only when the listing
    // shows public_html as a subdirectory of the current CWD.
    const needsCd = lsRoot.some(e => e.isDirectory && e.name === REMOTE);
    if (needsCd) {
      await client.cd(REMOTE);
      console.log('Navigated into', REMOTE);
    } else {
      console.log('Login CWD is already the web root — skipping cd into', REMOTE);
    }
    const pwdAfterSetup = await client.pwd();
    console.log('CWD for upload:', pwdAfterSetup);

    // Delete wmcDashboard.html before uploading.
    console.log('\n── Pre-deploy: removing wmcDashboard.html from server ──');
    try {
      await client.remove('wmcDashboard.html');
      console.log('  Deleted existing wmcDashboard.html');
    } catch (e) {
      console.log('  wmcDashboard.html not present on server (first deploy or already removed)');
    }

    await uploadDir(client, __dirname); // upload relative to CWD
    console.log(`\n✓ Deploy complete → ${HOST}/${REMOTE}`);

    // Production content verification
    console.log('\n── Production content check ──');
    const https    = require('https');
    const prodUrl  = `https://${HOST}/wmcDashboard.html`;
    const prodHtml = await new Promise((resolve, reject) => {
      https.get(prodUrl, { rejectUnauthorized: false }, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });
    console.log('  URL         : ' + prodUrl);
    console.log('  HTTP status : ' + prodHtml.status);
    console.log('  Content-Length header : ' + (prodHtml.headers['content-length'] || 'not set'));
    console.log('  Last-Modified header  : ' + (prodHtml.headers['last-modified'] || 'not set'));
    console.log('  body size (bytes)     : ' + Buffer.byteLength(prodHtml.body, 'utf8'));
    const prodSha = crypto.createHash('sha256').update(prodHtml.body).digest('hex').toUpperCase();
    console.log('  body SHA256           : ' + prodSha);
    console.log('  contains wmcServicesContent : ' + prodHtml.body.includes('wmcServicesContent'));
    console.log('  contains wmcServices.js     : ' + prodHtml.body.includes('wmcServices.js'));
    console.log('  contains wmc-placeholder    : ' + prodHtml.body.includes('wmc-placeholder'));
  } catch (err) {
    console.error('\n✗ Deploy failed:', err.message);
    process.exit(1);
  } finally {
    client.close();
  }
})();
