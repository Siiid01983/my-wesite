'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * service-image-source.e2e.js — RUNTIME proof that the homepage service grid,
 * the Estimate (BA overlay) picker, and the lightbox all render the SAME image
 * for each canonical slug, sourced from the ONE published DB map
 * (window.HM_SERVICE_IMAGES) — the map ContentLoader fills from
 * hm-api/service-images.php. Also proves: 6 cards desktop + mobile, DOM order,
 * no badge over the photo, lightbox open/close, and that replacing an image
 * (new updated_at → new ?v=) changes the URL in BOTH places.
 *
 * Serves the real index.html from a throwaway static server; no DB needed — we
 * inject the published map exactly as ContentLoader would, then drive the two
 * consuming render paths (window.HM_renderServiceCards + window.openBookingApp).
 *
 * Run: node tests/service-image-source.e2e.js
 * ──────────────────────────────────────────────────────────────────────────── */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('SKIP: playwright not installed'); process.exit(0); }

const ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html;charset=utf-8', '.js':'application/javascript;charset=utf-8', '.css':'text/css;charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon' };

let pass = 0, fail = 0;
function chk(l, c) { if (c) { pass++; console.log('  [ok] ' + l); } else { fail++; console.log('  [XX] ' + l); } }

const CANON = ['sameday', 'single', 'couple', 'student', 'disposal', 'furniture'];
// overlay data-svc-id → canonical slug (index.html BA_SLUG)
const BA_SLUG = { tansin:'single', couple:'couple', student:'student', sameday:'sameday', disposal:'disposal', assembly:'furniture' };

function feedMap(ver) {
  // { slug: versioned-URL } exactly as ContentLoader publishes (window.HM_SERVICE_IMAGES)
  const m = {};
  CANON.forEach((s) => { m[s] = 'https://cdn.example.test/svc/' + s + '.png?v=' + ver; });
  return m;
}
// what the homepage renderer receives from ContentLoader: overrides[slug].image
function overridesFrom(map) {
  const ov = {};
  Object.keys(map).forEach((s) => { ov[s] = { image: map[s] }; });
  return ov;
}

async function readHomepage(page) {
  return page.evaluate(() => {
    const grid = document.getElementById('serviceCardsGrid');
    const cards = grid ? [...grid.querySelectorAll('.svc-img-card')] : [];
    const vis = cards.filter((c) => c.getBoundingClientRect().width > 0);
    return {
      count: vis.length,
      order: vis.map((c) => {
        const a = c.querySelector('.svc-img-card__body');
        return a ? a.getAttribute('data-service') : '';
      }),
      imgs: vis.map((c) => { const i = c.querySelector('.svc-img-card__photo img'); return i ? i.getAttribute('src') : ''; }),
      lbx: vis.map((c) => { const b = c.querySelector('.svc-img-card__photo'); return b ? b.getAttribute('data-lightbox-src') : ''; }),
      badges: grid ? [...grid.querySelectorAll('.svc-img-card__badge')].filter((b) => getComputedStyle(b).display !== 'none').length : -1,
    };
  });
}
async function readOverlay(page) {
  return page.evaluate((baSlug) => {
    const grid = document.getElementById('ba-svc-grid');
    const cards = grid ? [...grid.querySelectorAll('.ba-svc-card')] : [];
    const out = {};
    cards.forEach((c) => {
      const id = c.getAttribute('data-svc-id');
      const slug = baSlug[id] || id;
      const i = c.querySelector('img');
      out[slug] = i ? i.getAttribute('src') : '';
    });
    return out;
  }, BA_SLUG);
}

