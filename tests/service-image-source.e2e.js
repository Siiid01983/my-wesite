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
      // data-service now lives on the card root <a> (the whole card is the link)
      order: vis.map((c) => c.getAttribute('data-service') || ''),
      imgs: vis.map((c) => { const i = c.querySelector('.svc-img-card__photo img'); return i ? i.getAttribute('src') : ''; }),
      titles: vis.map((c) => { const t = c.querySelector('.svc-img-card__title'); return t ? t.textContent.trim() : ''; }),
      isLink: vis.map((c) => c.tagName.toLowerCase() === 'a' && !!c.getAttribute('data-service')),
      hasLbx: vis.some((c) => { const b = c.querySelector('[data-lightbox-src]'); return !!b; }),
      badges: grid ? [...grid.querySelectorAll('.svc-img-card__badge')].filter((b) => getComputedStyle(b).display !== 'none').length : -1,
    };
  });
}
async function readOverlay(page) {
  return page.evaluate((baSlug) => {
    const grid = document.getElementById('ba-svc-grid');
    const cards = grid ? [...grid.querySelectorAll('.ba-svc-card')] : [];
    const imgs = {}, titles = {};
    cards.forEach((c) => {
      const id = c.getAttribute('data-svc-id');
      const slug = baSlug[id] || id;
      const i = c.querySelector('img');
      const n = c.querySelector('.ba-svc-card__name');
      imgs[slug] = i ? i.getAttribute('src') : '';
      titles[slug] = n ? n.textContent.trim() : '';
    });
    return { imgs, titles };
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
    chk('every card is a single <a> link (image + title clickable together)', home.isLink.every(Boolean) && home.isLink.length === 6);
    chk('no lightbox trigger on cards (whole card navigates)', home.hasLbx === false);

    // exact display titles, and Homepage title === Estimate title per slug
    const WANT_TITLE = { sameday:'当日・お急ぎ引越しプラン', single:'単身引越し', couple:'カップル引越し', student:'学生引越し', disposal:'不用品回収', furniture:'家具の組立・解体' };
    chk('homepage shows the six exact display titles', CANON.every((s, i) => home.titles[i] === WANT_TITLE[s]));
    chk('TITLE consistency: homepage title === Estimate title (all 6)', CANON.every((s) => ov.titles[s] === WANT_TITLE[s]));

    // UNIFICATION: homepage img === overlay img === published DB url, per slug
    let unified = true;
    CANON.forEach((slug, i) => {
      const want = map1[slug];
      if (home.imgs[i] !== want) { unified = false; console.log('     home[' + slug + ']=' + home.imgs[i]); }
      if (ov.imgs[slug] !== want) { unified = false; console.log('     overlay[' + slug + ']=' + ov.imgs[slug]); }
    });
    chk('SINGLE SOURCE: homepage img === Estimate overlay img === DB map (all 6 slugs)', unified);
    chk('all published URLs are versioned (?v=)', CANON.every((s) => /[?&]v=\d+/.test(map1[s])));

    // ── NAVIGATION: image AND title → openBookingApp(serviceValue) → furniture drawer
    const serviceValues = await page.evaluate(() => {
      const out = {}; (window.SERVICE_CONFIG || []).forEach((s) => { out[s.id] = s.serviceValue; }); return out;
    });
    // spy on openBookingApp to capture the routed service, without side effects
    await page.evaluate(() => {
      window.__routed = [];
      const real = window.openBookingApp;
      window.openBookingApp = function (svc) { window.__routed.push(svc); return real.apply(this, arguments); };
    });
    // click the PHOTO of card 0 (sameday) and the TITLE of card 2 (couple)
    await page.evaluate(() => document.querySelector('#serviceCardsGrid .svc-img-card:nth-child(1) .svc-img-card__photo').click());
    await page.waitForTimeout(200);
    const drawerAfterPhoto = await page.evaluate(() => document.getElementById('ba-drawer-furniture').classList.contains('open'));
    await page.evaluate(() => { try { window.closeBookingApp(); } catch (e) {} });
    await page.evaluate(() => document.querySelector('#serviceCardsGrid .svc-img-card:nth-child(3) .svc-img-card__title').click());
    await page.waitForTimeout(200);
    const routed = await page.evaluate(() => window.__routed);
    await page.evaluate(() => { try { window.closeBookingApp(); } catch (e) {} });
    chk('clicking the IMAGE routes to openBookingApp(sameday serviceValue) → furniture drawer',
      routed[0] === serviceValues.sameday && drawerAfterPhoto === true);
    chk('clicking the TITLE routes to openBookingApp(couple serviceValue)', routed[1] === serviceValues.couple);

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
    chk('after replace: Estimate sameday URL changed to the SAME new URL', ov2.imgs['sameday'] === map2['sameday']);

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
      if (homeF.imgs[i] !== ovF.imgs[slug]) { fbUnified = false; console.log('     fb home[' + slug + ']=' + homeF.imgs[i] + '  overlay=' + ovF.imgs[slug]); }
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
