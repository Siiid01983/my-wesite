/* ════════════════════════════════════════════════════════════════════════════
   worker-auth.test.js — Worker Phase W1 (DORMANT) guard assertions

   Static source assertions (no DB/network) proving the W1 server primitives keep
   their guarantees:
     • the 'worker' role is DORMANT by default (flag off → cannot log in);
     • worker tokens carry role 'worker' so EVERY existing staff gate rejects them;
     • rest.php staff gates exclude worker (admin|manager only) — unchanged;
     • the scoped conversations.php enforces conversation-assignment for workers and
       derives sender/actor from the TOKEN (no spoofing);
     • storage.php scopes worker attachment signing (closes §J.1 for workers);
     • the Contact Chat reply core is shared (DRY), not duplicated;
     • NO new table / schema change / Supabase / worker UI in this phase.

   Run:  node tests/worker-auth.test.js       (npm run test:worker-auth)
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function section(n) { console.log('\n• ' + n); }

const lib   = read('hm-api/_lib.php');
const cfg   = read('hm-api/_config.example.php');
const users = read('hm-api/_admin_users.php');
const login = read('hm-api/admin-login.php');
const cc    = read('hm-api/contact-chat.php');
const cclib = read('hm-api/_contact.php');
const conv  = read('hm-api/conversations.php');
const store = read('hm-api/storage.php');
const rest  = read('hm-api/rest.php');

/* ── 1. Dormant by default ───────────────────────────────────────────────── */
section('Worker role is DORMANT by default (flag off)');
ok(/function hm_worker_role_enabled\(\):\s*bool\s*\{\s*return \(bool\)\(hm_config\(\)\['worker_role_enabled'\]\s*\?\?\s*false\)/.test(lib),
  'hm_worker_role_enabled() defaults false (?? false)');
ok(/'worker_role_enabled'\s*=>\s*false/.test(cfg), '_config.example ships worker_role_enabled => false');

/* ── 2. Worker tokens carry role 'worker' (so staff gates reject them) ────── */
section('Token role: worker⇒worker, admin/manager⇒admin (unchanged)');
ok(/\$tokenRole\s*=\s*\(\$acctRole === 'worker'\)\s*\?\s*'worker'\s*:\s*'admin'/.test(login),
  'admin-login mints role=worker for worker accounts, admin otherwise');
ok(/'role'\s*=>\s*\$tokenRole/.test(login), 'token role field uses $tokenRole');

/* ── 3. Login dormancy gate ──────────────────────────────────────────────── */
section('Worker login refused while flag off');
ok(/\(string\)\(\$user\['role'\]\s*\?\?\s*''\)\s*===\s*'worker'\s*&&\s*!hm_worker_role_enabled\(\)/.test(login),
  'worker login rejected unless hm_worker_role_enabled()');
ok(login.indexOf("=== 'worker'") < login.indexOf("hm_ok([") || /worker_disabled/.test(login),
  'dormancy gate runs before issuing a token');

/* ── 4. Role provisionable ───────────────────────────────────────────────── */
section("HM_ADMIN_ROLES includes 'worker' (provisionable, management stays admin-only)");
ok(/HM_ADMIN_ROLES\s*=\s*\['admin',\s*'manager',\s*'worker'\]/.test(users), "HM_ADMIN_ROLES = admin|manager|worker");

/* ── 5. rest.php staff gates EXCLUDE worker (unchanged) ───────────────────── */
section('rest.php staff gates reject worker (admin|manager only)');
ok((lib.match(/\$role\s*!==\s*'admin'\s*&&\s*\$role\s*!==\s*'manager'/g) || []).length >= 2,
  'hm_require_staff_write AND hm_require_staff_read require admin|manager (reject worker)');
ok(!/worker/i.test(rest), 'rest.php itself is unchanged / has no worker logic');

/* ── 6. conversations.php — scoped worker authorization ───────────────────── */
section('conversations.php enforces assignment + server-derived identity');
ok(/function conv_require_access/.test(conv), 'conv_require_access gate defined');
ok(/if \(!hm_worker_role_enabled\(\)\) conv_forbid/.test(conv), 'worker branch is flag-gated (dormant)');
ok(/\$assignee === \$actor\['email'\]/.test(conv), 'worker allowed only when thread assignee == their email');
ok(/hm_conversation_assignee\(/.test(conv), 'uses shared assignee resolver');
ok(/hm_admin_user_by_id\(\$uid\)/.test(conv), 'actor email/name derived from token uid (not client)');
ok(/cc_do_admin_reply\(/.test(conv), 'contact reply reuses the shared Contact Chat core');
ok(/'sender'\s*=>?|'Hello Moving', 'Hello Moving'/.test(conv) || /'Hello Moving'/.test(conv),
  'company sender shown to customer stays "Hello Moving" (no staff-identity leak)');
ok(/'staff_id'\s*=>\s*\$actor\['uid'\]/.test(conv), 'internal staff_id recorded from token, not client');
ok(/'internal'\s*=>\s*true/.test(conv), 'note action writes labels.internal (staff-only)');
ok(/'by'\s*=>\s*\$actor\['email'\]/.test(conv), 'audit actor is server-derived (fixes client-actor weakness)');
// booking reply must derive customer email/ref from stored rows, never from the request body.
ok(/FROM inbox_messages WHERE thread_id = \?[\s\S]{0,400}\$custEmail/.test(conv),
  'booking reply derives customer email/ref server-side from existing thread rows');

/* ── 7. storage.php — worker attachment signing scope ─────────────────────── */
section('storage.php scopes worker signing (closes §J.1 for workers)');
ok(/function hm_storage_worker_sign_guard/.test(store), 'worker sign guard defined');
ok(/hm_storage_worker_sign_guard\(\$bucket, \$path\)/.test(store), 'sign action invokes the guard');
ok(/\(\$p\['role'\]\s*\?\?\s*''\)\s*!==\s*'worker'\)\s*return;/.test(store), 'guard is a no-op for non-worker callers');
ok(/\$bucket !== 'chat'.*forbidden/s.test(store) || /if \(\$bucket !== 'chat'\)/.test(store), 'workers may sign chat files only');
ok(/hm_conversation_assignee\(hm_db\(\), \$threadId\)/.test(store) && /'chat:'|'contact:'/.test(store), 'guard checks the conversation assignee (chat + contact paths)');
ok((store.match(/exit\('forbidden'\)/g) || []).length >= 3, 'guard fails closed (403) on any mismatch');

/* ── 8. DRY: shared Contact Chat core, not duplicated ─────────────────────── */
section('Contact Chat reply core is shared (not duplicated)');
ok(/function cc_do_admin_reply/.test(cclib) && /function cc_insert_message/.test(cclib) && /function cc_thread/.test(cclib),
  '_contact.php owns cc_thread/cc_insert_message/cc_do_admin_reply');
ok(/require_once __DIR__ \. '\/_contact\.php'/.test(cc), 'contact-chat.php requires the shared _contact.php');
ok(!/function cc_do_admin_reply/.test(cc) && !/function cc_insert_message/.test(cc),
  'contact-chat.php no longer defines the moved functions (no redeclare)');
ok(/cc_do_admin_reply\(\$db, \$cfg, \$row/.test(cc), 'admin-reply action delegates to the shared core');
ok(/'emailed'\s*=>\s*\$r\['emailed'\]/.test(cc), 'admin-reply still returns emailed/notify (behavior preserved)');

/* ── 9. No new table / schema / Supabase / worker UI ──────────────────────── */
section('No schema change, no Supabase, no OPS worker UI in W1');
[['_contact.php', cclib], ['conversations.php', conv], ['storage.php', store], ['_lib.php', lib], ['admin-login.php', login]]
  .forEach(([n, s]) => {
    ok(!/\bALTER\s+TABLE\b/i.test(s), n + ' has no ALTER TABLE');
    ok(!/\bCREATE\s+TABLE\b/i.test(s), n + ' creates no table');
    ok(!/supabase/i.test(s), n + ' has no Supabase');
  });
ok(!/['"]worker['"]/.test(read('ops/js/communication.js')) && !/['"]worker['"]/.test(read('ops/js/ops-core.js')),
  'no OPS worker UI branch shipped in W1 (deferred to W2)');

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log('\n──────────────────────────────────────────');
console.log(`worker-auth (W1): ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
