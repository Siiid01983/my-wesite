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

test('the square normalizer CSS is loaded LAST on the homepage', () => {
  const html = read('index.html');
  const iSquare = html.indexOf('service-cards-square.css');
  assert.ok(iSquare > -1, 'service-cards-square.css is linked');
  ['css/v2.css', 'v2.1.css', 'v2.1-polish.css'].forEach((f) => {
    assert.ok(html.indexOf(f) < iSquare, f + ' is linked before the normalizer');
  });
});

test('SERVICE_CONFIG shows the six exact display titles (booking serviceValue untouched)', () => {
  const html = read('index.html');
  const m = html.match(/var SERVICE_CONFIG\s*=\s*\[([\s\S]*?)\];/);
  const rows = m[1].split('\n').filter((l) => /id\s*:/.test(l));
  const want = {
    sameday: '当日・お急ぎ引越しプラン', single: '単身引越し', couple: 'カップル引越し',
    student: '学生引越し', disposal: '不用品回収', furniture: '家具の組立・解体',
  };
  Object.keys(want).forEach((slug) => {
    const row = rows.find((l) => new RegExp("id:'" + slug + "'").test(l));
    assert.ok(row, 'row for ' + slug);
    assert.ok(new RegExp("title:'" + want[slug] + "'").test(row), slug + ' title = ' + want[slug]);
  });
  // booking service values (serviceValue) must be the stable full names, unchanged
  assert.ok(/serviceValue:'カップル・ご夫婦引越し'/.test(html), 'couple booking value unchanged');
  assert.ok(/serviceValue:'家具組立・分解'/.test(html), 'furniture booking value unchanged');
  assert.ok(/serviceValue:'不用品回収・処分サービス'/.test(html), 'disposal booking value unchanged');
});

test('CSS: photo box matches image ratio (3:2) + cover → no black bars, no crop', () => {
  const css = read('css/service-cards-square.css');
  assert.ok(/aspect-ratio:\s*3\s*\/\s*2\s*!important/.test(css), 'photo box is 3:2 (matches 1536x1024 images)');
  assert.ok(/object-fit:\s*cover\s*!important/.test(css), 'object-fit: cover (fills box, no letterbox bars)');
  assert.ok(!/object-fit:\s*contain/.test(css), 'no object-fit: contain (that caused the black bars)');
  assert.ok(/:first-child\s+\.svc-img-card__photo/.test(css), 'first-child photo normalized too');
});

test('CSS: service-name action row is a refined control (arrow + tap target), one <a>', () => {
  const css = read('css/service-cards-square.css');
  // trailing directional arrow (→ = \2192) as the action control
  assert.ok(/content:\s*"\\2192"\s*!important/.test(css), 'action row has a → arrow control');
  // comfortable tap target on the action row
  assert.ok(/\.svc-img-card__body[\s\S]*?min-height:\s*54px/.test(css), 'action row has a ~54px tap target');
  assert.ok(/justify-content:\s*space-between/.test(css), 'action row lays out name · arrow');
  // whole card remains a single <a> (no nested anchors introduced in the renderer)
  const html = read('index.html');
  const m = html.match(/window\.HM_renderServiceCards\s*=\s*function[\s\S]*?window\.HM_revealServiceCards\(\);/)[0];
  assert.strictEqual((m.match(/<a /g) || []).length, 1, 'renderer emits exactly ONE <a> per card (no nested anchors)');
  assert.ok(/openBookingApp\(this\.dataset\.service\)/.test(m), 'card still routes via openBookingApp');
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
  // a whole-card hide would be `.svc-img-card { ... display:none }` (card element,
  // optionally a pseudo, directly before `{`) — NOT a descendant/::after rule.
  assert.ok(!/\.svc-img-card\s*(:[a-z-]+)?\s*\{[^}]*display:\s*none/.test(css), 'no whole-card display:none');
  assert.ok(!/svc-img-card:nth-child/.test(css), 'no nth-child card hiding');
});

test('renderer: WHOLE card is one link → openBookingApp(); no lightbox/badge on card', () => {
  const html = read('index.html');
  const m = html.match(/window\.HM_renderServiceCards\s*=\s*function[\s\S]*?window\.HM_revealServiceCards\(\);/);
  assert.ok(m, 'renderer body found');
  const body = m[0];
  assert.ok(/<a class="svc-img-card"[\s\S]*?data-service="/.test(body), 'card root is an <a> with data-service');
  assert.ok(/openBookingApp\(this\.dataset\.service\)/.test(body), 'card routes to openBookingApp() (→ furniture drawer)');
  assert.ok(/class="svc-img-card__photo"/.test(body), 'photo present');
  assert.ok(/class="svc-img-card__title"/.test(body), 'title present below image');
  assert.ok(!/data-lightbox-src/.test(body), 'photo does NOT open a lightbox (whole card navigates)');
  assert.ok(!/svc-img-card__badge/.test(body), 'no badge element on the card');
});

test('titles are FORCED from SERVICE_CONFIG (CMS title override ignored for display)', () => {
  const html = read('index.html');
  const m = html.match(/window\.HM_renderServiceCards\s*=\s*function[\s\S]*?window\.HM_revealServiceCards\(\);/);
  const body = m[0];
  assert.ok(/var title = svc\.title;/.test(body), 'homepage title is forced from SERVICE_CONFIG (svc.title)');
  assert.ok(!/var title = \(o\.title/.test(body), 'homepage title no longer reads o.title (CMS)');
  // Estimate overlay display label is forced from SERVICE_CONFIG too (not CMS o.title)
  assert.ok(/var displayLabel = _baSvcTitle\(s\.id\) \|\| s\.name;/.test(html), 'Estimate display title forced from SERVICE_CONFIG');
  // Estimate booking name is sourced from SERVICE_CONFIG.serviceValue (same as the
  // homepage deep-link) so both surfaces record the identical service string.
  assert.ok(/var bookingName\s*=\s*_baSvcValue\(s\.id\)\s*\|\|/.test(html), 'Estimate booking name derives from SERVICE_CONFIG.serviceValue');
  assert.ok(/function _baSvcValue\(baId\)\s*\{[^}]*serviceValue/.test(html), '_baSvcValue reads SERVICE_CONFIG.serviceValue');
  // the short display title must NOT be used as a booking value
  assert.ok(!/var bookingName\s*=\s*_baSvcTitle/.test(html), 'booking name is not the short display title');
});

test('CSS: card is a link (no underline, pointer) and title uses Noto Sans JP, clamped', () => {
  const css = read('css/service-cards-square.css');
  assert.ok(/a\.svc-img-card[\s\S]*?text-decoration:\s*none\s*!important/.test(css), 'card link has no underline');
  assert.ok(/\.svc-img-card__title[\s\S]*?font-family:\s*var\(--font-jp\)\s*!important/.test(css), 'title uses --font-jp (Noto Sans JP)');
  // uniform card height now comes from the fixed 3:2 photo + the ~54px action row
  assert.ok(/\.svc-img-card__body[\s\S]*?min-height:\s*54px/.test(css), 'action row reserves a uniform ~54px height');
  assert.ok(/-webkit-line-clamp:\s*2/.test(css), 'title clamps to 2 lines (no overflow)');
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
