'use strict';
/**
 * Focused functional verification of the admin Inbox reply flow (direct SMTP).
 *
 * Loads the REAL js/modules/inbox/inbox.js in a browser, stubs window.api and
 * window.fetch, then drives the actual UI:
 *   renderInbox() → channel tabs + recipient badge render
 *   → click 返信 → the send modal opens with To / channel-matched From /
 *     Re: subject / quote-injected body
 *   → click 送信する → assert the POST to send-email.php carries the correct
 *     payload (to, from_account matching the channel, threading headers,
 *     log_comm) and that the success state + toast fire
 *   → error run: server returns smtp_auth → assert the explicit error message
 *     with the _config.php hint is shown and the button re-enables
 *   → click コピー → assert the clipboard fallback still works.
 *
 * No admin login or live DB needed — everything server-side is stubbed.
 * Run: node tests/inbox-reply-flow.verify.js
 */
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

// Defaults to the local module; set HM_INBOX_SRC to verify a different copy
// (e.g. the production-served inbox.js) with the same checks.
const INBOX_SRC = process.env.HM_INBOX_SRC || path.join(__dirname, '..', 'js', 'modules', 'inbox', 'inbox.js');
const INBOX_JS  = fs.readFileSync(INBOX_SRC, 'utf8');

// A fake inbox_messages row: contact@ channel, saved quote, threadable Message-ID.
const FAKE_MSG = {
  id: 'msg-verify-1',
  sender_name: '山田 太郎',
  email: 'taro.yamada@example.com',
  subject: '引越しの見積もりについて',
  body_text: 'お世話になります。見積もりをお願いします。\n---\n2LDK、渋谷区→世田谷区',
  booking_id: 'HM-2026-0042',
  mailbox: 'contact@hello-moving.com',
  message_id: '<inbound-abc123@example.com>',
  is_read: false,
  labels: { quote: { price: 48000, expiry: '2026-07-20', terms: '家具の分解・組立を含む', quotedAt: '2026-07-04T00:00:00Z' } },
};

// sendResult: what the stubbed send-email.php returns for this run.
function harness(sendResult) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
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
    // send-email.php gateway config + stubbed fetch (captures the request).
    window.API_BASE = 'https://api.test/hm-api';
    window.API_KEY  = 'test-key';
    window.__req = null;
    window.fetch = function (url, opts) {
      window.__req = { url: url, headers: (opts && opts.headers) || {}, body: JSON.parse(opts.body) };
      return Promise.resolve({ status: 200, json: function () { return Promise.resolve(${JSON.stringify(sendResult)}); } });
    };
    // Minimal window.api stub mirroring the query-builder chains inbox.js uses:
    //   .select('*').order(...).limit(...) → {data,error}   (fetch)
    //   .update({...}).eq(...)             → {data,error}   (mark-read after send)
    var FAKE = ${JSON.stringify([FAKE_MSG])};
    window.__updates = [];
    window.api = {
      from: function () {
        var chain = {
          select: function () { return chain; },
          order:  function () { return chain; },
          limit:  function () { return Promise.resolve({ data: FAKE, error: null }); },
          update: function (patch) {
            return { eq: function (col, val) {
              window.__updates.push({ patch: patch, id: val });
              return Promise.resolve({ data: null, error: null });
            } };
          },
        };
        return chain;
      },
    };
  </script>
  <script>${INBOX_JS}</script>
