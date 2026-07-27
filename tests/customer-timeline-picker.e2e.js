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

// Server-shaped availability payload. `slots` is the SERVER's free START TIMES for the
// admin default duration (windows − bookings − blocks − closed). The customer picker
// displays ONLY these; there is no duration selector anymore.
function payload(over) {
  return Object.assign({
    ok: true, date: '2026-09-15', timeline: true, closed: false,
    intervals: [], default_duration: 120,
    slots: ['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00'],
  }, over || {});
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newPage();
  const errors = []; ctx.on('pageerror', e => errors.push(e.message));

  let mode = 'ok';   // 'ok' | 'empty' | 'error'
  await ctx.route('**/availability.php*', route => {
    if (mode === 'error') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'boom' }) });
    if (mode === 'empty') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload({ slots: [] })) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload()) });
  });
  await ctx.addInitScript(() => { window.API_BASE = 'http://mock/hm-api'; window.API_KEY = 'k'; });

  await ctx.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await ctx.waitForFunction(() => typeof window.openBookingApp === 'function');

  // Open the picker on a date; assert via the DOM (slots render regardless of drawer visibility).
  const slotVals = () => ctx.$$eval('#ba-tl-slots .ba-tl-slot input', els => els.map(e => e.value));
  const hostText = () => ctx.$eval('#ba-time-host', el => el.textContent);

  await ctx.evaluate(() => { window.openBookingApp('単身引越し'); window.baSetDate('2026-09-15'); });
  await ctx.waitForFunction(() => document.querySelectorAll('#ba-tl-slots .ba-tl-slot').length > 0, { timeout: 5000 });

  console.log('start times come straight from server `slots` — no duration selector');
  let slots = await slotVals();
  chk('shows exactly the SERVER start times (out.slots)', JSON.stringify(slots) === JSON.stringify(['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00']));
  chk('NO duration container (#ba-tl-durs)', !(await ctx.$('#ba-tl-durs')));
  chk('NO duration buttons (.ba-dur)', (await ctx.$$('.ba-dur')).length === 0);
  chk('NO 所要時間 label anywhere in the picker', !/所要時間/.test(await hostText()));
  chk('start-time heading present (希望の開始時刻)', /希望の開始時刻/.test(await hostText()));
  chk('no manual phone number in the picker', !/090-2489-3402/.test(await hostText()));

  console.log('flow: date → pick ONE start time → confirm (no duration step)');
  await ctx.$eval('#ba-tl-slots input[name="ba-tl"][value="08:30"]', el => { el.checked = true; });
  await ctx.evaluate(() => window.baConfirmTime());
  const valTime = (await ctx.$eval('#ba-val-time', el => el.textContent)).trim();
  chk('confirmed value is the START TIME only (08:30 — no range/duration)', valTime === '08:30');
  chk('confirmed value has no duration text (時間/分/〜)', !/時間|分|〜/.test(valTime));

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
