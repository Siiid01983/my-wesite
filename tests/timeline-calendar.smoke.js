'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * timeline-calendar.smoke.js — DOM-free logic smoke for timelineCalendar.js
 *   • preview flag hm_timeline_ui default OFF (production untouched)
 *   • time↔pixel mapping (minToY / yToMin) round-trips against the day bounds
 *   • snapMin honours the configurable interval (15/30/60)
 *   • weekDates = 7 days from Sunday; monthGrid = 42-cell block from Sunday
 *   • visible range (rangeOf) matches the active view
 * Run: node tests/timeline-calendar.smoke.js
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
const documentStub = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ appendChild() {}, style: {}, setAttribute() {}, id: '' }),
  head: { appendChild() {} }, addEventListener: () => {}, readyState: 'complete',
};
const sandbox = { window: {}, document: documentStub, localStorage, console };
sandbox.window.localStorage = localStorage;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'calendar', 'timelineCalendar.js'), 'utf8'), sandbox, { filename: 'timelineCalendar.js' });

const TL = sandbox.window.TimelineCalendar;
let pass = 0, fail = 0;
function ck(label, cond) { if (cond) { pass++; console.log('  [ok] ' + label); } else { fail++; console.log('  [XX] ' + label); } }

assert.ok(TL && TL._debug, 'TimelineCalendar + debug hooks present');
const D = TL._debug;

console.log('feature flag (preview) default OFF');
ck('hm_timeline_ui unset → disabled', TL.enabled() === false);
store.hm_timeline_ui = '1';
ck('hm_timeline_ui=1 → enabled', TL.enabled() === true);
delete store.hm_timeline_ui;

console.log('time helpers');
ck('hmToMin 09:30 = 570', D.hmToMin('09:30') === 570);
ck('minToHm 570 = 09:30', D.minToHm(570) === '09:30');
ck('dtMin datetime', D.dtMin('2026-08-15 13:45:00') === 13 * 60 + 45);

console.log('pixel mapping (day_start 07:00, 0.8px/min)');
D.setCfg({ day_start: '07:00', day_end: '22:00' });
ck('minToY(07:00)=0', D.minToY(420) === 0);          // 07:00 = 420 min
ck('minToY(08:00)=48', Math.round(D.minToY(480)) === 48);  // 1h * 0.8 * 60 = 48px
ck('yToMin round-trip', Math.round(D.yToMin(D.minToY(600))) === 600);

console.log('snap (configurable)');
D.setSnap(30); ck('snap30(575)=570', D.snapMin(575) === 570);
D.setSnap(15); ck('snap15(575)=570', D.snapMin(575) === 570);
D.setSnap(15); ck('snap15(578)=585', D.snapMin(578) === 585);
D.setSnap(60); ck('snap60(575)=600', D.snapMin(575) === 600);

console.log('week / month grids');
const wk = D.weekDates('2026-08-12');   // Wed
ck('weekDates length 7', wk.length === 7);
ck('weekDates starts Sunday 08-09', wk[0] === '2026-08-09');
ck('weekDates ends Saturday 08-15', wk[6] === '2026-08-15');
const mg = D.monthGrid('2026-08-12');
ck('monthGrid length 42', mg.length === 42);
ck('monthGrid starts on a Sunday', new Date(mg[0] + 'T00:00:00').getDay() === 0);
ck('monthGrid covers Aug 1', mg.indexOf('2026-08-01') !== -1);

console.log('visible range per view');
D.setAnchor('2026-08-12');
D.setView('day');   let r = D.rangeOf(); ck('day range = single day', r.from === '2026-08-12' && r.to === '2026-08-12');
D.setView('week');  r = D.rangeOf();     ck('week range = Sun..Sat', r.from === '2026-08-09' && r.to === '2026-08-15');
D.setView('month'); r = D.rangeOf();     ck('month range = 42-day block', r.from === mg[0] && r.to === mg[41]);

console.log('\n' + (fail ? ('FAIL: ' + fail + ' failed, ' + pass + ' passed') : ('PASS: all ' + pass + ' checks')));
process.exit(fail ? 1 : 0);
