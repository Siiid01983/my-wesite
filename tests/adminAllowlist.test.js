'use strict';
/**
 * Admin allowlist guard — RLS audit finding P2-7 (updated for self-hosted build)
 *
 * Originally this test guarded DRIFT between two copies of `ADMIN_EMAILS`:
 *   - client : js/portal/portalLogin.js
 *   - server : the server-side Edge Function (removed in the cPanel migration)
 *
 * The API Edge Function was deleted in the cPanel migration. The portal no
 * longer has a server-side admin allowlist (admins use admin.html with the local
 * Auth module; hm-api/auth.php only verifies email + booking reference). With a
 * single source of truth there is no drift to guard, so this test now simply
 * asserts the client allowlist still parses to a non-empty set of valid emails.
 *
 * Pure filesystem parsing: no dev server, no Playwright, no network.
 * Run: node --test tests/adminAllowlist.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLIENT_FILE = path.join(ROOT, 'js', 'portal', 'portalLogin.js');

/**
 * Extract the email set from an `ADMIN_EMAILS = [...]` declaration.
 * Anchors on `ADMIN_EMAILS =` so the `ADMIN_EMAILS` mentioned in comments is ignored.
 */
function parseAdminEmails(file) {
  const src = readFileSync(file, 'utf8');
  const decl = src.match(/ADMIN_EMAILS\s*=\s*\[([^\]]*)\]/);
  assert.ok(decl, `Could not locate an ADMIN_EMAILS = [...] declaration in ${path.basename(file)}`);
  const emails = [...decl[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1].trim().toLowerCase());
  return new Set(emails);
}

describe('admin allowlist guard (P2-7)', () => {
  it('client ADMIN_EMAILS parses to a non-empty set', () => {
    const client = parseAdminEmails(CLIENT_FILE);
    assert.ok(client.size > 0, 'client ADMIN_EMAILS parsed empty');
  });

  it('every admin entry is a valid, lowercase email', () => {
    const client = parseAdminEmails(CLIENT_FILE);
    for (const email of client) {
      assert.match(email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, `invalid admin email: ${email}`);
      assert.equal(email, email.toLowerCase(), `admin email not lowercase: ${email}`);
    }
  });
});
