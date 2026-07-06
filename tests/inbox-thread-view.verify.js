'use strict';
/**
 * Functional verification of the admin Inbox CONVERSATION THREAD VIEW.
 *
 * Loads the REAL js/modules/inbox/inbox.js in a browser with a stubbed
 * window.api returning 4 messages in 2 threads:
 *   Thread A (support@): inbound → outbound reply (labels.outbound) → inbound
 *   Thread B (contact@): single message
 * (Both are VISIBLE channels — the Inbox is restricted to support@ + contact@.)
 * and drives the actual UI:
 *   grouping (2 cards, not 4) → card face = newest message → 全N通 badge →
 *   「過去のやり取り」 expand/collapse (chronological, outbound tinted ↩) →
 *   thread-level filters (未読 / 対応済 / channel tabs) → search hits an
 *   OLDER message but surfaces the whole thread.
 *
 * Run: node tests/inbox-thread-view.verify.js
 */
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const INBOX_SRC = process.env.HM_INBOX_SRC || path.join(__dirname, '..', 'js', 'modules', 'inbox', 'inbox.js');
const INBOX_JS  = fs.readFileSync(INBOX_SRC, 'utf8');

const CUSTOMER = 'hanako.sato@example.com';
const MSGS = [
  { // Thread A #1 — oldest inbound (read)
    id: 'a1', sender_name: '佐藤 花子', email: CUSTOMER,
    subject: '引越し日程について', body_text: '3月15日に引越しを希望します。',
    mailbox: 'support@hello-moving.com', message_id: '<a1@x>', thread_id: '<t1@x>',
    received_at: '2026-07-01T10:00:00+09:00', is_read: true, labels: null,
  },
  { // Thread A #2 — our sent reply (outbound)
    id: 'a2', sender_name: 'Hello Moving 予約センター', email: CUSTOMER,
    subject: 'Re: 引越し日程について', body_text: '確認いたしました。3月15日で承ります。',
    mailbox: 'support@hello-moving.com', message_id: '<out-a2@hello-moving.com>', thread_id: '<t1@x>',
    received_at: '2026-07-01T12:00:00+09:00', is_read: true, labels: { outbound: true },
  },
  { // Thread A #3 — newest inbound (UNREAD → thread face)
    id: 'a3', sender_name: '佐藤 花子', email: CUSTOMER,
    subject: 'Re: 引越し日程について', body_text: 'ありがとうございます。よろしくお願いします。',
    mailbox: 'support@hello-moving.com', message_id: '<a3@x>', thread_id: '<t1@x>',
    received_at: '2026-07-02T09:00:00+09:00', is_read: false, labels: null,
  },
  { // Thread B — single-message thread (read)
    id: 'b1', sender_name: '田中 一郎', email: 'ichiro@example.com',
    subject: '不用品回収の相談', body_text: '冷蔵庫の回収をお願いしたいです。',
    mailbox: 'contact@hello-moving.com', message_id: '<b1@x>', thread_id: '<t2@x>',
    received_at: '2026-06-30T15:00:00+09:00', is_read: true, labels: null,
  },
];

