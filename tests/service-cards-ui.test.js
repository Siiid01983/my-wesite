'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   service-cards-ui.test.js — guards the public service-card presentation +
   the service-image cache-busting contract. Static-source assertions (no
   browser/jsdom needed), runnable in CI via `node --test`.

   Proves:
     • Desktop AND mobile render all SIX canonical cards (no slice/limit, no
       display:none on a card, mobile is a plain grid — not a carousel that
       drops a tile).
     • Photos are a uniform near-square box (aspect-ratio 1 / .92), incl. the
       former featured card — no wide banner / no landscape pin.
     • No badge is shown inside the service-card photo.
     • A replaced image yields a DIFFERENT versioned URL, while an unchanged
       image keeps a STABLE URL (old ≠ new only when updated_at changes).
   ════════════════════════════════════════════════════════════════════════════ */
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const CANON = ['sameday', 'single', 'couple', 'student', 'disposal', 'furniture'];

test('SERVICE_CONFIG defines exactly the six canonical cards, in order', () => {
  const html = read('index.html');
  const m = html.match(/var SERVICE_CONFIG\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(m, 'SERVICE_CONFIG array found');
  const ids = [...m[1].matchAll(/id\s*:\s*'([^']+)'/g)].map((x) => x[1]);
  assert.deepStrictEqual(ids, CANON, 'all six canonical ids, correct order');
});

test('renderer maps the full SERVICE_CONFIG — no slice/limit that could drop a card', () => {
  const html = read('index.html');
  assert.ok(/SERVICE_CONFIG\.map\(/.test(html), 'renders by mapping the whole array');
  assert.ok(!/SERVICE_CONFIG\.slice\(/.test(html), 'no SERVICE_CONFIG.slice()');
  assert.ok(!/\.slice\(0\s*,\s*5\)/.test(html), 'no slice(0,5) anywhere in index.html');
});

test('the square normalizer CSS is loaded LAST on the homepage', () => {
  const html = read('index.html');
  const iSquare = html.indexOf('service-cards-square.css');
  assert.ok(iSquare > -1, 'service-cards-square.css is linked');
  // must come after every v2 stylesheet so it wins the cascade
  ['css/v2.css', 'v2.1.css', 'v2.1-polish.css'].forEach((f) => {
    assert.ok(html.indexOf(f) < iSquare, f + ' is linked before the normalizer');
  });
});

test('CSS: uniform near-square photos incl. the former featured card', () => {
  const css = read('css/service-cards-square.css');
  assert.ok(/aspect-ratio:\s*1\s*\/\s*\.?0?\.?92/.test(css), 'aspect-ratio 1 / .92 present');
  assert.ok(/:first-child\s+\.svc-img-card__photo/.test(css), 'first-child photo is normalized too');
  // the v2.1 landscape pin must be overridden back to auto height
  assert.ok(/height:\s*auto\s*!important/.test(css), 'photo height reset to auto');
});

test('CSS: no badge inside the service-card photo', () => {
  const css = read('css/service-cards-square.css');
  assert.ok(
    /#serviceCardsGrid \.svc-img-card__badge\s*\{\s*display:\s*none\s*!important/.test(css),
    'svc-img-card__badge is display:none inside the grid'
  );
});

test('CSS: mobile shows all six as a grid — NOT a carousel, and hides no card', () => {
  const css = read('css/service-cards-square.css');
  const mq = css.slice(css.indexOf('@media (max-width: 700px)'));
  assert.ok(mq.length > 0, 'mobile media query present');
  assert.ok(/grid-template-columns:\s*repeat\(2,\s*1fr\)\s*!important/.test(mq), 'mobile = 2 columns');
  assert.ok(/grid-auto-flow:\s*row\s*!important/.test(mq), 'mobile flow is row (not a column carousel)');
  assert.ok(/overflow:\s*visible\s*!important/.test(mq), 'mobile grid does not overflow-scroll');
  // guard: the normalizer must never hide a service card
  assert.ok(
    !/\.svc-img-card(?![_-])[^{]*\{\s*[^}]*display:\s*none/.test(css),
    'no rule sets a whole .svc-img-card to display:none'
  );
  assert.ok(!/svc-img-card:nth-child/.test(css), 'no nth-child card hiding in the normalizer');
});

/* ── Cache-busting contract (mirrors _svcimgBustUrl in contentLoader.js) ──── */
function bust(url, ver) {
  if (!url || !ver) return url || '';
  const t = String(ver).replace(/[^0-9]/g, '');
  return t ? url + (url.indexOf('?') > -1 ? '&' : '?') + 'v=' + t : url;
}

test('replaced image → DIFFERENT versioned URL; unchanged image → STABLE URL', () => {
  const base = '/hm-api/storage.php?action=get&bucket=media&path=service-images/single_abc.webp';
  const vOld = bust(base, '2026-08-12 12:00:00');
  const vNew = bust(base, '2026-08-14 09:30:15');   // after a replace (updated_at bumped)
  assert.notStrictEqual(vOld, vNew, 'old versioned URL ≠ new versioned URL after replace');
  assert.match(vNew, /[?&]v=20260814093015$/, 'version token = digits of updated_at');
  // stable: same updated_at ⇒ identical URL across renders (caching preserved)
  assert.strictEqual(bust(base, '2026-08-14 09:30:15'), vNew, 'same version ⇒ stable URL');
  // no version ⇒ untouched (never a random token)
  assert.strictEqual(bust(base, null), base, 'no updated_at ⇒ URL unchanged');
});

test('contentLoader + public feed actually wire updated_at through', () => {
  const cl   = read('js/services/contentLoader.js');
  assert.ok(/_svcimgBustUrl\(url,\s*row\.updated_at\)/.test(cl), 'feed URLs are version-busted');
  assert.ok(/function _svcimgBustUrl/.test(cl), 'buster helper defined');
  const feed = read('hm-api/service-images.php');
  assert.ok(/SELECT[^;]*updated_at/s.test(feed), 'feed SELECTs updated_at');
  assert.ok(/'updated_at'\s*=>/.test(feed), 'feed outputs updated_at');
});
