/* ════════════════════════════════════════════════════════════════════════════
   ops-phase1.test.js — Phase 1 "OPS full-control write surface" assertions

   Static source assertions (no DB/network) for the four Phase-1 items:
     1. 見積 control in Ops (labels.quote + agreed_price, quote email via send-email.php)
     2. Email-thread reply in Ops (existing send-email.php; no 2nd mechanism)
     3. お問い合わせ attachments (additive on contact-chat + shared core; customer can view)
     4. Ops data-path consolidation onto conversations.php (rest.php untouched)
   Plus: no schema change, no Supabase, worker phase stays dormant, admin.html quote intact.

   Run:  node tests/ops-phase1.test.js       (npm run test:ops-phase1)
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const section = (n) => console.log('\n• ' + n);

const conv  = read('hm-api/conversations.php');
const cclib = read('hm-api/_contact.php');
const cc    = read('hm-api/contact-chat.php');
const store = read('hm-api/storage.php');
const rest  = read('hm-api/rest.php');
const comm  = read('ops/js/communication.js');
const core  = read('ops/js/ops-core.js');
const cjs   = read('js/contact-chat.js');
const inbox = read('js/modules/inbox/inbox.js');

/* ── 1. 見積 control in Ops ───────────────────────────────────────────────── */
section('1. Quote control in Ops (labels.quote + agreed_price + send-email.php)');
ok(/if \(\$action === 'quote'\)/.test(conv), 'conversations.php has a quote action');
ok(/\$lb\['quote'\]\s*=\s*\$quote/.test(conv), 'quote persists to the EXISTING labels.quote model');
ok(/UPDATE bookings SET agreed_price = \?/.test(conv), 'quote sets bookings.agreed_price (existing column)');
ok(/conv_require_access\(\$db, \$threadId, \$p, \$actor\)/.test(conv), 'quote is authorization-gated');
ok(/Api\.convQuote\(/.test(comm) && /function doQuote/.test(comm), 'Ops thread wires a quote action');
ok(/agreedPrice/.test(core), 'ops-core surfaces agreed_price for the quote form');
ok(/quoteEmailText/.test(comm) && /Api\.sendEmail\(/.test(comm), 'quote email goes through the existing send-email.php');

/* ── 2. Email-thread reply in Ops ─────────────────────────────────────────── */
section('2. Email-thread reply via existing send-email.php');
ok(/if \(c\.isEmail\)/.test(comm), 'email-only threads take the email reply path');
ok(/log_inbox:\s*true/.test(comm), 'reply is threaded back via log_inbox');
ok(/in_reply_to:\s*c\.lastMessageId/.test(comm), 'reply threading uses the replied-to Message-ID');
ok(/sendEmail:\s*function/.test(core) && /send-email\.php/.test(core), 'ops-core reuses send-email.php (no 2nd mechanism)');
ok(/canReply:\s*isContact\s*\?\s*!!cid\s*:\s*\(bookingId\s*\?\s*true\s*:\s*!!/.test(comm), 'email threads are now repliable (not read-only)');

/* ── 3. お問い合わせ attachments (additive; customer can view) ─────────────── */
section('3. Inquiry attachments — additive + secure + customer-visible');
ok(/function cc_clean_attachments/.test(cclib), 'shared attachment validator exists');
ok(/'contact\/'\s*\.\s*\$code\s*\.\s*'\/'/.test(cclib), 'contact attachments scoped to contact/<CODE>/ folder');
ok(/array \$attachments = \[\]/.test(cclib), 'cc_insert_message / cc_do_admin_reply accept attachments additively (default [])');
ok(/function cc_sign_url/.test(cclib), 'contact attachments served via short-lived signed URL');
ok(/cc_clean_attachments\(\$p\['attachments'\]/.test(cc), 'admin-reply validates attachments server-side');
ok(/\$message === '' && !\$atts/.test(cc), 'text-only replies still allowed; attachment-only also allowed');
ok(/'attachments'\s*=>\s*\$atts/.test(cc), 'cc_messages returns attachments to the customer');
ok(/function _attHtml/.test(cjs) && /m\.attachments/.test(cjs), 'customer Contact Chat renders attachments');
// same MIME allow-list as booking chat (no weakening)
ok(/image\/jpeg', 'image\/png', 'image\/webp', 'image\/gif', 'application\/pdf/.test(cc), 'contact reply uses the existing MIME allow-list');
ok(/strpos\(\$path, '\.\.'\)/.test(cclib), 'path traversal guarded');
ok(/count\(\$out\) >= 10/.test(cclib), '10-attachment cap enforced');

/* ── 4. Ops data-path consolidation onto conversations.php ────────────────── */
section('4. Consolidation onto conversations.php (rest.php untouched)');
['assign', 'set-status', 'set-archived', 'set-priority', 'quote']
  .forEach((a) => ok(new RegExp("\\$action === '" + a + "'").test(conv), 'conversations.php action added: ' + a));
ok(/if \(!conv_is_full\(\$p\)\) conv_forbid\('assign_role'\)/.test(conv), 'assignment is admin/manager-only (workers cannot assign)');
ok(/function conv_clean_attachments/.test(conv), 'reply attachments validated + scoped server-side');
ok(/Api\.convList\(\)/.test(comm), 'Center reads migrated to conversations.php');
ok(!/worker/i.test(rest), 'rest.php still has no worker logic (unchanged)');
ok((core.match(/X-ADMIN-TOKEN/g) || []).length >= 1 && /headers\(true\)/.test(core), 'conv/email calls carry the admin token (server-gated)');

/* ── 5. Guarantees: no schema, no Supabase, worker dormant, admin.html intact ── */
section('5. No schema change · no Supabase · worker dormant · admin.html quote intact');
[['conversations.php', conv], ['_contact.php', cclib], ['contact-chat.php', cc], ['storage.php', store]]
  .forEach(([n, s]) => {
    ok(!/\bALTER\s+TABLE\b/i.test(s), n + ' — no ALTER TABLE');
    ok(!/CREATE\s+TABLE(?!\s+IF\s+NOT\s+EXISTS\s+contact_conversations)/i.test(s), n + ' — no new table');
    ok(!/supabase/i.test(s), n + ' — no Supabase');
  });
ok(/worker_role_enabled/.test(store) && /!== 'worker'\)\s*return;/.test(store), 'storage worker guard still flag-gated + no-op for non-workers');
ok(/hm_worker_role_enabled\(\)/.test(conv), 'worker branch in conversations.php still flag-gated (dormant)');
ok(/function inboxSaveQuote/.test(inbox) && /nextLabels\.quote = q/.test(inbox), 'admin.html Inbox quote (labels.quote) preserved');
ok(/function inboxOpenQuote/.test(inbox), 'admin.html quote modal preserved');

console.log('\n──────────────────────────────────────────');
console.log(`ops-phase1: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