</body></html>`;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail: detail || '' }); };

  /* ════ RUN 1 — happy path: render → open reply → send → success ════ */
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setContent(harness({
      ok: true, from: 'contact@hello-moving.com', messageId: '<out-1@hello-moving.com>', transport: 'smtp', error: null,
    }), { waitUntil: 'load' });

    // 1) Render: card, channel tab bar, recipient badge.
    await page.evaluate(() => window.renderInbox());
    await page.waitForSelector('.ibx-card', { timeout: 5000 });
    check('channel tab bar rendered (booking@/support@/contact@)',
      await page.evaluate(() => document.querySelectorAll('.ibx-ch-tab').length === 4));
    const badge = await page.evaluate(() => {
      const b = document.querySelector('.ibx-ch-badge');
      return b ? { text: b.textContent, title: b.getAttribute('title') } : null;
    });
    check('card carries the recipient badge → contact@', badge && badge.text.includes('contact@'));
    check('badge title holds the full recipient email', badge && badge.title.includes('contact@hello-moving.com'));

    // 1b) Channel filter: booking@ tab hides the contact@ message; すべて restores.
    await page.evaluate(() => window.inboxSetChannel('booking@hello-moving.com'));
    check('booking@ tab filters out contact@ messages',
      await page.evaluate(() => document.querySelectorAll('.ibx-card').length === 0));
    await page.evaluate(() => window.inboxSetChannel('all'));
    await page.waitForSelector('.ibx-card', { timeout: 5000 });

    // 2) Click 返信 → the send modal opens with channel-matched From.
    const replyBtn = await page.$('button[onclick*="inboxOpenReply"]');
    check('返信 button rendered and wired to inboxOpenReply', !!replyBtn);
    await replyBtn.click();
    await page.waitForSelector('#inboxReplyModal', { timeout: 5000 });
    check('返信 opens the send modal', await page.evaluate(() =>
      document.getElementById('inboxReplyModal').style.display === 'flex'));
    check('From shows the channel mailbox (contact@)', await page.evaluate(() =>
      document.getElementById('ircFrom').textContent === 'contact@hello-moving.com'));
    check('To shows the customer email', await page.evaluate(() =>
      document.getElementById('ircTo').textContent === 'taro.yamada@example.com'));
    const subj = await page.evaluate(() => document.getElementById('ircSubject').value);
    check('subject prefilled as Re: + booking ref', subj.startsWith('Re: ') && subj.includes('HM-2026-0042'));
    const bodyTpl = await page.evaluate(() => document.getElementById('ircText').value);
    check('body addresses the sender (山田 太郎 様)', bodyTpl.includes('山田 太郎 様'));
    check('body injects last quoted price (48,000)',  bodyTpl.includes('48,000'));
    check('body shows expiry (2026年7月20日)',         bodyTpl.includes('2026年7月20日'));
    check('body signature uses the channel address',  bodyTpl.includes('Email: contact@hello-moving.com'));

    // 3) Click 送信する → POST to send-email.php with the channel-correct payload.
    await page.click('#ircSend');
    await page.waitForFunction(() => window.__req !== null, { timeout: 5000 });
    const req = await page.evaluate(() => window.__req);
    check('POSTs to send-email.php', req.url === 'https://api.test/hm-api/send-email.php');
    check('X-API-KEY header attached', req.headers['X-API-KEY'] === 'test-key');
    check('payload.to = customer email', req.body.to === 'taro.yamada@example.com');
    check("payload.from_account matches the channel ('contact')", req.body.from_account === 'contact');
    check('payload threads onto the inbound Message-ID',
      req.body.in_reply_to === FAKE_MSG.message_id && req.body.references === FAKE_MSG.message_id);
    check('payload.booking_id carried', req.body.booking_id === 'HM-2026-0042');
    check('payload.log_comm = true (recorded in communications)', req.body.log_comm === true);
    check('payload.log_inbox = true (persisted into inbox_messages thread)', req.body.log_inbox === true);
    check('payload.thread_id falls back to the inbound Message-ID',
      req.body.thread_id === FAKE_MSG.message_id);

    // 4) Success feedback + message marked read.
    await page.waitForFunction(() =>
      (document.getElementById('ircStatus') || {}).textContent.includes('送信しました'), { timeout: 5000 });
    check('success status shows the routed From', await page.evaluate(() =>
      document.getElementById('ircStatus').textContent.includes('contact@hello-moving.com')));
    const toasts = await page.evaluate(() => window.__toasts);
    check('「返信を送信しました」 toast fired', toasts.some(t => t.includes('返信を送信しました')));
    const updates = await page.evaluate(() => window.__updates);
    check('message marked read after send', updates.some(u => u.patch && u.patch.is_read === true && u.id === 'msg-verify-1'));

    check('no JS errors during send flow', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  /* ════ RUN 2 — SMTP auth failure: explicit error + _config.php hint ════ */
  {
    const page = await browser.newPage();
    await page.setContent(harness({
      ok: false, error: 'SMTP authentication failed',
      error_detail: { message: 'SMTP authentication failed', code: 'smtp_auth' },
    }), { waitUntil: 'load' });

    await page.evaluate(() => window.renderInbox());
    await page.waitForSelector('.ibx-card', { timeout: 5000 });
    await (await page.$('button[onclick*="inboxOpenReply"]')).click();
    await page.waitForSelector('#inboxReplyModal', { timeout: 5000 });
    await page.click('#ircSend');
    await page.waitForFunction(() =>
      (document.getElementById('ircStatus') || {}).textContent.includes('送信に失敗'), { timeout: 5000 });
    const errText = await page.evaluate(() => document.getElementById('ircStatus').textContent);
    check('failure surfaces the server error verbatim', errText.includes('SMTP authentication failed'));
    check('failure surfaces the error code (smtp_auth)', errText.includes('smtp_auth'));
    check('failure shows the _config.php troubleshooting hint', errText.includes('smtp_pass'));
    check('send button re-enabled after failure', await page.evaluate(() =>
      !document.getElementById('ircSend').disabled));
    check('modal stays open for retry', await page.evaluate(() =>
      document.getElementById('inboxReplyModal').style.display === 'flex'));

    // Clipboard fallback still works from the same modal.
    await page.click('#ircCopy');
    await page.waitForFunction(() => window.__clip !== null, { timeout: 5000 });
    const clip = await page.evaluate(() => window.__clip);
    check('コピー fallback: clipboard leads with the channel From header',
      clip.startsWith('From: contact@hello-moving.com'));
    check('コピー fallback: clipboard carries the edited subject + body',
      clip.includes('件名: Re: ') && clip.includes('山田 太郎 様'));
    await page.close();
  }

  await browser.close();

  // Report
  let pass = 0;
  console.log('\n──────── Inbox reply-flow verification (direct SMTP) ────────');
  for (const r of results) {
    console.log(`${r.ok ? '  ✅' : '  ❌'} ${r.name}${r.ok ? '' : '  → ' + r.detail}`);
    if (r.ok) pass++;
  }
  console.log(`──────────────────────────────────────────────────────────────`);
  console.log(`${pass}/${results.length} checks passed\n`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