function harness() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div id="view-inbox"><div id="messages-container"></div></div>
  <div id="toast"></div>
  <script>
    window.toast = function () {};
    window.API_BASE = 'https://api.test/hm-api';
    window.API_KEY  = 'test-key';
    var FAKE = ${JSON.stringify(MSGS)};
    window.api = {
      from: function () {
        var chain = {
          select: function () { return chain; },
          order:  function () { return chain; },
          limit:  function () { return Promise.resolve({ data: FAKE, error: null }); },
          update: function () { return { eq: function () { return Promise.resolve({ data: null, error: null }); } }; },
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

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setContent(harness(), { waitUntil: 'load' });

  await page.evaluate(() => window.renderInbox());
  await page.waitForSelector('.ibx-card', { timeout: 5000 });

  // ── 1) Grouping ────────────────────────────────────────────────────────────
  check('4 messages render as 2 thread cards',
    await page.evaluate(() => document.querySelectorAll('.ibx-card').length === 2));
  check('header counts threads (スレッド) and messages (件)',
    await page.evaluate(() => {
      const h = document.querySelector('.panel-hd');
      return h && h.textContent.includes('2 スレッド') && h.textContent.includes('4件');
    }));

  // ── 2) Card face = newest message; thread badges ──────────────────────────
  const firstCard = () => page.evaluate(() => document.querySelector('.ibx-card').textContent);
  check('thread A card is first (newest activity) and faces the NEWEST message',
    (await firstCard()).includes('ありがとうございます。よろしくお願いします。'));
  check('thread A card shows the 全3通 count badge',
    await page.evaluate(() => {
      const b = document.querySelector('.ibx-card .ibx-thread-count');
      return b && b.textContent === '全3通';
    }));
  check('single-message thread B has NO count badge / NO history toggle',
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.ibx-card');
      const b = cards[1];
      return !b.querySelector('.ibx-thread-count') && !b.querySelector('.ibx-thread-toggle');
    }));
  check('thread A card is not dimmed (has unread); thread B is dimmed (all read)',
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.ibx-card');
      return cards[0].style.opacity === '' && cards[1].style.opacity === '0.86';
    }));

  // ── 3) Expand / collapse history ───────────────────────────────────────────
  check('history toggle offers the older 2 messages',
    await page.evaluate(() => {
      const t = document.querySelector('.ibx-thread-toggle');
      return t && t.textContent.includes('過去のやり取りを表示') && t.textContent.includes('2件');
    }));
  await page.click('.ibx-thread-toggle');
  await page.waitForSelector('.ibx-thread-msg', { timeout: 5000 });
  check('expanding shows 2 history bubbles',
    await page.evaluate(() => document.querySelectorAll('.ibx-thread-msg').length === 2));
  check('history is chronological (oldest inbound first)',
    await page.evaluate(() =>
      document.querySelectorAll('.ibx-thread-msg')[0].textContent.includes('3月15日に引越しを希望します。')));
  check('outbound bubble is marked ↩ with direction (name → customer)',
    await page.evaluate(() => {
      const b = document.querySelectorAll('.ibx-thread-msg')[1];
      return b.textContent.includes('↩') &&
             b.textContent.includes('Hello Moving 予約センター → hanako.sato@example.com') &&
             b.textContent.includes('確認いたしました。3月15日で承ります。');
    }));
  check('outbound bubble is visually tinted (left border)',
    await page.evaluate(() =>
      document.querySelectorAll('.ibx-thread-msg')[1].style.borderLeft.includes('3px')));
  await page.click('.ibx-thread-toggle');
  await page.waitForFunction(() => document.querySelectorAll('.ibx-thread-msg').length === 0, { timeout: 5000 });
  check('collapse hides the history again',
    await page.evaluate(() => {
      const t = document.querySelector('.ibx-thread-toggle');
      return t && t.textContent.includes('過去のやり取りを表示');
    }));

  // ── 4) Thread-level filters ────────────────────────────────────────────────
  await page.evaluate(() => window.inboxSetFilter('unread'));
  check('未読 filter keeps only the thread containing an unread message',
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.ibx-card');
      return cards.length === 1 && cards[0].textContent.includes('引越し日程について');
    }));
  await page.evaluate(() => window.inboxSetFilter('done'));
  check('対応済 filter keeps only the fully-read thread',
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.ibx-card');
      return cards.length === 1 && cards[0].textContent.includes('不用品回収の相談');
    }));
  await page.evaluate(() => window.inboxSetFilter('all'));

  await page.evaluate(() => window.inboxSetChannel('support@hello-moving.com'));
  check('support@ tab shows only the support thread',
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.ibx-card');
      return cards.length === 1 && cards[0].textContent.includes('引越し日程について');
    }));
  await page.evaluate(() => window.inboxSetChannel('all'));

  // ── 5) Search hits an OLDER message → whole thread surfaces ───────────────
  await page.evaluate(() => window.inboxSearch('希望します'));
  check('search matching only the OLDEST message still shows its thread',
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.ibx-card');
      return cards.length === 1 &&
             cards[0].textContent.includes('ありがとうございます。よろしくお願いします。');
    }));
  await page.evaluate(() => window.inboxSearch(''));

  check('no JS errors during thread-view flow', errors.length === 0, errors.join(' | '));

  await browser.close();

  console.log('──────── Inbox thread-view verification ────────');
  let pass = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.ok || !r.detail ? '' : ' — ' + r.detail}`);
    if (r.ok) pass++;
  }
  console.log('─────────────────────────────────────────────────');
  console.log(`${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(1); });
