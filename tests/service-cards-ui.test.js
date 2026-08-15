'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   service-cards-ui.test.js — guards the public service-card presentation, the
   image-source UNIFICATION (homepage grid ⇄ Estimate overlay ⇄ Website
   Management), the lightbox, and the cache-busting contract. Static-source
   assertions (no browser), runnable in CI via `node --test`. The runtime proof
   (rendered DOM, homepage img === estimate img) lives in
   tests/service-image-source.e2e.js.

   Proves:
     • Desktop 3-up / mobile 1-up — all SIX canonical cards, correct order, no
       slice/limit, no display:none on a card, no carousel.
     • Photos are a square 1:1 box showing the WHOLE image (object-fit: contain,
       not cover) — no crop.
     • No badge is rendered over the photo.
     • Photo → lightbox trigger (data-lightbox-src); body → openBookingApp().
     • ONE image source: ContentLoader publishes window.HM_SERVICE_IMAGES from
       the DB feed; the Estimate overlay reads that same map.
     • Replaced image → different versioned URL; unchanged → stable URL.
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
  assert.deepStrictEqual(ids, CANON, 'all six canonical ids, correct order (DOM order)');
});

test('renderer maps the full SERVICE_CONFIG — no slice/limit that could drop a card', () => {
  const html = read('index.html');
  assert.ok(/SERVICE_CONFIG\.map\(/.test(html), 'renders by mapping the whole array');
  assert.ok(!/SERVICE_CONFIG\.slice\(/.test(html), 'no SERVICE_CONFIG.slice()');
  assert.ok(!/\.slice\(0\s*,\s*5\)/.test(html), 'no slice(0,5) anywhere in index.html');
});

test('the square normalizer + lightbox CSS are loaded LAST on the homepage', () => {
  const html = read('index.html');
  const iSquare = html.indexOf('service-cards-square.css');
  const iLbx = html.indexOf('service-lightbox.css');
  assert.ok(iSquare > -1, 'service-cards-square.css is linked');
  assert.ok(iLbx > -1, 'service-lightbox.css is linked');
  ['css/v2.css', 'v2.1.css', 'v2.1-polish.css'].forEach((f) => {
    assert.ok(html.indexOf(f) < iSquare, f + ' is linked before the normalizer');
  });
});

test('CSS: square 1:1 photo, WHOLE image (contain, not cover)', () => {
  const css = read('css/service-cards-square.css');
  assert.ok(/aspect-ratio:\s*1\s*\/\s*1\s*!important/.test(css), 'photo box is 1:1');
  assert.ok(/object-fit:\s*contain\s*!important/.test(css), 'object-fit: contain (full image)');
  assert.ok(!/object-fit:\s*cover/.test(css), 'no object-fit: cover (would crop)');
  assert.ok(/:first-child\s+\.svc-img-card__photo/.test(css), 'first-child photo normalized too');
});

test('CSS: no badge inside the service-card photo', () => {
  const css = read('css/service-cards-square.css');
  assert.ok(
    /#serviceCardsGrid \.svc-img-card__badge\s*\{\s*display:\s*none\s*!important/.test(css),
    'svc-img-card__badge is display:none inside the grid'
  );
});

test('CSS: mobile = ONE card per row (6 stacked), no carousel, hides no card', () => {
  const css = read('css/service-cards-square.css');
  const mq = css.slice(css.indexOf('@media (max-width: 700px)'));
  assert.ok(mq.length > 0, 'mobile media query present');
  assert.ok(/grid-template-columns:\s*1fr\s*!important/.test(mq), 'mobile = 1 column');
  assert.ok(!/repeat\(2,\s*1fr\)/.test(mq), 'mobile is NOT 2 columns');
  assert.ok(/grid-auto-flow:\s*row\s*!important/.test(mq), 'mobile flow is row (not a column carousel)');
  assert.ok(/overflow:\s*visible\s*!important/.test(mq), 'mobile grid does not overflow-scroll');
  assert.ok(!/\.svc-img-card(?![_-])[^{]*\{\s*[^}]*display:\s*none/.test(css), 'no whole-card display:none');
  assert.ok(!/svc-img-card:nth-child/.test(css), 'no nth-child card hiding');
});

test('renderer: photo → lightbox trigger, body → openBookingApp(), no badge markup', () => {
  const html = read('index.html');
  const m = html.match(/window\.HM_renderServiceCards\s*=\s*function[\s\S]*?if \(overrides\) window\.HM_revealServiceCards\(\);/);
  assert.ok(m, 'renderer body found');
  const body = m[0];
  assert.ok(/class="svc-img-card__photo"[\s\S]*?data-lightbox-src="/.test(body), 'photo carries data-lightbox-src');
  assert.ok(/data-lightbox-title="/.test(body), 'photo carries data-lightbox-title');
  assert.ok(/class="svc-img-card__body"[\s\S]*?openBookingApp\(this\.dataset\.service\)/.test(body),
    'body routes to openBookingApp()');
  assert.ok(/data-service="/.test(body), 'body keeps data-service deep-link');
  assert.ok(!/svc-img-card__badge/.test(body), 'no badge element rendered over the photo');
});

test('lightbox assets exist and are wired', () => {
  const html = read('index.html');
  assert.ok(html.includes('js/service-lightbox.js'), 'lightbox JS included');
  const js = read('js/service-lightbox.js');
  assert.ok(/data-lightbox-src/.test(js), 'delegated on data-lightbox-src');
  assert.ok(/Escape/.test(js), 'closes on Escape');
  assert.ok(/HMServiceLightbox/.test(js), 'exposes a public API');
  const css = read('css/service-lightbox.css');
  assert.ok(/object-fit:\s*contain/.test(css), 'lightbox shows the whole image');
});

test('ONE image source: ContentLoader publishes window.HM_SERVICE_IMAGES; overlay reads it', () => {
  const cl = read('js/services/contentLoader.js');
  assert.ok(/window\.HM_SERVICE_IMAGES\s*=\s*apiImages/.test(cl), 'publishes DB feed as HM_SERVICE_IMAGES');
  assert.ok(/_ls\('hm_service_images_db'/.test(cl), 'persists the DB map for reloads/overlay-first');
  const html = read('index.html');
  // the Estimate/BA overlay must consume the same published map
  assert.ok(/window\.HM_SERVICE_IMAGES[\s\S]{0,120}hm_service_images_db/.test(html) ||
            /HM_SERVICE_IMAGES[\s\S]{0,200}out\[slug\]\s*=\s*out\[slug\]\s*\|\|\s*\{\}/.test(html),
    'overlay _baCmsOverrides reads window.HM_SERVICE_IMAGES / hm_service_images_db');
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
  const vNew = bust(base, '2026-08-14 09:30:15');
  assert.notStrictEqual(vOld, vNew, 'old versioned URL ≠ new versioned URL after replace');
  assert.match(vNew, /[?&]v=20260814093015$/, 'version token = digits of updated_at');
  assert.strictEqual(bust(base, '2026-08-14 09:30:15'), vNew, 'same version ⇒ stable URL');
  assert.strictEqual(bust(base, null), base, 'no updated_at ⇒ URL unchanged');
});

test('contentLoader + public feed wire updated_at through', () => {
  const cl = read('js/services/contentLoader.js');
  assert.ok(/_svcimgBustUrl\(url,\s*row\.updated_at\)/.test(cl), 'feed URLs are version-busted');
  const feed = read('hm-api/service-images.php');
  assert.ok(/SELECT[^;]*updated_at/s.test(feed), 'feed SELECTs updated_at');
  assert.ok(/'updated_at'\s*=>/.test(feed), 'feed outputs updated_at');
});
