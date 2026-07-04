'use strict';
/**
 * Functional verification of the Service-Location booking change.
 *
 * Drives the REAL index.html BA overlay in a browser (served on :5050):
 *  1. UI mode-switch — junk removal / furniture assembly show a single 作業場所
 *     row (引越し先 hidden); moving services keep the 現住所 + 引越し先 pair.
 *  2. Service-layer validation — BookingService.createBooking requires only the
 *     location for single-location services and both addresses for moving, and
 *     packs locmode/from/to correctly for the backend.
 *
 * Run: node tests/booking-service-location.verify.js   (needs `node serve.js`)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// BookingService is a top-level `const` (global lexical binding, not window.*),
// so append a one-line shim to expose it when injected standalone.
const BS_SRC = fs.readFileSync(path.join(__dirname, '..', 'bookingService.js'), 'utf8')
  + '\n;window.__BS = BookingService;';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('http://localhost:5050/index.html', { waitUntil: 'networkidle', timeout: 20000 });

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail || '' });

  // ── 1) UI mode-switch ──────────────────────────────────────────────────────
  // Junk removal (deep-link by display name, as the homepage cards do).
  const single = await page.evaluate(() => {
    window.openBookingApp('不用品回収・処分サービス');
    return {
      toHidden:    getComputedStyle(document.getElementById('ba-row-to')).display === 'none',
      fromLabel:   document.getElementById('ba-label-from').textContent,
      drawerTitle: document.querySelector('#ba-drawer-from .ba-drawer-title').textContent,
    };
  });
  check('junk removal: 引越し先 row hidden',        single.toHidden, JSON.stringify(single));
  check('junk removal: from label = 作業場所：',     single.fromLabel === '作業場所：', single.fromLabel);
  check('junk removal: drawer title = 作業場所を入力', single.drawerTitle === '作業場所を入力', single.drawerTitle);

  // Furniture assembly.
  const single2 = await page.evaluate(() => {
    window.closeBookingApp(); window.openBookingApp('家具組立・分解');
    return { toHidden: getComputedStyle(document.getElementById('ba-row-to')).display === 'none',
             fromLabel: document.getElementById('ba-label-from').textContent };
  });
  check('furniture assembly: 引越し先 row hidden', single2.toHidden);
  check('furniture assembly: from label = 作業場所：', single2.fromLabel === '作業場所：');

  // Moving service — both rows present.
  const dual = await page.evaluate(() => {
    window.closeBookingApp(); window.openBookingApp('単身引越し');
    return { toVisible: getComputedStyle(document.getElementById('ba-row-to')).display !== 'none',
             fromLabel: document.getElementById('ba-label-from').textContent };
  });
  check('moving: 引越し先 row visible',   dual.toVisible);
  check('moving: from label = 現住所：', dual.fromLabel === '現住所：');

  // ── 2) Service-layer validation + payload (stub fetch to capture the POST) ──
  // BookingService is loaded lazily by bootstrap.js (needs env.js), so inject the
  // real bookingService.js standalone with API_BASE set to exercise the POST path.
  const p2 = await browser.newPage();
  p2.on('pageerror', e => errors.push(e.message));
  await p2.setContent('<!doctype html><html><body></body></html>');
  await p2.evaluate(() => { window.API_BASE = 'http://local.test/hm-api'; window.API_KEY = ''; });
  await p2.addScriptTag({ content: BS_SRC });
  const svc = await p2.evaluate(async () => {
    const calls = [];
    const realFetch = window.fetch;
    window.fetch = (url, opts) => {
      if (String(url).includes('create-booking.php')) {
        calls.push(JSON.parse(opts.body));
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, id: 'HM-TEST' }) });
      }
      return realFetch(url, opts);
    };
    const base = { name: '山田太郎', email: 'a@b.com', phone: '09011112222', date: '2030-01-01', time: '午前' };
    const out = { calls, errs: {} };
    const tryCreate = async (key, fields) => {
      try { await window.__BS.createBooking(fields); out.errs[key] = null; }
      catch (e) { out.errs[key] = e.message; }
    };
    // Single-location: missing location → reject; with location → succeed.
    await tryCreate('single_missing', { ...base, serviceId: 'disposal', locMode: 'single', fromAddr: '' });
    await tryCreate('single_ok',      { ...base, serviceId: 'disposal', locMode: 'single', fromAddr: '渋谷区神南1-2-3' });
    // Moving: missing destination → reject; with both → succeed.
    await tryCreate('dual_missing',   { ...base, serviceId: 'tansin', locMode: 'dual', fromAddr: '渋谷区', toAddr: '' });
    await tryCreate('dual_ok',        { ...base, serviceId: 'tansin', locMode: 'dual', fromAddr: '渋谷区', toAddr: '大宮区' });
    window.fetch = realFetch;
    return out;
  });
  check('single-location without 作業場所 is rejected', !!svc.errs.single_missing, svc.errs.single_missing);
  check('single-location with 作業場所 succeeds',       svc.errs.single_ok === null, svc.errs.single_ok);
  check('moving without 引越し先 is rejected',          !!svc.errs.dual_missing, svc.errs.dual_missing);
  check('moving with both addresses succeeds',          svc.errs.dual_ok === null, svc.errs.dual_ok);

  // Inspect the two successful payloads (notes packing for the backend).
  const singleBody = svc.calls.find(c => (c.notes || '').includes('locmode:single'));
  const dualBody   = svc.calls.find(c => (c.notes || '').includes('locmode:dual'));
  check('single payload packs locmode:single + from, no to',
        singleBody && /(^|\n)from:渋谷区/.test(singleBody.notes) && !/(^|\n)to:\S/.test(singleBody.notes),
        singleBody && singleBody.notes);
  check('moving payload packs from + to',
        dualBody && /(^|\n)from:渋谷区/.test(dualBody.notes) && /(^|\n)to:大宮区/.test(dualBody.notes),
        dualBody && dualBody.notes);

  check('no JS errors during flow', errors.length === 0, errors.join(' | '));

  await browser.close();

  let pass = 0;
  console.log('\n──────── Service-Location booking verification ────────');
  for (const r of results) { console.log(`${r.ok ? '  ✅' : '  ❌'} ${r.name}${r.ok ? '' : '  → ' + r.detail}`); if (r.ok) pass++; }
  console.log('───────────────────────────────────────────────────────');
  console.log(`${pass}/${results.length} checks passed\n`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
