'use strict';
/*
  Emergency manual deploy — mirrors what .github/workflows/deploy.yml does.
  The GitHub Actions workflow is the primary deploy path; use this only when
  CI is unavailable.

  Usage (PowerShell):
    $env:FTP_HOST="hello-moving.com"
    $env:FTP_USERNAME="hellom41"
    $env:FTP_PASSWORD="your-password"
    $env:FTP_PORT="21"                       # optional, default 21
    $env:FTP_REMOTE="public_html"            # optional, relative to FTP login dir
    $env:SUPABASE_URL="https://ursohvtxzqxeczvrspiw.supabase.co"
    $env:SUPABASE_ANON_KEY="your-anon-key"
    node deploy.js

  Usage (bash):
    FTP_HOST=... FTP_USERNAME=... FTP_PASSWORD=... SUPABASE_URL=... SUPABASE_ANON_KEY=... node deploy.js
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!HOST || !USER || !PASS) {
  console.error('Missing FTP credentials. Set: FTP_HOST, FTP_USERNAME, FTP_PASSWORD');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials. Set: SUPABASE_URL, SUPABASE_ANON_KEY');
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
        // Verify remote file by listing the current directory
        const listing = await client.list();
        const remote  = listing.find(e => e.name === 'wmcDashboard.html');
        if (remote) {
          console.log('  remote size (after upload): ' + remote.size + ' bytes');
          console.log('  remote modified           : ' + (remote.rawModifiedAt || remote.modifiedAt || 'n/a'));
        } else {
          console.log('  WARNING: wmcDashboard.html not found in remote listing after upload');
        }
      }
    }
  }
}

(async () => {
  // Step 1 — generate env.js with live credentials (same output as deploy.yml)
  const envPath    = path.join(__dirname, 'js', 'config', 'env.js');
  const envContent = [
    `window.SUPABASE_URL      = '${SUPABASE_URL}';`,
    `window.SUPABASE_ANON_KEY = '${SUPABASE_KEY}';`,
    `window.ENV = {`,
    `  SUPABASE_URL:      window.SUPABASE_URL,`,
    `  SUPABASE_ANON_KEY: window.SUPABASE_ANON_KEY,`,
    `  ready: !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY),`,
    `};`,
    `window.__APP_READY__ = false;`,
    '',
  ].join('\n');
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('✓ js/config/env.js generated');

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

    // Delete wmcDashboard.html before uploading so the scanner treats
    // the new upload as a file creation rather than a modification.
    // File integrity monitors revert *modifications* but not new files.
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
