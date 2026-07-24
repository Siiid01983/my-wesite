'use strict';
/**
 * ARCHITECTURE LOCK — regression guard (static source analysis, no browser).
 *
 * Enforces the immutable booking-architecture contract:
 *   BA OVERLAY (openBookingApp → BookingService.createBooking) IS THE ONLY
 *   BOOKING SYSTEM. Nothing else may re-emerge.
 *
 * This suite reads the source files directly and FAILS THE BUILD if any legacy
 * booking pattern is reintroduced. Run: npm run test:arch (or test:all).
 *
 * If a check here fails, do NOT relax the check — remove the offending code and
 * route the flow through openBookingApp() instead.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const count = (str, re) => (str.match(re) || []).length;

const indexHtml   = read('index.html');
const scriptJs    = read('script.js');
const custLoginJs = read('js/customer-login.js');

// ── 1. Legacy standalone booking page must not exist ──────────────────────────
describe('Legacy elimination', () => {
  it('booking-app.html does not exist on disk', () => {
    assert.equal(
      fs.existsSync(path.join(ROOT, 'booking-app.html')), false,
      'booking-app.html must stay deleted (orphan legacy booking page)'
    );
  });

  it('no production file references booking-app.html', () => {
    for (const rel of ['index.html', 'script.js', 'sw.js']) {
      const src = fs.existsSync(path.join(ROOT, rel)) ? read(rel) : '';
      assert.ok(!/booking-app\.html/.test(src),
        `${rel} must not reference booking-app.html`);
    }
  });
});

// ── 2. #quote is fully removed (hero section id renamed quote → home-hero) ────
describe('#quote is not a navigation target', () => {
  it('index.html has no href="#quote"', () => {
    assert.ok(!/href\s*=\s*["']#quote["']/.test(indexHtml),
      'all #quote navigation links must route to #booking / openBookingApp()');
  });

  it('index.html has no JS navigation to #quote', () => {
    assert.ok(!/location\.href[^\n;]*#quote/.test(indexHtml),
      'no window.location.href to #quote');
    assert.ok(!/getElementById\(\s*["']quote["']\s*\)/.test(indexHtml),
      'no getElementById("quote") navigation/scroll usage');
    assert.ok(!/scrollIntoView[^\n;]*quote/.test(indexHtml),
      'no scrollIntoView targeting quote');
  });

  it('index.html has zero #quote references (hero id renamed to home-hero)', () => {
    assert.equal(count(indexHtml, /#quote/g), 0,
      '#quote is fully removed; the hero section id is now "home-hero"');
    assert.ok(/id="home-hero"/.test(indexHtml),
      'the hero section must use id="home-hero"');
  });

  it('script.js has no #quote navigation', () => {
    assert.ok(!/#quote/.test(scriptJs), 'script.js must not reference #quote');
  });
});

// ── 3. Single booking writer: BA overlay only ────────────────────────────────
describe('Single booking pipeline', () => {
  it('BookingService.createBooking() is called exactly once in index.html (BA overlay)', () => {
    assert.equal(count(indexHtml, /BookingService\.createBooking\s*\(/g), 1,
      'only the BA overlay submit may call createBooking()');
  });

  it('script.js never calls createBooking()', () => {
    assert.ok(!/createBooking\s*\(/.test(scriptJs),
      'the hero quoteForm (script.js) must NOT create bookings');
  });

  it('customer-login.js never calls createBooking() (auth only)', () => {
    assert.ok(!/createBooking\s*\(/.test(custLoginJs),
      'customer-login.js is auth only — no booking writes');
  });

  it('no Formspree pipeline anywhere (dependency fully removed)', () => {
    // Formspree was fully decoupled: booking notifications are server-side
    // (create-booking.php → LINE push + inbox_messages row). Any formspree.io
    // reference reappearing in production JS/HTML is a regression.
    assert.equal(count(indexHtml, /formspree\.io/g), 0,
      'index.html must not reference formspree.io (notifications are server-side)');
    assert.ok(!/formspree\.io/.test(scriptJs),
      'script.js must NOT submit to Formspree');
  });
});

// ── 3b. Runtime protection layer is present and wired ────────────────────────
describe('Runtime protection layer', () => {
  const guardPath = 'js/security/bookingRuntimeGuard.js';

  it('runtime guard file exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, guardPath)),
      `${guardPath} must exist (runtime booking guard)`);
  });

  it('index.html loads the runtime guard', () => {
    assert.ok(indexHtml.includes(guardPath),
      'index.html must include the runtime booking guard script');
  });

  it('guard wraps BookingService.createBooking and sets lock-mode flags', () => {
    const guard = read(guardPath);
    assert.ok(/BookingService\.createBooking\s*=/.test(guard), 'guard must wrap createBooking');
    assert.ok(/BOOKING_SYSTEM_MODE\s*=\s*['"]BA_OVERLAY_ONLY['"]/.test(guard), 'guard must set BA_OVERLAY_ONLY mode');
    assert.ok(/BOOKING_BLOCKED_NON_BA_SOURCE/.test(guard), 'guard must reject non-BA booking attempts');
  });

  it('guard does NOT override global fetch/XMLHttpRequest (high-blast-radius)', () => {
    const guard = read(guardPath);
    assert.ok(!/window\.fetch\s*=/.test(guard), 'must not reassign window.fetch');
    assert.ok(!/XMLHttpRequest\.prototype\.(open|send)\s*=/.test(guard), 'must not patch XHR prototype');
  });
});

// ── 4. Hero quote form is removed; BA overlay is the sole booking entry ───────
describe('booking entry (hero form removed)', () => {
  it('index.html no longer renders the hero quote form', () => {
    assert.ok(!/id="quoteForm"/.test(indexHtml), 'the hero #quoteForm must be removed');
    assert.ok(!/hero-form-side/.test(indexHtml), 'hero-form-side markup/CSS must be removed');
  });

  it('script.js routes service-card clicks into openBookingApp()', () => {
    assert.ok(/openBookingApp\s*\(/.test(scriptJs),
      'service cards must open the BA overlay via openBookingApp()');
  });
});

// ── 5. API connectivity: same-origin + canonical host + CORS allowlist ────────
describe('API connectivity / origin consistency', () => {
  const APEX = 'https://hello-moving.com';
  const WWW  = 'https://www.hello-moving.com';
  const htaccess   = read('.htaccess');
  const deployJs   = read('deploy.js');
  const envPublic  = read('js/config/env.public.js');
  const cfgExample = read('hm-api/_config.example.php');

  it('.htaccess has a permanent www → apex (non-www) 301 redirect', () => {
    // www and apex must NOT diverge — every visitor lands on the canonical host.
    assert.ok(/RewriteCond\s+%\{HTTP_HOST\}\s+\^www\\\.hello-moving\\\.com/i.test(htaccess),
      '.htaccess must match the www host');
    assert.ok(/RewriteRule.*hello-moving\.com.*\[R=301/i.test(htaccess),
      '.htaccess must 301-redirect www → https://hello-moving.com');
  });

  it('deploy.js generates a SAME-ORIGIN API_BASE (never a cross-origin literal)', () => {
    assert.ok(/window\.API_BASE\s*=\s*window\.location\.origin\s*\+\s*['"]\/hm-api['"]/.test(deployJs),
      'env.js must be generated as window.location.origin + "/hm-api"');
    assert.ok(!/window\.API_BASE\s*=\s*['"]https?:\/\//.test(deployJs),
      'deploy.js must not hardcode an absolute (cross-origin) API_BASE into env.js');
  });

  it('committed env config uses the same-origin API_BASE', () => {
    assert.ok(/window\.API_BASE\s*=\s*window\.location\.origin\s*\+\s*['"]\/hm-api['"]/.test(envPublic),
      'env.public.js must use window.location.origin + "/hm-api"');
  });

  it('CORS allowlist (example config) includes BOTH apex and www', () => {
    const m = cfgExample.match(/'allowed_origin'\s*=>\s*'([^']*)'/);
    assert.ok(m, "allowed_origin must be set in _config.example.php");
    const list = m[1];
    const ok = list === '*' || (list.includes(APEX) && list.includes(WWW));
    assert.ok(ok, `allowed_origin must include both ${APEX} and ${WWW} (got "${list}")`);
  });
});

// ── 6. Slot-capacity is the SINGLE booking/availability engine (locked) ───────
//   slot_capacity + booking_slots are the only source of truth for availability,
//   confirmation, and rescheduling. calendar_availability stays display-only.
//   Do NOT reintroduce a second availability authority.
describe('Slot-capacity engine (locked)', () => {
  const capacity      = read('hm-api/_capacity.php');
  const availability  = read('hm-api/availability.php');
  const slotCapApi    = read('hm-api/slot-capacity.php');
  const bookingStatus = read('hm-api/booking-status.php');
  const reschedule    = read('hm-api/reschedule.php');
  const createBooking = read('hm-api/create-booking.php');

  it('_capacity.php defines the engine primitives', () => {
    for (const fn of ['hm_cap_effective', 'hm_cap_reserve', 'hm_cap_confirm_check', 'hm_cap_day_closed', 'hm_cap_month', 'hm_cap_state']) {
      assert.ok(new RegExp('function\\s+' + fn + '\\s*\\(').test(capacity), `_capacity.php must define ${fn}()`);
    }
    assert.ok(/CREATE TABLE IF NOT EXISTS slot_capacity/.test(capacity), '_capacity.php owns the slot_capacity table');
  });

  it('availability.php derives availability from the capacity engine (not calendar_availability)', () => {
    assert.ok(/require_once __DIR__ \. '\/_capacity\.php'/.test(availability), 'availability.php must include _capacity.php');
    assert.ok(/hm_cap_day\s*\(/.test(availability), 'availability.php must read per-band capacity via hm_cap_day()');
    assert.ok(/booking_slots/.test(availability), 'availability.php reads reserved slots from booking_slots');
    assert.ok(!/\bcalendar_availability\b/.test(availability), 'availability.php must NOT read calendar_availability (display-only table)');
  });

  it('confirm + reschedule funnel through the single-source validation/reserve', () => {
    assert.ok(/hm_cap_confirm_check\s*\(/.test(bookingStatus), 'booking-status.php must validate via hm_cap_confirm_check()');
    assert.ok(/hm_cap_reserve\s*\(/.test(bookingStatus), 'confirm must reserve the slot (hm_cap_reserve)');
    assert.ok(/hm_slot_release\s*\(/.test(reschedule) && /hm_cap_reserve\s*\(/.test(reschedule), 'reschedule.php must release-old + reserve-new (atomic transfer)');
    assert.ok(/beginTransaction\s*\(/.test(reschedule) && /slot_taken/.test(reschedule), 'reschedule.php must be transactional with a slot_taken rollback');
  });

  it('create-booking hard-stops a fully closed day via the engine', () => {
    assert.ok(/hm_cap_day_closed\s*\(/.test(createBooking), 'create-booking.php must guard closed days with hm_cap_day_closed()');
  });

  it('slot-capacity.php exposes the read-only month-status action', () => {
    assert.ok(/'month-status'/.test(slotCapApi), "slot-capacity.php must allow the 'month-status' action");
    assert.ok(/hm_cap_month\s*\(/.test(slotCapApi), 'month-status must serve hm_cap_month()');
  });
});

// ── 7. Admin slot-only availability UI (空き枠管理) is present + wired ─────────
describe('Admin slot calendar UI (locked)', () => {
  const slotCal   = read('js/modules/calendar/slotCalendar.js');
  const adminHtml  = read('admin.html');
  const navJs      = read('js/core/navigation.js');

  it('slotCalendar.js exists, reads ONLY month-status, and is flag-gated', () => {
    assert.ok(/month-status/.test(slotCal), 'slotCalendar.js must read the month-status endpoint');
    assert.ok(/hm_admin_slot_ui/.test(slotCal), 'slotCalendar.js must honour the hm_admin_slot_ui flag');
    assert.ok(/function\s+onShow\b/.test(slotCal), 'slotCalendar.js must expose onShow()');
    // It must not write availability through any legacy day-status path.
    assert.ok(!/calendar_availability/.test(slotCal), 'slotCalendar.js must not touch calendar_availability');
  });

  it('admin.html loads the slot calendar module', () => {
    assert.ok(/js\/modules\/calendar\/slotCalendar\.js/.test(adminHtml), 'admin.html must include slotCalendar.js');
  });

  it('navigation renders the slot UI and aliases 容量設定 → 空き枠管理', () => {
    assert.ok(/SlotCalendar\.onShow\s*\(/.test(navJs), 'go("calendar") must render the slot UI');
    assert.ok(/view === 'capacity'[^\n]*'calendar'/.test(navJs), 'go("capacity") must alias to the merged calendar screen');
  });
});
