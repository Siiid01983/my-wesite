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
    $env:FTP_REMOTE="/public_html"           # optional
    $env:SUPABASE_URL="https://ursohvtxzqxeczvrspiw.supabase.co"
    $env:SUPABASE_ANON_KEY="your-anon-key"
    node deploy.js

  Usage (bash):
    FTP_HOST=... FTP_USERNAME=... FTP_PASSWORD=... SUPABASE_URL=... SUPABASE_ANON_KEY=... node deploy.js
*/

const ftp  = require('basic-ftp');
const path = require('path');
const fs   = require('fs');

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

async function uploadDir(client, localDir, remotePath) {
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.htaccess') continue;
    if (entry.name.endsWith('.test.js')) continue;

    const localPath = path.join(localDir, entry.name);
    const dest      = remotePath + '/' + entry.name;

    if (entry.isDirectory()) {
      await client.ensureDir(dest);
      await uploadDir(client, localPath, dest);
    } else {
      const rel = path.relative(__dirname, localPath).replace(/\\/g, '/');
      process.stdout.write('  ' + rel + ' … ');
      await client.uploadFrom(localPath, dest);
      process.stdout.write('done\n');
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
    await client.ensureDir(REMOTE);
    await uploadDir(client, __dirname, REMOTE);
    console.log(`\n✓ Deploy complete → ${HOST}${REMOTE}`);
  } catch (err) {
    console.error('\n✗ Deploy failed:', err.message);
    process.exit(1);
  } finally {
    client.close();
  }
})();
