'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * slot-calendar.smoke.js — DOM-free logic smoke for js/modules/calendar/slotCalendar.js
 *   • feature flag hm_admin_slot_ui default ON, opt-out with '0'
 *   • ○△× day roll-up glyph (D2) derives correctly from the 4 band states
 *   • the month grid window is a full 6-week (42-day) block starting on a Sunday
 * Loads the browser IIFE in a vm sandbox with minimal window/document/localStorage
 * stubs. Run: node tests/slot-calendar.smoke.js
 * ──────────────────────────────────────────────────────────────────────────── */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const noopEl = new Proxy({}, { get: () => () => {} });
const documentStub = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ appendChild() {}, style: {}, setAttribute() {}, id: '' }),
  head: { appendChild() {} },
  addEventListener: () => {},
  readyState: 'complete',
  body: noopEl,
};
const windowStub = {};
const sandbox = { window: windowStub, document: documentStub, localStorage, navigator: { language: 'ja' }, console };
sandbox.window.localStorage = localStorage;
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'calendar', 'slotCalendar.js'), 'utf8');
vm.runInContext(src, sandbox, { filename: 'slotCalendar.js' });

const SC = sandbox.window.SlotCalendar;
assert.ok(SC && SC._debug, 'SlotCalendar + debug hooks present');
const { rollup, gridRange } = SC._debug;

let pass = 0;
function chk(label, got, want) {
  assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  console.log(`  [ok] ${label}`);
  pass++;
}

console.log('feature flag hm_admin_slot_ui');
store = {}; chk('default ON', SC.enabled(), true);
store = { hm_admin_slot_ui: '0' }; chk("'0' → off", SC.enabled(), false);
store = { hm_admin_slot_ui: 'false' }; chk("'false' → off", SC.enabled(), false);
store = { hm_admin_slot_ui: '1' }; chk("'1' → on", SC.enabled(), true);
store = {};

const B = (am, pm, ev, nt) => ({ am: { status: am }, pm: { status: pm }, ev: { status: ev }, nt: { status: nt } });
console.log('day roll-up glyph (○ / △ / ×)');
chk('all available → ○', rollup(B('available', 'available', 'available', 'available')).g, '○');
chk('one closed → △',    rollup(B('closed', 'available', 'available', 'available')).g, '△');
chk('one limited → △',   rollup(B('available', 'limited', 'available', 'available')).g, '△');
chk('one full → △',      rollup(B('available', 'available', 'full', 'available')).g, '△');
chk('all closed → ×',    rollup(B('closed', 'closed', 'closed', 'closed')).g, '×');
chk('all full → ×',      rollup(B('full', 'full', 'full', 'full')).g, '×');
chk('closed+full mix → ×', rollup(B('closed', 'full', 'closed', 'full')).g, '×');
chk('missing bands → ○', rollup(null).g, '○');

console.log('month grid window = 6 weeks starting Sunday');
// August 2026: 1st is a Saturday → grid starts Sun 2026-07-26, ends 2026-09-05 (42 days).
const r = gridRange(new Date(2026, 7, 1));
chk('grid start', r.start, '2026-07-26');
chk('grid end',   r.end,   '2026-09-05');
const span = (new Date(r.end) - new Date(r.start)) / 86400000;
chk('span = 41 days (42 cells)', span, 41);
chk('start is a Sunday', new Date(r.start + 'T00:00:00').getDay(), 0);

console.log(`\nPASS: all ${pass} checks`);
