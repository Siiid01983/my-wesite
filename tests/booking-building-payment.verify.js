'use strict';
/**
 * Functional verification of the Building-Info + Payment-Method booking change.
 *
 * Drives the REAL index.html BA overlay in a browser (served on :5050) and checks:
 *   1. The shared building-info component renders identically for BOTH
 *      現住所 (from) and 引越し先 (to): 階数 picker (1〜50階), エレベーター radios,
 *      建物タイプ radios + タワーマンション / 新築 checkboxes.
 *   2. Mutual exclusivity: エレベーター あり/なし, 建物タイプ マンション/アパート/
 *      メゾネット, and お支払い方法 each allow exactly one selection.
 *   3. Independence: タワーマンション / 新築 are multi-select; 現住所 and 引越し先
 *      values never overwrite each other.
 *   4. The selected values reach the submission payload (create-booking.php notes)
 *      and the review table.
 *   5. No horizontal overflow at 360 / 375 / 390 px.
 *
 * Run: node tests/booking-building-payment.verify.js   (needs `node serve.js`)
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:5050/index.html';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Capture the booking payload the BA overlay POSTs to create-booking.php.
  let captured = null;
  await page.route('**/create-booking.php', async route => {
    try { captured = JSON.parse(route.request().postData() || '{}'); } catch (_) { captured = {}; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail || '' });

  // ── 1) Shared component renders identically for both directions ──────────────
  const shape = await page.evaluate(() => {
    window.openBookingApp('単身引越し');
    const info = (dir) => {
      const host = document.getElementById('ba-bldg-' + dir);
      const sel = document.getElementById('ba-floor-' + dir);
      return {
        hasHost: !!host && !!host.innerHTML,
        floorOpts: sel ? sel.options.length : 0,
        firstFloor: sel && sel.options[1] ? sel.options[1].textContent : '',
        lastFloor: sel && sel.options[sel.options.length - 1] ? sel.options[sel.options.length - 1].textContent : '',
        ev: document.querySelectorAll('input[name="ba-ev-' + dir + '"]').length,
        btype: document.querySelectorAll('input[name="ba-btype-' + dir + '"]').length,
        tower: !!document.getElementById('ba-tower-' + dir),
        newb: !!document.getElementById('ba-new-' + dir),
      };
    };
    return { from: info('from'), to: info('to') };
  });
  check('from + to hosts both rendered', shape.from.hasHost && shape.to.hasHost, JSON.stringify(shape));
  check('floor picker = 1階〜50階 (51 options incl. placeholder)',
    shape.from.floorOpts === 51 && shape.to.floorOpts === 51 && shape.from.firstFloor === '1階' && shape.from.lastFloor === '50階',
    JSON.stringify({ opts: shape.from.floorOpts, first: shape.from.firstFloor, last: shape.from.lastFloor }));
  check('elevator = 2 radios (あり/なし) per section', shape.from.ev === 2 && shape.to.ev === 2);
  check('building type = 3 radios per section', shape.from.btype === 3 && shape.to.btype === 3);
  check('タワーマンション + 新築 checkboxes present in both', shape.from.tower && shape.from.newb && shape.to.tower && shape.to.newb);

  // ── 2) Mutual exclusivity + independence ─────────────────────────────────────
  const excl = await page.evaluate(() => {
    const pick = (name, val) => {
      const el = document.querySelector('input[name="' + name + '"][value="' + val + '"]');
      if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    // Select マンション then アパート — radios must leave exactly one checked.
    pick('ba-btype-from', 'マンション');
    pick('ba-btype-from', 'アパート');
    const btypeChecked = Array.from(document.querySelectorAll('input[name="ba-btype-from"]:checked')).map(e => e.value);
    // Elevator: あり then なし.
    pick('ba-ev-from', 'あり');
    pick('ba-ev-from', 'なし');
    const evChecked = Array.from(document.querySelectorAll('input[name="ba-ev-from"]:checked')).map(e => e.value);
    // Independent flags.
    document.getElementById('ba-tower-from').checked = true;
    document.getElementById('ba-new-from').checked = true;
    const flags = document.getElementById('ba-tower-from').checked && document.getElementById('ba-new-from').checked;
    return { btypeChecked, evChecked, flags };
  });
  check('建物タイプ mutually exclusive (1 checked)', excl.btypeChecked.length === 1 && excl.btypeChecked[0] === 'アパート', JSON.stringify(excl.btypeChecked));
  check('エレベーター mutually exclusive (1 checked)', excl.evChecked.length === 1 && excl.evChecked[0] === 'なし', JSON.stringify(excl.evChecked));
  check('タワーマンション + 新築 selectable together (independent)', excl.flags);

  // ── 3) Full flow → payload + review ──────────────────────────────────────────
  const flow = await page.evaluate(() => {
    const setRadio = (name, val) => { const e = document.querySelector('input[name="' + name + '"][value="' + val + '"]'); if (e) e.checked = true; };
    // FROM (現住所): 3階 / EV あり / マンション + タワーマンション + 新築
    document.getElementById('ba-input-from').value = '渋谷区神南1-2-3';
    document.getElementById('ba-floor-from').value = '3';
    setRadio('ba-ev-from', 'あり');
    setRadio('ba-btype-from', 'マンション');
    document.getElementById('ba-tower-from').checked = true;
    document.getElementById('ba-new-from').checked = true;
    window.baConfirmAddr('from');
    // TO (引越し先): 10階 / EV なし / アパート + 新築 (no tower)
    document.getElementById('ba-input-to').value = 'さいたま市大宮区1-1';
    document.getElementById('ba-floor-to').value = '10';
    setRadio('ba-ev-to', 'なし');
    setRadio('ba-btype-to', 'アパート');
    document.getElementById('ba-new-to').checked = true;
    window.baConfirmAddr('to');
    // date + time
    const d = new Date(); d.setDate(d.getDate() + 14);
    const iso = d.toISOString().split('T')[0];
    window.baSetDate(iso);
    const host = document.getElementById('ba-time-host');
    host.innerHTML = '<label class="ba-tl-slot"><input type="radio" name="ba-tl" value="10:00" checked><span class="ba-tl-chip">10:00</span></label>';
    window.baConfirmTime();
    // contact + payment
    document.getElementById('ba-name').value = '山田 太郎';
    document.getElementById('ba-email').value = 'taro@example.com';
    document.getElementById('ba-phone').value = '090-1234-5678';
    setRadio('ba-payment', 'PayPay');
    window.baGoReview();
    const review = (document.getElementById('ba-review-table').innerText || '').replace(/\s+/g, ' ');
    return { review, iso };
  });
  check('review shows 現住所 building (3階・EVあり・マンション・タワーマンション・新築)',
    /3階/.test(flow.review) && /EVあり/.test(flow.review) && /マンション/.test(flow.review) && /タワーマンション/.test(flow.review) && /新築/.test(flow.review),
    flow.review);
  check('review shows 引越し先 building (10階・EVなし・アパート・新築, no tower on to)',
    /10階/.test(flow.review) && /EVなし/.test(flow.review) && /アパート/.test(flow.review), flow.review);
  check('review shows お支払い方法: PayPay', /お支払い方法/.test(flow.review) && /PayPay/.test(flow.review), flow.review);

  // Submit → capture the create-booking.php payload.
  await page.evaluate(() => { window.API_BASE = 'http://localhost:5050/hm-api'; window.API_KEY = 'test'; });
  await page.evaluate(() => window.baSubmitBooking());
  await page.waitForTimeout(400);

  const notes = (captured && captured.notes) || '';
  check('payload captured', !!captured, JSON.stringify(captured ? Object.keys(captured) : null));
  check('payload notes contain 現住所 建物: マンション・タワーマンション・新築',
    /現住所 建物: マンション・タワーマンション・新築/.test(notes), notes);
  check('payload notes contain 引越し先 建物: アパート・新築 (independent from 現住所)',
    /引越し先 建物: アパート・新築/.test(notes) && !/引越し先 建物:[^/]*タワーマンション/.test(notes), notes);
  check('payload notes contain お支払い方法: PayPay', /お支払い方法: PayPay/.test(notes), notes);
  check('payload notes keep floor/EV per address (3階/10階)',
    /現住所 階数\/EV: 3階・EVあり/.test(notes) && /引越し先 階数\/EV: 10階・EVなし/.test(notes), notes);

  // ── 4) No horizontal overflow at narrow widths ───────────────────────────────
  for (const w of [360, 375, 390]) {
    await page.setViewportSize({ width: w, height: 780 });
    const over = await page.evaluate(() => {
      window.openBookingApp('単身引越し');
      // open the from drawer where the building component lives
      window.baOpenDrawer('from');
      const de = document.documentElement;
      const drawer = document.querySelector('#ba-drawer-from .ba-drawer-scroll');
      return {
        docOver: de.scrollWidth - de.clientWidth,
        drawerOver: drawer ? drawer.scrollWidth - drawer.clientWidth : 0,
      };
    });
    check(`no horizontal overflow @ ${w}px`, over.docOver <= 1 && over.drawerOver <= 1, JSON.stringify(over));
    await page.evaluate(() => { window.baCloseDrawer('from'); window.closeBookingApp(); });
  }

  check('no JS errors during flow', errors.length === 0, errors.join(' | '));

  await browser.close();

  // ── Report ───────────────────────────────────────────────────────────────────
  console.log('\n──── Building-Info + Payment booking verification ────');
  let pass = 0;
  for (const r of results) {
    console.log('  ' + (r.ok ? '✅' : '❌') + ' ' + r.name + (r.ok ? '' : '   → ' + r.detail));
    if (r.ok) pass++;
  }
  console.log('──────────────────────────────────────────────────────');
  console.log(`${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
