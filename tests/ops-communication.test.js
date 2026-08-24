/* ════════════════════════════════════════════════════════════════════════════
   ops-communication.test.js — OPS Communication Center guard/wiring assertions

   Static source assertions (no DB / no network) verifying the first
   implementation pass of §K1–K5 stays within its guarantees:
     • internal-notes visibility boundary is enforced SERVER-side (chat.php +
       contact-chat.php skip labels.internal before customer serialization);
     • ops-core exposes the new control methods over EXISTING endpoints/columns;
     • the Communication Center reuses existing endpoints (no new chat system);
     • NO new table / schema change / Supabase / worker role is introduced;
     • nav is repointed and locale keys exist in both languages.

   Run:  node tests/ops-communication.test.js       (also: npm run test:ops-comm)
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } }
function section(name) { console.log('\n• ' + name); }

/* ── 1. Server-side internal-notes boundary ──────────────────────────────── */
section('Internal notes are filtered SERVER-side (never reach the customer)');
const chatPhp = read('hm-api/chat.php');
const ccPhp   = read('hm-api/contact-chat.php');
ok(/if \(!empty\(\$labels\['internal'\]\)\) continue;/.test(chatPhp),
  'chat.php list serializer skips labels.internal rows');
ok(/if \(!empty\(\$labels\['internal'\]\)\) continue;/.test(ccPhp),
  'contact-chat.php cc_messages skips labels.internal rows');
// The guard must sit BEFORE the row is pushed into the customer payload.
ok(chatPhp.indexOf("labels['internal']") < chatPhp.indexOf("'sender_type' => $isOutbound"),
  'chat.php internal guard precedes message serialization');
ok(ccPhp.indexOf("labels['internal']") < ccPhp.indexOf("'sender_type' =>"),
  'contact-chat.php internal guard precedes message serialization');

/* ── 2. ops-core new Api methods (existing endpoints/columns only) ───────── */
section('ops-core.js exposes control methods over existing endpoints');
const core = read('ops/js/ops-core.js');
['contactReply', 'contactMeta', 'contactClose', 'setAssignee', 'setConvStatus',
 'setArchived', 'markThreadRead', 'setPriority', 'addInternalNote', 'auditAction', 'listStaff']
  .forEach((m) => ok(new RegExp('\\b' + m + ':\\s*function').test(core), 'ops-core Api.' + m + ' defined'));
ok(/contact-chat\.php\?action=admin-reply/.test(core), 'contactReply uses existing contact-chat.php admin-reply');
ok(/table:\s*'inbox_messages',\s*action:\s*'update'/.test(core), 'assignment/status write via rest.php update on inbox_messages');
ok(/internal:\s*true/.test(core), 'addInternalNote flags labels.internal');
ok(/table:\s*'audit_log'/.test(core), 'auditAction writes to existing audit_log');
// Priority must be read-modify-write on the anchor row id (never a bulk labels smear).
ok(/setPriority:[\s\S]*?filters:\s*\[\{\s*col:\s*'id'/.test(core),
  'setPriority updates labels by anchor row id (no labels clobber)');

/* ── 3. Communication Center reuses existing infra (Phase 1: conversations.php) ── */
section('communication.js uses the scoped conversations.php data path');
const comm = read('ops/js/communication.js');
ok(/Api\.convList\(\)/.test(comm) && /Api\.listBookings\(\)/.test(comm), 'reads via conversations.php (convList) + rest bookings context');
ok(/Api\.convReply\(/.test(comm), 'reply routes through conversations.php (contact + booking)');
ok(/Api\.sendEmail\(/.test(comm), 'email-only threads reply via existing send-email.php');
ok(/Api\.convNote\(/.test(comm), 'internal notes via conversations.php');
ok(/Api\.convAssign\(|Api\.convStatus\(|Api\.convArchived\(|Api\.convPriority\(/.test(comm), 'management controls via conversations.php');
ok(/Api\.convMarkRead\(/.test(comm), 'read-state via conversations.php');
ok(!/Api\.auditAction\(/.test(comm), 'client no longer asserts the audit actor (server-side audit now)');
['all','unread','contact','estimate','booking','mine','unassigned','active','waiting','resolved','archived']
  .forEach((f) => ok(comm.indexOf("'" + f + "'") >= 0, 'filter present: ' + f));

/* ── 4. Hard constraints: no new table / schema / Supabase / worker role ─── */
section('No new table / schema change / Supabase / worker role in this pass');
[['ops/js/communication.js', comm], ['ops/js/ops-core.js', core],
 ['hm-api/chat.php', chatPhp], ['hm-api/contact-chat.php', ccPhp]]
  .forEach(([name, src]) => {
    ok(!/supabase/i.test(src), name + ' has no Supabase reference');
    ok(!/\bALTER\s+TABLE\b/i.test(src), name + ' issues no ALTER TABLE');
    ok(!/CREATE\s+TABLE(?!\s+IF\s+NOT\s+EXISTS\s+audit_log|\s+IF\s+NOT\s+EXISTS\s+contact_conversations)/i.test(src),
      name + ' creates no new table');
    ok(!/['"]worker['"]/.test(src), name + ' introduces no worker role literal');
  });
// contact-chat.php guard edit must not have touched the existing table-ensure set.
ok(ccPhp.indexOf('CREATE TABLE IF NOT EXISTS contact_conversations') >= 0,
  'contact-chat.php keeps its pre-existing idempotent table ensure (unchanged)');

/* ── 5. Nav repoint + shell + locale parity ──────────────────────────────── */
section('Nav repoint, HTML shell, and bilingual locale keys');
ok(/key:\s*'chat',\s*href:\s*'communication\.html'/.test(core), "nav 'chat' repointed to communication.html");
const html = read('ops/communication.html');
['js/ops-core.js', 'js/communication.js', 'css/communication.css', 'css/messages.css', 'locales/ja.js']
  .forEach((f) => ok(html.indexOf(f) >= 0, 'communication.html includes ' + f));
const ja = read('locales/ja.js'), en = read('locales/en.js');
['comm.title', 'comm.f.contact', 'comm.f.estimate', 'comm.note.hint', 'comm.type.booking']
  .forEach((k) => { ok(ja.indexOf('"' + k + '"') >= 0, 'ja.js has ' + k); ok(en.indexOf('"' + k + '"') >= 0, 'en.js has ' + k); });

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log('\n──────────────────────────────────────────');
console.log(`ops-communication: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
