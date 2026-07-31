'use strict';
/**
 * Regression verification for the three production fixes on branch
 * fix/calendar-dayclose-slotcap-unify:
 *   A. Booking → calendar opens on the booking's date (?date= deep-link).
 *   B. Message timestamps: JST-consistent parsing + NUMERIC (never lexical) sort.
 *   C. Legacy ○△× day-close machinery is fully removed (timeline is the calendar);
 *      availability derives from bookings; migration runnable by an admin session.
 *
 * Pure Node (`node --test`) — no browser, no server. Section B loads the REAL
 * js/lib/chatFormat.js in a VM sandbox and exercises the shipped HMFmt.tsMs /
 * msgTime; the rest are source-level invariants (same approach as
 * architecture-lock.test.js) because the logic lives inside browser IIFEs.
 *
 * Run: npm run test:fixes
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── Load the real HMFmt (browser IIFE) in a minimal sandbox ──────────────────
function loadHMFmt() {
  const sandbox = {
    window: {},
    navigator: { language: 'ja' },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      documentElement: { lang: 'ja', appendChild() {} },
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      head: { appendChild() {} },
    },
  };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(read('js/lib/chatFormat.js'), sandbox);
  return sandbox.window.HMFmt;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('B. Timestamp parsing + numeric sort (real HMFmt)', () => {
  const HMFmt = loadHMFmt();

  it('exposes tsMs + toDate', () => {
    assert.equal(typeof HMFmt.tsMs, 'function');
    assert.equal(typeof HMFmt.toDate, 'function');
  });

  it('parses a naive MySQL datetime as JST (not browser-local)', () => {
    // 14:30 JST == 05:30 UTC
    assert.equal(HMFmt.tsMs('2026-07-18 14:30:00'), Date.UTC(2026, 6, 18, 5, 30, 0));
  });

  it('optimistic ISO-Z and persisted naive JST resolve to the SAME instant', () => {
    // The optimistic append uses new Date().toISOString() (…Z); the server later
    // returns the JST-naive form. Both must compare equal so the message does not
    // jump position on poll reconcile.
    const isoZ = '2026-07-18T05:30:00.000Z';
    const naiveJst = '2026-07-18 14:30:00';
    assert.equal(HMFmt.tsMs(isoZ), HMFmt.tsMs(naiveJst));
  });

  it('NUMERIC sort orders by time where a LEXICAL sort would fail', () => {
    // A is earlier in absolute time but carries a 'T' (0x54); B is later but a
    // space (0x20). Lexical String.compare puts B before A (WRONG). Numeric wins.
    const A = { id: 'A', ts: '2026-07-18T00:30:00.000Z' }; // 00:30 UTC (earlier)
    const B = { id: 'B', ts: '2026-07-18 12:00:00' };      // 12:00 JST = 03:00 UTC (later)

    const lexical = [B, A].slice().sort((x, y) => String(x.ts).localeCompare(String(y.ts)));
    assert.deepEqual(lexical.map(m => m.id), ['B', 'A'], 'lexical is expected to be wrong');

    const numeric = [B, A].slice().sort((x, y) => HMFmt.tsMs(x.ts) - HMFmt.tsMs(y.ts));
    assert.deepEqual(numeric.map(m => m.id), ['A', 'B'], 'numeric sort must be chronological');
  });

  it('msgTime renders a stable value for both storage forms', () => {
    assert.equal(HMFmt.msgTime('2026-07-18T05:30:00.000Z', 'ja'),
                 HMFmt.msgTime('2026-07-18 14:30:00', 'ja'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B. Sort call-sites use numeric, never lexical', () => {
  for (const f of ['ops/js/chat.js', 'ops/js/messages.js']) {
    it(`${f}: no localeCompare on timestamps, uses tsMs()`, () => {
      const src = read(f);
      assert.ok(!/String\(\s*[ab]\.(ts|lastTs)\s*\)\.localeCompare/.test(src),
        `${f} still lexically sorts timestamps`);
      assert.match(src, /tsMs\(\s*a\.ts\s*\)\s*-\s*tsMs\(\s*b\.ts\s*\)/, `${f} must sort messages by tsMs`);
      assert.match(src, /tsMs\(\s*b\.lastTs\s*\)\s*-\s*tsMs\(\s*a\.lastTs\s*\)/, `${f} must sort convs by tsMs`);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B. Backend timezone is pinned end-to-end', () => {
  it('PHP default timezone = Asia/Tokyo (hm-api/_lib.php)', () => {
    assert.match(read('hm-api/_lib.php'), /date_default_timezone_set\(\s*'Asia\/Tokyo'\s*\)/);
  });
  it('MySQL session timezone pinned to +09:00 (hm-api/_db.php)', () => {
    assert.match(read('hm-api/_db.php'), /SET time_zone\s*=\s*'\+09:00'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A. Calendar reads ?date= and opens on that day', () => {
  // Ops now uses the SHARED timeline via opsCalendar.js (bespoke calendar.js deleted).
  const src = read('ops/js/opsCalendar.js');
  it('bookings.js links to calendar.html?date=<booking date>', () => {
    assert.match(read('ops/js/bookings.js'), /calendar\.html\?date='/);
  });
  it('opsCalendar.js parses the date param and opens that day on the shared timeline', () => {
    assert.match(src, /URLSearchParams\(location\.search[^)]*\)\.get\('date'\)/);
    assert.match(src, /setAnchor\(dl\)/);
    assert.match(src, /setView\('day'\)/);
  });

  // Reproduce the exact deep-link decision (regex + round-trip validation) to
  // prove a valid date is honoured and an impossible one is rejected.
  const parse = (s) => { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const accepts = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(parse(d).getTime()) && fmt(parse(d)) === d;
  it('accepts a real date, rejects an impossible one', () => {
    assert.equal(accepts('2026-07-20'), true);
    assert.equal(accepts('2026-02-31'), false);   // rolls over → rejected
    assert.equal(accepts('garbage'), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C. Legacy ○△× day-close machinery is REMOVED (timeline is the calendar)', () => {
  const calendarJs = 'js/modules/calendar/calendar.js';
  // calendar.js (the ○△× grid, later the GCal settings panel) is fully deleted.
  const monthCal = fs.existsSync(path.join(root, calendarJs)) ? read(calendarJs) : '';
  const adminBk = read('admin-bookings.js');
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

  it('calendar.js (○△× grid + GCal panel) is deleted; timeline is the only calendar', () => {
    assert.ok(!fs.existsSync(path.join(root, calendarJs)), 'calendar.js must be deleted');
    for (const fn of ['function renderCalendar', 'function calClick', 'function _syncCalendarFromApi',
                      'function toggleBulk', 'function applyBulk', 'function _loadSlotCapClosed']) {
      assert.ok(!monthCal.includes(fn), `${fn} must be removed from calendar.js`);
    }
    assert.ok(!/hm_slotcap_pending|slot-capacity\.php/.test(monthCal),
      'calendar.js must not touch the deleted slot-capacity engine');
  });

  it('admin CalendarService no longer POSTs day-closures to the deleted slot-capacity.php', () => {
    assert.ok(!/syncDayClosure/.test(adminBk), 'syncDayClosure (band day-close) must be removed');
    assert.ok(!/slot-capacity\.php|hm_slotcap_pending/.test(adminBk),
      'admin-bookings must not reference the deleted band engine');
  });

  it('CalendarService.getAvailability derives from bookings, not calendar_availability', () => {
    assert.match(adminBk, /Adapter\.getAvail\(\)/);
    assert.ok(!/calendar_availability/.test(stripComments(adminBk)),
      'no calendar_availability call-site outside comments');
  });

  it('the legacy→timeline booking migration accepts an admin session token', () => {
    const mig = read('hm-api/migrate-bookings-to-timeline.php');
    assert.match(mig, /HTTP_X_ADMIN_TOKEN/);
    assert.match(mig, /hm_admin_token_verify/);
  });
});
