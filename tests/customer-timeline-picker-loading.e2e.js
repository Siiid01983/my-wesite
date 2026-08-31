'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * customer-timeline-picker-loading.e2e.js — the CUSTOMER booking time picker must
 * show a LOADING state while availability is fetched, must DROP the previously
 * chosen date's slots immediately (never show/allow a stale slot), and must ignore
 * OUT-OF-ORDER responses so only the latest date's slots can ever render.
 *
 * Drives the REAL index.html BA overlay (served on :5050) with availability.php
 * mocked via delayed route fulfillment (simulated slow network). Display-only
 * behaviour — no availability API / booking logic is exercised or changed.
 *
 * Run: node tests/customer-timeline-picker-loading.e2e.js   (requires `node serve.js`)
 * ──────────────────────────────────────────────────────────────────────────── */
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('SKIP: playwright not installed'); process.exit(0); }

const BASE = 'http://127.0.0.1:5050';
let pass = 0, fail = 0;
function chk(label, cond) { if (cond) { pass++; console.log('  [ok] ' + label); } else { fail++; console.log('  [XX] ' + label); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Per-date slot lists + per-date network delay (ms) so we can force ordering.
const DATA = {
  '2026-09-20': { slots: ['09:00', '10:00', '11:00'], delay: 600 },   // loading-state date
  '2026-09-21': { slots: ['07:00', '08:00'],          delay: 40  },   // "date A" (fast first load)
  '2026-09-22': { slots: ['15:00', '16:00'],          delay: 700 },   // "date A-slow" in the race
  '2026-09-23': { slots: ['18:00', '19:00'],          delay: 60  },   // "date B-fast" in the race
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newPage();
  const errors = []; ctx.on('pageerror', e => errors.push(e.message));

  await ctx.route('**/availability.php*', async route => {
    const date = new URL(route.request().url()).searchParams.get('date');
    const d = DATA[date] || { slots: [], delay: 20 };
    await sleep(d.delay);
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, date, timeline: true, closed: false, intervals: [], default_duration: 120, slots: d.slots }),
    });
  });
  await ctx.addInitScript(() => { window.API_BASE = 'http://mock/hm-api'; window.API_KEY = 'k'; });

  await ctx.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await ctx.waitForFunction(() => typeof window.openBookingApp === 'function');
  await ctx.evaluate(() => { window.openBookingApp('単身引越し'); });

  const slotVals = () => ctx.$$eval('#ba-tl-slots .ba-tl-slot input', els => els.map(e => e.value));
  const hostText = () => ctx.$eval('#ba-time-host', el => el.textContent);
  const chipCount = () => ctx.$$eval('#ba-tl-slots .ba-tl-slot', els => els.length);

  // ── 1) LOADING STATE ───────────────────────────────────────────────────────
  console.log('1) loading state appears immediately, before slots resolve');
  // Capture the DOM in the SAME synchronous turn as baSetDate. _baFetchAvail clears the
  // slots and paints "空き時間を確認中…" synchronously BEFORE it issues the fetch, so this
  // snapshot deterministically observes the loading frame. (A separate async read is
  // non-deterministic: on a slow machine it can land AFTER the mock-delayed response has
  // resolved and see the final slots instead of the loading frame — a harness race, not a
  // product bug. The production loading frame is present for the whole ~600ms fetch.)
  const snap1 = await ctx.evaluate(() => {
    window.baSetDate('2026-09-20');
    const host = document.getElementById('ba-time-host');
    return { host: host.textContent, chips: host.querySelectorAll('#ba-tl-slots .ba-tl-slot').length };
  });
  chk('shows "空き時間を確認中…" while fetching', /空き時間を確認中/.test(snap1.host));
  chk('renders ZERO selectable slots while loading', snap1.chips === 0);
  chk('loading note is NOT the "no availability" message', !/空き時間がありません/.test(snap1.host));
  await ctx.waitForFunction(() => document.querySelectorAll('#ba-tl-slots .ba-tl-slot').length > 0, { timeout: 5000 });
  chk('resolves to the server slots for that date', JSON.stringify(await slotVals()) === JSON.stringify(['09:00', '10:00', '11:00']));

  // ── 2) STALE CLEAR on date change ──────────────────────────────────────────
  console.log('2) switching dates drops the previous date\'s slots instantly');
  // fully load date A (fast)
  await ctx.evaluate(() => window.baSetDate('2026-09-21'));
  await ctx.waitForFunction(() => document.querySelectorAll('#ba-tl-slots .ba-tl-slot').length > 0, { timeout: 5000 });
  chk('date A loaded its slots (07:00/08:00)', JSON.stringify(await slotVals()) === JSON.stringify(['07:00', '08:00']));
  // now switch to a SLOW date; the instant after, A's slots must be gone. Capture the
  // state in the SAME synchronous turn as baSetDate (deterministic — see stage 1's note).
  const snap2 = await ctx.evaluate(() => {
    window.baSetDate('2026-09-22');   // 700ms delay
    const host = document.getElementById('ba-time-host');
    return { host: host.textContent, slots: [...host.querySelectorAll('#ba-tl-slots .ba-tl-slot input')].map(e => e.value) };
  });
  chk('previous date\'s slots are cleared immediately (no stale chips)', snap2.slots.length === 0);
  chk('shows loading, not A\'s times, during the switch', /空き時間を確認中/.test(snap2.host));
  await ctx.waitForFunction(() => document.querySelectorAll('#ba-tl-slots .ba-tl-slot').length > 0, { timeout: 5000 });
  chk('date B resolves to ITS slots (15:00/16:00), never A\'s', JSON.stringify(await slotVals()) === JSON.stringify(['15:00', '16:00']));

  // ── 3) OUT-OF-ORDER RACE — only the LATEST date may render (#5) ─────────────
  console.log('3) out-of-order responses: latest date wins, stale response ignored');
  // Fire A-slow (700ms) then immediately B-fast (60ms) in one tick.
  await ctx.evaluate(() => { window.baSetDate('2026-09-22'); window.baSetDate('2026-09-23'); });
  // B resolves first → its slots show
  await ctx.waitForFunction(() => {
    const v = [...document.querySelectorAll('#ba-tl-slots .ba-tl-slot input')].map(e => e.value);
    return JSON.stringify(v) === JSON.stringify(['18:00', '19:00']);
  }, { timeout: 5000 });
  chk('fast latest date (B) shows its slots', JSON.stringify(await slotVals()) === JSON.stringify(['18:00', '19:00']));
  // wait past A's slower delay; A's late response must NOT overwrite B
  await sleep(900);
  const afterLate = await slotVals();
  chk('slow earlier date (A) response is IGNORED — B\'s slots remain', JSON.stringify(afterLate) === JSON.stringify(['18:00', '19:00']));
  chk('no A-only slot (15:00/16:00) is present/selectable after the race', !afterLate.includes('15:00') && !afterLate.includes('16:00'));

  chk('no page JS errors', errors.length === 0);

  await browser.close();
  console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
