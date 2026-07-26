'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * customer-timeline-picker.e2e.js — the CUSTOMER booking time picker uses the
 * admin timeline as the SINGLE SOURCE OF TRUTH.
 *
 * Drives the REAL index.html BA overlay (served on :5050) with availability.php
 * mocked to return SERVER-generated free start times (slots_by_duration). Asserts:
 *   • the picker DISPLAYS the server slots (no client-side slot engine)
 *   • changing the duration instantly shows that duration's server list
 *   • blocked / booked gaps are simply absent (server already removed them)
 *   • a transient fetch error shows a RETRY — never a manual phone/LINE fallback
 *   • only a truly-empty day shows "no availability" (and never for other reasons)
 *   • the 4h (240) duration option exists
 * Run: node tests/customer-timeline-picker.e2e.js   (requires `node serve.js`)
 * ──────────────────────────────────────────────────────────────────────────── */
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('SKIP: playwright not installed'); process.exit(0); }

const BASE = 'http://127.0.0.1:5050';
let pass = 0, fail = 0;
function chk(label, cond) { if (cond) { pass++; console.log('  [ok] ' + label); } else { fail++; console.log('  [XX] ' + label); } }

// Server-shaped availability payload. slots_by_duration is what the SERVER computes
// (windows − bookings − blocks − closed) for each allowed duration.
function payload(over) {
  return Object.assign({
    ok: true, date: '2026-09-15', timeline: true, closed: false,
    windows: [{ id: 'w1', start_at: '2026-09-15 08:00:00', end_at: '2026-09-15 18:00:00' }],
    intervals: [], durations: [30, 60, 90, 120, 180, 240], default_duration: 120,
    slots: ['08:00', '08:30', '09:00'],
    slots_by_duration: {
      '30':  ['08:00', '08:30', '09:00', '17:00', '17:30'],
      '60':  ['08:00', '08:30', '09:00', '16:30', '17:00'],
      '120': ['08:00', '08:30', '09:00', '15:30', '16:00'],
      '240': ['08:00', '08:30', '13:00', '14:00'],
    },
  }, over || {});
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newPage();
  const errors = []; ctx.on('pageerror', e => errors.push(e.message));

  let mode = 'ok';   // 'ok' | 'empty' | 'error'
  await ctx.route('**/availability.php*', route => {
    if (mode === 'error') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'boom' }) });
    if (mode === 'empty') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload({ slots: [], slots_by_duration: { '30': [], '60': [], '120': [], '240': [] } })) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload()) });
  });
  await ctx.addInitScript(() => { window.API_BASE = 'http://mock/hm-api'; window.API_KEY = 'k'; });

  await ctx.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await ctx.waitForFunction(() => typeof window.openBookingApp === 'function');

  // ── Open the picker on a date (drawer stays closed; we assert via the DOM, which
  //    holds the rendered slots regardless of visibility) ──────────────────────
  const slotVals = () => ctx.$$eval('#ba-tl-slots .ba-tl-slot input', els => els.map(e => e.value));
  const clickDur = d => ctx.$eval('#ba-tl-durs .ba-dur[data-dur="' + d + '"]', el => el.click());
  const hostText = () => ctx.$eval('#ba-time-host', el => el.textContent);

  await ctx.evaluate(() => { window.openBookingApp('単身引越し'); window.baSetDate('2026-09-15'); });
  await ctx.waitForFunction(() => document.querySelectorAll('#ba-tl-slots .ba-tl-slot').length > 0, { timeout: 5000 });

  console.log('server slots displayed (default duration 120)');
  let slots = await slotVals();
  chk('shows the SERVER 120-min slots', JSON.stringify(slots) === JSON.stringify(['08:00', '08:30', '09:00', '15:30', '16:00']));
  chk('no manual phone number in the picker', !/090-2489-3402/.test(await hostText()));
  chk('4時間 (240) duration option exists', (await ctx.$$eval('#ba-tl-durs .ba-dur', b => b.map(x => x.textContent))).includes('4時間'));

  console.log('duration change → instant recompute from server list');
  await clickDur(240);
  await ctx.waitForTimeout(120);
  slots = await slotVals();
  chk('240-min shows its server slots', JSON.stringify(slots) === JSON.stringify(['08:00', '08:30', '13:00', '14:00']));
  chk('blocked/booked gap absent (no 09:30–12:30 for 4h)', !slots.includes('09:30') && !slots.includes('10:00') && !slots.includes('11:00'));

  await clickDur(30);
  await ctx.waitForTimeout(120);
  slots = await slotVals();
  chk('30-min shows its server slots (incl 17:30)', slots.includes('17:30') && slots.includes('08:00'));

  // ── Truly-empty day ────────────────────────────────────────────────────────
  console.log('truly-empty day → pick-another-day note (not manual contact)');
  mode = 'empty';
  await ctx.evaluate(() => window.baSetDate('2026-09-16'));
  await ctx.waitForFunction(() => /空き時間がありません/.test(document.getElementById('ba-time-host').textContent), { timeout: 5000 });
  let host = await hostText();
  chk('shows a no-availability note', /空き時間がありません/.test(host));
  chk('empty day does NOT show manual phone number', !/090-2489-3402/.test(host));
  chk('empty day has NO retry button', !(await ctx.$('#ba-tl-retry')));

  // ── Transient fetch error ──────────────────────────────────────────────────
  console.log('transient error → retry button (never manual contact / never "no availability")');
  mode = 'error';
  await ctx.evaluate(() => window.baSetDate('2026-09-17'));
  await ctx.waitForFunction(() => !!document.querySelector('#ba-tl-retry'), { timeout: 5000 });
  host = await hostText();
  chk('error shows a retry button', !!(await ctx.$('#ba-tl-retry')));
  chk('error does NOT show "no availability"', !/空き時間がありません/.test(host));
  chk('error does NOT show manual phone number', !/090-2489-3402/.test(host));

  // Retry succeeds → slots come back
  mode = 'ok';
  await ctx.$eval('#ba-tl-retry', el => el.click());
  await ctx.waitForFunction(() => document.querySelectorAll('#ba-tl-slots .ba-tl-slot').length > 0, { timeout: 5000 });
  chk('retry recovers and shows server slots', (await ctx.$$('#ba-tl-slots .ba-tl-slot')).length > 0);

  chk('no page JS errors', errors.length === 0);

  await browser.close();
  console.log('\n' + (fail ? ('FAIL: ' + fail + ' failed, ' + pass + ' passed') : ('PASS: all ' + pass + ' checks')));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
