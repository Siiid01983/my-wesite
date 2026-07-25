'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * timeline-booking-payload.test.js — BookingService maps timeline fields → API.
 * Sandbox-loads bookingService.js, mocks fetch, and asserts createBooking()
 * forwards startAt/durationMin as start_at/duration_min in the create-booking POST
 * body — and that a NON-timeline booking omits them (safe, additive).
 * Run: node tests/timeline-booking-payload.test.js
 * ──────────────────────────────────────────────────────────────────────────── */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let lastBody = null;
const sandbox = {
  console,
  window: { API_BASE: 'http://mock', API_KEY: '', api: null },
  document: { dispatchEvent() {} },
  CustomEvent: function () {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: async (url, opts) => {
    if (String(url).indexOf('create-booking.php') !== -1) lastBody = JSON.parse(opts.body);
    return { json: async () => ({ ok: true, id: 'BK1' }) };
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
let src = fs.readFileSync(path.join(__dirname, '..', 'bookingService.js'), 'utf8');
src += '\n;globalThis.__BS = BookingService;';
vm.runInContext(src, sandbox, { filename: 'bookingService.js' });
const BS = sandbox.__BS;

let pass = 0, fail = 0;
function ck(l, c) { if (c) { pass++; console.log('  [ok] ' + l); } else { fail++; console.log('  [XX] ' + l); } }

assert.ok(BS && typeof BS.createBooking === 'function', 'BookingService.createBooking present');

(async () => {
  console.log('timeline booking → start_at + duration_min');
  lastBody = null;
  await BS.createBooking({
    service: '単身引越し', locMode: 'single', date: '2099-01-05',
    startAt: '2099-01-05T09:30', durationMin: 120,
    fromAddr: '東京都新宿区', name: 'テスト', email: 't@example.com', phone: '09012345678', status: '新規',
  });
  ck('POST body carries start_at', lastBody && lastBody.start_at === '2099-01-05T09:30');
  ck('POST body carries duration_min', lastBody && lastBody.duration_min === 120);
  ck('booking_date preserved', lastBody && lastBody.booking_date === '2099-01-05');

  console.log('legacy (band) booking omits timeline fields');
  lastBody = null;
  await BS.createBooking({
    service: '単身引越し', locMode: 'single', date: '2099-01-06', time: '午前中',
    fromAddr: '東京都新宿区', name: 'テスト', email: 't@example.com', phone: '09012345678', status: '新規',
  });
  ck('no start_at when not a timeline booking', lastBody && lastBody.start_at === undefined);
  ck('no duration_min when not a timeline booking', lastBody && lastBody.duration_min === undefined);

  console.log('\n' + (fail ? ('FAIL: ' + fail + ' failed, ' + pass + ' passed') : ('PASS: all ' + pass + ' checks')));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
