'use strict';
/**
 * Admin allowlist drift guard — RLS audit finding P2-7
 *
 * The portal admin allowlist (`ADMIN_EMAILS`) is duplicated:
 *   - client : js/portal/portalSupabaseAuth.js   (relaxes the UI reference check)
 *   - server : supabase/functions/portal-auth/index.ts  (authoritative)
 *
 * The server is authoritative, so drift can only ever make the client
 * UNDER-grant (never bypass) — but a silent divergence is a confusing UX bug.
 * This test fails the moment the two lists stop matching.
 *
 * Unlike the rest of the suite, this test is pure filesystem parsing:
 * no dev server, no Playwright, no network. Run: node --test tests/adminAllowlist.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLIENT_FILE = path.join(ROOT, 'js', 'portal', 'portalSupabaseAuth.js');
const SERVER_FILE = path.join(ROOT, 'supabase', 'functions', 'portal-auth', 'index.ts');

/**
 * Extract the email set from an `ADMIN_EMAILS = [...]` declaration.
 * Anchors on `ADMIN_EMAILS =` so the `ADMIN_EMAILS` mentioned in comments
 * (e.g. "MUST mirror ADMIN_EMAILS in …") is ignored. Handles both the client
 * array literal and the server `new Set<string>([ … ])` form.
 */
function parseAdminEmails(file) {
  const src = readFileSync(file, 'utf8');
  const decl = src.match(
    /ADMIN_EMAILS\s*=\s*(?:new\s+Set\s*(?:<[^>]*>)?\s*\()?\s*\[([^\]]*)\]/
  );
  assert.ok(decl, `Could not locate an ADMIN_EMAILS = [...] declaration in ${path.basename(file)}`);
  const emails = [...decl[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) =>
    m[1].trim().toLowerCase()
  );
  return new Set(emails);
}

describe('admin allowlist drift guard (P2-7)', () => {
  it('parses a non-empty allowlist from both files', () => {
    const client = parseAdminEmails(CLIENT_FILE);
    const server = parseAdminEmails(SERVER_FILE);
    // Guard against a parser regression silently yielding two empty sets,
    // which would otherwise "match" and hide real drift.
    assert.ok(client.size > 0, 'client ADMIN_EMAILS parsed empty');
    assert.ok(server.size > 0, 'server ADMIN_EMAILS parsed empty');
  });

  it('client and server ADMIN_EMAILS are identical (normalised)', () => {
    const client = [...parseAdminEmails(CLIENT_FILE)].sort();
    const server = [...parseAdminEmails(SERVER_FILE)].sort();
    assert.deepEqual(
      client,
      server,
      `Allowlist drift: client (${CLIENT_FILE}) and server (${SERVER_FILE}) ADMIN_EMAILS diverge.\n` +
        `  client: ${JSON.stringify(client)}\n  server: ${JSON.stringify(server)}\n` +
        `Update both lists together — see the "MUST mirror" comment in portalSupabaseAuth.js.`
    );
  });
});
