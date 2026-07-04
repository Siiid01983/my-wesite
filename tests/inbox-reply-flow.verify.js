'use strict';
/**
 * Focused functional verification of the admin Inbox reply flow.
 *
 * Loads the REAL js/modules/inbox/inbox.js in a browser, stubs window.api to
 * return one fake message carrying a labels.quote price, then drives the actual
 * UI: renderInbox() → click 返信 → assert the copy-template modal renders with
 * the From/ref/price → click コピー → assert the clipboard text + toast.
 *
 * No admin login or live DB needed — the reply flow is pure client-side.
 * Run: node tests/inbox-reply-flow.verify.js
 */
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

// Defaults to the local module; set HM_INBOX_SRC to verify a different copy
// (e.g. the production-served inbox.js) with the same checks.
const INBOX_SRC = process.env.HM_INBOX_SRC || path.join(__dirname, '..', 'js', 'modules', 'inbox', 'inbox.js');
const INBOX_JS  = fs.readFileSync(INBOX_SRC, 'utf8');

// A fake inbox_messages row with a saved quote (labels.quote).
const FAKE_MSG = {
  id: 'msg-verify-1',
  sender_name: '山田 太郎',
  email: 'taro.yamada@example.com',
  subject: '引越しの見積もりについて',
  body_text: 'お世話になります。見積もりをお願いします。\n---\n2LDK、渋谷区→世田谷区',
  booking_id: 'HM-2026-0042',
  mailbox: 'contact@hello-moving.com',
  is_read: false,
  labels: { quote: { price: 48000, expiry: '2026-07-20', terms: '家具の分解・組立を含む', quotedAt: '2026-07-04T00:00:00Z' } },
};

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div id="view-inbox"><div id="messages-container"></div></div>
  <div id="toast"></div>
  <script>
    // Capture toast + clipboard writes for assertions.
    window.__toasts = [];
    window.toast = function (m) { window.__toasts.push(m); };
    window.__clip = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: function (t) { window.__clip = t; return Promise.resolve(); } },
      configurable: true,
    });
    // Minimal window.api stub mirroring the query-builder chain inbox.js uses:
    //   api.from('inbox_messages').select('*').order(...).limit(...)  → { data, error }
    var FAKE = ${JSON.stringify([FAKE_MSG])};
    window.api = {
      from: function () {
        var chain = {
          select: function () { return chain; },
          order:  function () { return chain; },
          limit:  function () { return Promise.resolve({ data: FAKE, error: null }); },
        };
        return chain;
      },
    };
  </script>
  <script>${INBOX_JS}</script>
</body></html>`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.setContent(HARNESS, { waitUntil: 'load' });

  const results = [];
  const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail: detail || '' }); };

  // 1) Render the inbox and confirm the card + 返信 button exist.
  await page.evaluate(() => window.renderInbox());
  await page.waitForSelector('.ibx-card', { timeout: 5000 });
  const replyBtn = await page.$('button[onclick*="inboxOpenReplyCopy"]');
  check('返信 button rendered and wired to inboxOpenReplyCopy', !!replyBtn);

  // 2) Click 返信 → the copy-template modal opens.
  await replyBtn.click();
  await page.waitForSelector('#inboxReplyCopyModal', { timeout: 5000 });
  const modalShown = await page.evaluate(() =>
    document.getElementById('inboxReplyCopyModal').style.display === 'flex');
  check('返信 opens the copy-template modal', modalShown);

  // 3) The template textarea contains From/ref/price/expiry.
  const tpl = await page.evaluate(() => document.getElementById('ircText').value);
  check('template has From: contact@hello-moving.com header', tpl.includes('From: contact@hello-moving.com'));
  check('template has booking ref HM-2026-0042',              tpl.includes('HM-2026-0042'));
  check('template injects last quoted price (48,000)',        tpl.includes('48,000'));
  check('template shows expiry (2026年7月20日)',              tpl.includes('2026年7月20日'));
  check('template addresses the sender (山田 太郎 様)',        tpl.includes('山田 太郎 様'));

  // 4) Click コピー → clipboard gets the text + "コピーしました！" toast.
  await page.click('#ircCopy');
  await page.waitForFunction(() => window.__clip !== null, { timeout: 5000 });
  const clip = await page.evaluate(() => window.__clip);
  const toasts = await page.evaluate(() => window.__toasts);
  check('clipboard received the template text', clip && clip.includes('From: contact@hello-moving.com'));
  check('clipboard text matches the modal textarea', clip === tpl);
  check('"コピーしました！" toast fired', toasts.some(t => t.includes('コピーしました')));

  // 5) No JS errors during the whole flow.
  check('no JS errors during reply flow', errors.length === 0, errors.join(' | '));

  await browser.close();

  // Report
  let pass = 0;
  console.log('\n──────── Inbox reply-flow verification ────────');
  for (const r of results) {
    console.log(`${r.ok ? '  ✅' : '  ❌'} ${r.name}${r.ok ? '' : '  → ' + r.detail}`);
    if (r.ok) pass++;
  }
  console.log(`───────────────────────────────────────────────`);
  console.log(`${pass}/${results.length} checks passed\n`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
