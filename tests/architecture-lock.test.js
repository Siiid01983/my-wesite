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

// ── 6. TIMELINE is the SINGLE booking/availability engine (locked) ────────────
//   availability_windows (allow-list) + bookings.start_at/end_at + hm_iv_reserve
//   are the ONLY source of truth for availability, booking, and rescheduling.
//   The band engine (_capacity/slot-capacity/booking_slots) is DELETED. Do NOT
//   reintroduce a second scheduling authority.
describe('Timeline engine is the single source of truth (locked)', () => {
  const windows       = read('hm-api/_windows.php');
  const intervals     = read('hm-api/_intervals.php');
  const availability  = read('hm-api/availability.php');
  const bookingStatus = read('hm-api/booking-status.php');
  const reschedule    = read('hm-api/reschedule.php');
  const createBooking = read('hm-api/create-booking.php');

  it('the band engine files are DELETED', () => {
    for (const f of ['hm-api/_capacity.php', 'hm-api/slot-capacity.php', 'hm-api/slot-preflight.php', 'hm-api/booking-slot.php', 'hm-api/block-slot.php']) {
      assert.equal(fs.existsSync(path.join(ROOT, f)), false, `${f} must be deleted (band engine removed)`);
    }
  });

  it('the timeline engine primitives exist (_windows / _intervals)', () => {
    for (const fn of ['hm_timeline_active', 'hm_windows_add', 'hm_tl_gen_slots', 'hm_timeline_start_ok']) {
      assert.ok(new RegExp('function\\s+' + fn + '\\s*\\(').test(windows), `_windows.php must define ${fn}()`);
    }
    assert.ok(/function\s+hm_iv_reserve\s*\(/.test(intervals), '_intervals.php must define the atomic hm_iv_reserve()');
  });

  it('availability.php is TIMELINE-ONLY (no bands / capacity / booking_slots)', () => {
    assert.ok(/hm_windows_day\s*\(/.test(availability) && /hm_timeline_slots\s*\(/.test(availability),
      'availability.php must serve timeline windows + slots');
    assert.ok(!/'bands'/.test(availability) && !/hm_cap_day\s*\(/.test(availability),
      'availability.php must NOT emit bands or read per-band capacity');
    assert.ok(!/booking_slots/.test(availability), 'availability.php must NOT read booking_slots');
    assert.ok(!/\bcalendar_availability\b/.test(availability), 'availability.php must NOT read calendar_availability');
  });

  it('booking-status + reschedule are band-FREE and use only the interval authority', () => {
    for (const [name, src] of [['booking-status.php', bookingStatus], ['reschedule.php', reschedule]]) {
      assert.ok(!/hm_cap_[a-z_]+\s*\(|hm_slot_(reserve|release|band_id|time_from)\s*\(/.test(src),
        `${name} must not call the band engine`);
      assert.ok(!/require_once __DIR__ \. '\/_capacity\.php'/.test(src), `${name} must not require the deleted _capacity.php`);
    }
    assert.ok(/hm_iv_reserve\s*\(/.test(reschedule), 'reschedule.php must move intervals via hm_iv_reserve');
    assert.ok(/beginTransaction\s*\(/.test(reschedule) && /slot_taken/.test(reschedule), 'reschedule.php must be transactional with a slot_taken rollback');
  });

  it('create-booking enforces availability via the timeline window (band engine removed)', () => {
    assert.ok(/hm_timeline_start_ok\s*\(/.test(createBooking), 'create-booking must validate the chosen slot fits an open window');
    assert.ok(/hm_iv_reserve\s*\(/.test(createBooking), 'create-booking must reserve via the interval authority');
    assert.ok(!/hm_cap_[a-z_]+\s*\(/.test(createBooking), 'create-booking must not call the band engine');
  });
});

// ── 7. Band removal: the intermediate slot band UI is deleted (timeline is the calendar)
describe('Band UI removal (slotCalendar/slotCapacity retired)', () => {
  it('slotCalendar.js / slotCapacity.js no longer exist', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'js/modules/calendar/slotCalendar.js')), false, 'slotCalendar.js must be deleted');
    assert.equal(fs.existsSync(path.join(ROOT, 'js/modules/capacity/slotCapacity.js')), false, 'slotCapacity.js must be deleted');
  });
  it('admin.html + sw.js no longer reference the deleted band UIs', () => {
    for (const rel of ['admin.html', 'sw.js']) {
      const src = read(rel);
      assert.ok(!/slotCalendar\.js|slotCapacity\.js/.test(src), `${rel} must not reference the deleted band UIs`);
    }
  });
  it('the timeline is the default admin calendar (navigation)', () => {
    const navJs = read('js/core/navigation.js');
    assert.ok(/TimelineCalendar\.onShow\s*\(/.test(navJs), 'go("calendar") must render the timeline');
    assert.ok(!/SlotCalendar\.onShow/.test(navJs), 'navigation must not reference the deleted SlotCalendar');
  });

  it('Admin + Ops share ONE calendar component (no duplicate implementations)', () => {
    // The bespoke Ops calendar is deleted; Ops loads the SAME timeline modules and
    // mounts them via the shared configure() hook.
    assert.equal(fs.existsSync(path.join(ROOT, 'ops/js/calendar.js')), false, 'the duplicate ops/js/calendar.js must be deleted');
    assert.equal(fs.existsSync(path.join(ROOT, 'ops/js/closedDayCalendar.js')), false, 'the band-only closedDayCalendar.js must be deleted');
    const opsHtml = read('ops/calendar.html');
    assert.ok(/js\/modules\/calendar\/timelineCalendar\.js/.test(opsHtml) && /js\/opsCalendar\.js/.test(opsHtml),
      'ops/calendar.html must load the shared timeline component + the Ops shim');
    assert.ok(/TimelineCalendar\.configure\s*\(/.test(read('ops/js/opsCalendar.js')),
      'opsCalendar.js must mount the shared component via configure()');
    assert.ok(/function configure\s*\(/.test(read('js/modules/calendar/timelineCalendar.js')),
      'timelineCalendar.js must expose configure() so one component serves Admin + Ops');
  });

  it('customer overlay renders NO band time picker (timeline-only + contact fallback)', () => {
    assert.ok(!/name="ba-time"/.test(indexHtml),
      'index.html must not render band time radios (name="ba-time")');
    assert.ok(/_baRenderTimelineSlots/.test(indexHtml), 'the customer time step must use the timeline slot picker');
    assert.ok(/090-2489-3402/.test(indexHtml) && /ba-time-host/.test(indexHtml),
      'a contact fallback must exist for when timeline availability is unavailable');
  });
});

// ── 8. Portal boundary: customer self-service must not bypass the booking engine ─
//    The slot_capacity engine is the single source of truth. Portal endpoints are
//    read / self-service only — they may PATCH a booking row (via BookingService)
//    but must NEVER write the engine tables (slot_capacity / booking_slots) directly,
//    which would let a customer corrupt capacity/closure state or double-book.
describe('Portal boundary (locked)', () => {
  const auth       = read('hm-api/auth.php');
  const portalComm = read('hm-api/portal-communications.php');
  const portalSelf = read('js/portal/portalSelfService.js');

  it('portal endpoints never mutate the booking-engine tables directly', () => {
    for (const [name, src] of [['auth.php', auth], ['portal-communications.php', portalComm]]) {
      assert.ok(!/\b(hm_cap_set|hm_cap_reserve|hm_slot_reserve)\s*\(/.test(src),
        `${name} must NOT call slot-capacity engine mutators (portal is read/self-service only)`);
      assert.ok(!/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?(slot_capacity|booking_slots)`?/i.test(src),
        `${name} must NOT write slot_capacity/booking_slots (engine is the single source of truth)`);
    }
  });

  it('portal self-service reschedule routes through the sanctioned updateBooking path', () => {
    assert.ok(/svc\.updateBooking\s*\(/.test(portalSelf),
      'portalSelfService must reschedule via BookingService.updateBooking (not a direct engine write)');
    assert.ok(!/slot-capacity\.php|slot_capacity|booking_slots/.test(portalSelf),
      'portalSelfService must not touch slot_capacity / booking_slots directly');
  });
});

// ── 9. Hourly timeline (allow-list windows) is DORMANT-BY-DEFAULT + gated ──────
//    Safety contract for the phased rollout: the timeline scheduler must ship OFF
//    (timeline_enabled=false) and every live read/write path must gate on
//    hm_timeline_active (flag + migrated). Overlap/conflict detection must reuse
//    the single interval authority (hm_iv_reserve), never a second one.
describe('Hourly timeline (gated, dormant by default)', () => {
  const cfgExample = read('hm-api/_config.example.php');
  const windows    = read('hm-api/_windows.php');
  const createBk   = read('hm-api/create-booking.php');
  const availPhp   = read('hm-api/availability.php');

  it('timeline_enabled defaults to false in the config example', () => {
    assert.ok(/'timeline_enabled'\s*=>\s*false/.test(cfgExample),
      "_config.example.php must ship 'timeline_enabled' => false (dormant by default)");
  });

  it('_windows.php gates activation on the flag AND the migrated interval column', () => {
    assert.ok(/function\s+hm_timeline_active\s*\(/.test(windows), '_windows.php must define hm_timeline_active()');
    assert.ok(/hm_timeline_enabled\(\)\s*&&\s*hm_bookings_has_interval_cols/.test(windows),
      'hm_timeline_active must require BOTH the flag and the migrated column');
  });

  it('the live endpoints gate the timeline path on hm_timeline_active', () => {
    assert.ok(/hm_timeline_active\s*\(/.test(createBk), 'create-booking.php must gate the timeline path on hm_timeline_active');
    assert.ok(/hm_timeline_active\s*\(/.test(availPhp),  'availability.php must gate the timeline read on hm_timeline_active');
  });

  it('timeline booking reserves through the single interval authority (hm_iv_reserve)', () => {
    assert.ok(/hm_iv_reserve\s*\(/.test(createBk),
      'create-booking timeline path must reserve via hm_iv_reserve (single overlap/conflict authority)');
  });

  it('reschedule uses the interval authority (band-free, flag-independent)', () => {
    const resched = read('hm-api/reschedule.php');
    assert.ok(/hm_iv_reserve\s*\(/.test(resched), 'reschedule.php move must go through hm_iv_reserve (atomic overlap)');
    assert.ok(!/hm_timeline_active\s*\(/.test(resched), 'reschedule.php must NOT depend on the timeline_enabled flag');
  });

  it('band removal P1: mobile/gcal consumers are band-OPTIONAL (no hard dependency)', () => {
    const mob = read('js/modules/mobile/mobileCalendar.js');
    const gcal = read('js/modules/calendar/gcalSync.js');
    assert.ok(/typeof CalendarService === 'undefined'/.test(mob),
      'mobileCalendar._availOf must default to available when CalendarService is gone');
    assert.ok(/window\.CalendarService && CalendarService\.updateAvailability/.test(gcal),
      'gcalSync must guard the legacy band-availability write (band-optional)');
  });

  it('confirm is band-free (legacy bookings converted by the migration, not runtime)', () => {
    // booking-status confirm is status-only; the band confirm/reserve is deleted.
    // Legacy band bookings are converted to intervals by
    // migrate-bookings-to-timeline.php — a DATA migration, not a runtime path.
    const bkStatus = read('hm-api/booking-status.php');
    assert.ok(!/hm_cap_[a-z_]+\s*\(|hm_slot_(reserve|release)\s*\(/.test(bkStatus),
      'booking-status must not call the band engine on confirm/cancel');
    assert.ok(fs.existsSync(path.join(ROOT, 'hm-api/migrate-bookings-to-timeline.php')),
      'the one-time legacy→timeline booking conversion migration must exist');
  });
});

// ── 10. Admin timeline UI is preview-gated + writes only to availability_windows ─
describe('Admin timeline UI (Google-Calendar style)', () => {
  const tlCal = read('js/modules/calendar/timelineCalendar.js');
  const adminHtml = read('admin.html');
  const navJs = read('js/core/navigation.js');

  it('timeline is the default admin calendar, with an escape hatch (hm_timeline_ui=0)', () => {
    assert.ok(/hm_timeline_ui/.test(tlCal), 'timelineCalendar.js must honour the hm_timeline_ui flag');
    assert.ok(/getItem\('hm_timeline_ui'\)\s*!==\s*'0'/.test(tlCal),
      "the timeline must be default-ON (fallback only when hm_timeline_ui==='0')");
  });

  it('timelineCalendar.js manages ONLY availability_windows (not bands/slots)', () => {
    assert.ok(/availability-windows\.php/.test(tlCal), 'timelineCalendar.js must persist via availability-windows.php');
    assert.ok(!/slot_capacity|booking_slots|slot-capacity\.php/.test(tlCal),
      'timelineCalendar.js must not touch slot_capacity / booking_slots');
  });

  it('admin.html loads the timeline modules and navigation renders them gated', () => {
    assert.ok(/timelineGestures\.js/.test(adminHtml) && /timelineCalendar\.js/.test(adminHtml),
      'admin.html must include the timeline gesture + calendar modules');
    assert.ok(/TimelineCalendar\.onShow\s*\(/.test(navJs), 'go("calendar") must render the timeline when its flag is on');
  });
});