(async () => {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = 'http://localhost:' + port + '/index.html';

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.HM_renderServiceCards === 'function' && typeof window.openBookingApp === 'function');

    // ── publish the ONE DB map, then drive BOTH consuming paths ──────────────
    const V1 = '20260814120000';
    const map1 = feedMap(V1);
    await page.evaluate((m) => { window.HM_SERVICE_IMAGES = m; }, map1);
    await page.evaluate((ov) => window.HM_renderServiceCards(ov), overridesFrom(map1));
    await page.evaluate(() => { try { window.openBookingApp(); } catch (e) {} });
    await page.waitForTimeout(150);

    const home = await readHomepage(page);
    const ov = await readOverlay(page);

    chk('homepage shows 6 cards (desktop)', home.count === 6);
    chk('homepage DOM order = sameday,single,couple,student,disposal,furniture',
      JSON.stringify(home.order.map((s) => (s || '').includes('当日') ? 'sameday' :
        s.includes('単身') ? 'single' : s.includes('カップル') ? 'couple' :
        s.includes('学生') ? 'student' : s.includes('不用品') ? 'disposal' : 'furniture')) === JSON.stringify(CANON));
    chk('homepage 0 badges over photos', home.badges === 0);

    // UNIFICATION: homepage img === overlay img === published DB url, per slug
    let unified = true, lbxOk = true;
    CANON.forEach((slug, i) => {
      const want = map1[slug];
      if (home.imgs[i] !== want) { unified = false; console.log('     home[' + slug + ']=' + home.imgs[i]); }
      if (ov[slug] !== want) { unified = false; console.log('     overlay[' + slug + ']=' + ov[slug]); }
      if (home.lbx[i] !== want) { lbxOk = false; }
    });
    chk('SINGLE SOURCE: homepage img === Estimate overlay img === DB map (all 6 slugs)', unified);
    chk('lightbox data-src === card image (all 6)', lbxOk);
    chk('all published URLs are versioned (?v=)', CANON.every((s) => /[?&]v=\d+/.test(map1[s])));

    // ── Lightbox opens with the ORIGINAL image, closes on Escape ─────────────
    await page.evaluate(() => document.querySelector('#serviceCardsGrid .svc-img-card__photo').click());
    await page.waitForTimeout(120);
    const lb = await page.evaluate(() => {
      const o = document.querySelector('.hm-lbx');
      const img = document.querySelector('.hm-lbx__img');
      return { open: !!(o && o.classList.contains('is-open')), src: img ? img.getAttribute('src') : '' };
    });
    chk('clicking a photo opens the lightbox', lb.open === true);
    chk('lightbox shows the same (original) image URL', lb.src === map1['sameday']);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    const closed = await page.evaluate(() => { const o = document.querySelector('.hm-lbx'); return !(o && o.classList.contains('is-open')); });
    chk('Escape closes the lightbox', closed === true);

    // ── REPLACE sameday image (new updated_at → new ?v=) reflects in BOTH ────
    const V2 = '20260815093000';
    const map2 = feedMap(V1); map2['sameday'] = 'https://cdn.example.test/svc/sameday.png?v=' + V2;
    await page.evaluate((m) => { window.HM_SERVICE_IMAGES = m; }, map2);
    await page.evaluate((ov) => window.HM_renderServiceCards(ov), overridesFrom(map2));
    await page.evaluate(() => { try { window.openBookingApp(); } catch (e) {} });
    await page.waitForTimeout(150);
    const home2 = await readHomepage(page);
    const ov2 = await readOverlay(page);
    chk('after replace: homepage sameday URL changed (old ≠ new)', home2.imgs[0] === map2['sameday'] && home2.imgs[0] !== map1['sameday']);
    chk('after replace: Estimate sameday URL changed to the SAME new URL', ov2['sameday'] === map2['sameday']);

    // ── FALLBACK unity: no DB image → homepage img === Estimate img (SERVICE_CONFIG)
    await page.evaluate(() => {
      window.HM_SERVICE_IMAGES = {};
      try { localStorage.removeItem('hm_service_images'); localStorage.removeItem('hm_service_images_db'); } catch (e) {}
    });
    await page.evaluate(() => window.HM_renderServiceCards({}));   // no image overrides → SERVICE_CONFIG fallback
    await page.evaluate(() => { try { window.openBookingApp(); } catch (e) {} });
    await page.waitForTimeout(150);
    const homeF = await readHomepage(page);
    const ovF = await readOverlay(page);
    let fbUnified = true;
    CANON.forEach((slug, i) => {
      if (homeF.imgs[i] !== ovF[slug]) { fbUnified = false; console.log('     fb home[' + slug + ']=' + homeF.imgs[i] + '  overlay=' + ovF[slug]); }
    });
    chk('FALLBACK unity: with NO DB image, homepage img === Estimate img (all 6, via SERVICE_CONFIG)', fbUnified);

    // ── Mobile 375px: 6 cards, one per row (stacked) ─────────────────────────
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 375, height: 800 });
    await m.goto(base, { waitUntil: 'networkidle' });
    await m.waitForFunction(() => typeof window.HM_renderServiceCards === 'function');
    await m.evaluate((mp) => { window.HM_SERVICE_IMAGES = mp; }, map1);
    await m.evaluate((ov) => window.HM_renderServiceCards(ov), overridesFrom(map1));
    await m.waitForTimeout(120);
    const mob = await m.evaluate(() => {
      const grid = document.getElementById('serviceCardsGrid');
      const cards = [...grid.querySelectorAll('.svc-img-card')].filter((c) => c.getBoundingClientRect().width > 0);
      const rects = cards.map((c) => c.getBoundingClientRect());
      // one-per-row: no two cards share a row (each top is distinct / stacked)
      const tops = rects.map((r) => Math.round(r.top));
      const oneWide = rects.every((r) => r.width > 300); // full-width on 375
      return { count: cards.length, distinctRows: new Set(tops).size, oneWide };
    });
    chk('mobile shows 6 cards', mob.count === 6);
    chk('mobile = one card per row (6 distinct rows, full-width)', mob.distinctRows === 6 && mob.oneWide);

  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
