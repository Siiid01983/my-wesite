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

// ── 2. #quote may exist ONLY as the hero section id / CSS selector ────────────
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

  it('every #quote occurrence in index.html is the protected section#quote CSS/id', () => {
    const total       = count(indexHtml, /#quote/g);
    const sectionOnly = count(indexHtml, /section#quote/g);
    assert.equal(total - sectionOnly, 0,
      'the only allowed #quote usage is the hero "section#quote" CSS selectors');
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

  it('no Formspree booking pipeline outside the BA overlay', () => {
    // The BA overlay sends exactly ONE Formspree notification alongside its
    // single createBooking() call — that is permitted. Any additional Formspree
    // submission (a parallel booking pipeline) or any in script.js is banned.
    assert.ok(count(indexHtml, /formspree\.io/g) <= 1,
      'only the BA overlay notification may use Formspree (no second pipeline)');
    assert.ok(!/formspree\.io/.test(scriptJs),
      'the hero quoteForm (script.js) must NOT submit to Formspree');
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

// ── 4. quoteForm is a UI-only entry gate via the BA_PREFILL bridge ────────────
describe('quoteForm entry gate', () => {
  it('script.js exposes the BA_PREFILL bridge', () => {
    assert.ok(/window\.BA_PREFILL\s*=/.test(scriptJs),
      'quoteForm must pass data via window.BA_PREFILL');
  });

  it('script.js routes the quoteForm submit into openBookingApp()', () => {
    assert.ok(/openBookingApp\s*\(/.test(scriptJs),
      'quoteForm submit must call openBookingApp()');
  });
});
