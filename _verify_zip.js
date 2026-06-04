const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  function shot(name) {
    return page.screenshot({ path: path.join(__dirname, `_verify_${name}.png`) });
  }

  // Helper: wait for address block to become visible
  async function waitForAddr(blockId, valId, statusId, label) {
    try {
      await page.waitForFunction(
        id => { const el = document.getElementById(id); return el && el.style.display !== 'none'; },
        blockId, { timeout: 7000 }
      );
      const addr   = await page.textContent('#' + valId);
      const status = await page.textContent('#' + statusId);
      console.log(`✅ ${label}: "${addr.trim()}"  status="${status.trim()}"`);
      return addr.trim();
    } catch {
      const status = await page.textContent('#' + statusId).catch(() => '?');
      console.log(`❌ ${label}: block did not appear. status="${status.trim()}"`);
      return null;
    }
  }

  // ── TEST 1: Hero quote form – valid postal code ──────────────
  console.log('\n=== TEST 1: Hero quote form – valid postal code 160-0023 ===');
  await page.goto('https://hello-moving.com', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Force step 2 active via JS (bypasses styled radio / step-1 flow)
  await page.evaluate(() => {
    // Tick a service radio so step2 validation passes
    const r = document.querySelector('[name="service"]');
    if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    // Directly show step 2
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    const s2 = document.getElementById('formStep2');
    if (s2) s2.classList.add('active');
  });
  await page.waitForTimeout(300);
  const step2Shown = await page.locator('#formStep2.active').count() > 0;
  console.log('Step 2 visible:', step2Shown);
  await shot('01_hero_step2');

  // Fill "from" postal code – valid
  await page.locator('#qFromZip').fill('1600023');
  await page.waitForTimeout(1200);
  const fromAddr = await waitForAddr('qFromAddrBlock', 'qFromAddrVal', 'qFromZipStatus', 'Hero From');
  await shot('02_hero_from_resolved');

  // Fill "to" postal code – valid
  await page.locator('#qToZip').fill('1000001');
  await page.waitForTimeout(1200);
  const toAddr = await waitForAddr('qToAddrBlock', 'qToAddrVal', 'qToZipStatus', 'Hero To');
  await shot('03_hero_to_resolved');

  // Verify hidden inputs populated
  const fromHidden = await page.inputValue('#qFromAddr');
  const toHidden   = await page.inputValue('#qToAddr');
  console.log('   Hidden currentAddress:', fromHidden || '(empty)');
  console.log('   Hidden newAddress:    ', toHidden   || '(empty)');

  // Step 2 Next should advance (hidden inputs have values)
  await page.locator('#step2Next').click();
  await page.waitForTimeout(400);
  const step3Active = await page.locator('#formStep3.active').count() > 0;
  console.log(step3Active ? '✅ Advances to step 3' : '❌ Did not advance to step 3');

  // ── TEST 2: Hero quote form – invalid postal code ────────────
  console.log('\n=== TEST 2: Hero quote form – invalid postal code 0000000 ===');
  // Go back to step 2
  await page.evaluate(() => {
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    document.getElementById('formStep2').classList.add('active');
  });
  await page.locator('#qFromZip').fill('0000000');
  await page.waitForTimeout(1200);
  const fromStatus2 = (await page.textContent('#qFromZipStatus')).trim();
  console.log('Status text:', fromStatus2);
  console.log(fromStatus2.includes('見つかりません') ? '✅ Error shown' : '❌ No error shown');
  await shot('04_hero_invalid_zip');

  // ── TEST 3: Booking form Step 3 – valid postal code ──────────
  console.log('\n=== TEST 3: Booking form – valid postal code 160-0023 ===');
  await page.goto('https://hello-moving.com', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Force booking form to step 3 via JS
  await page.evaluate(() => {
    for (let i = 1; i <= 6; i++) {
      const s = document.getElementById('bkStep' + i);
      if (s) s.style.display = (i === 3) ? 'block' : 'none';
    }
    // Set required booking state so step 3 renders
    const bkSvc = document.querySelector('[name="bk_service"]');
    if (bkSvc) { bkSvc.checked = true; }
  });
  await page.waitForTimeout(300);

  const bkStep3Vis = await page.locator('#bkStep3').isVisible();
  console.log('Booking step 3 visible:', bkStep3Vis);
  await shot('05_booking_step3');

  // Fill valid "from" postal code
  await page.locator('#bkFromZip').fill('1600023');
  await page.waitForTimeout(1200);
  await waitForAddr('bkFromAddrBlock', 'bkFromAddrVal', 'bkFromZipStatus', 'Booking From');
  const bkFromHidden = await page.inputValue('#bkFrom');
  console.log('   Hidden #bkFrom:', bkFromHidden || '(empty)');
  await shot('06_booking_from_resolved');

  // Fill valid "to" postal code
  await page.locator('#bkToZip').fill('1000001');
  await page.waitForTimeout(1200);
  await waitForAddr('bkToAddrBlock', 'bkToAddrVal', 'bkToZipStatus', 'Booking To');
  const bkToHidden = await page.inputValue('#bkTo');
  console.log('   Hidden #bkTo:', bkToHidden || '(empty)');
  await shot('07_booking_to_resolved');

  // ── TEST 4: Booking form – invalid postal code ───────────────
  console.log('\n=== TEST 4: Booking form – invalid postal code 9999999 ===');
  await page.locator('#bkToZip').fill('9999999');
  await page.waitForTimeout(1200);
  const bkToStatus = (await page.textContent('#bkToZipStatus')).trim();
  console.log('Status text:', bkToStatus);
  console.log(bkToStatus.includes('見つかりません') ? '✅ Error shown' : '❌ No error shown');
  await shot('08_booking_invalid_zip');

  // ── TEST 5: Validation – Next without address ────────────────
  console.log('\n=== TEST 5: Validation – click Next with empty addresses ===');
  await page.evaluate(() => {
    document.getElementById('bkFrom').value = '';
    document.getElementById('bkTo').value   = '';
  });
  await page.locator('#bkS3Next').click();
  await page.waitForTimeout(400);
  const fromErrVis = await page.locator('#bkfFromErr').isVisible();
  const toErrVis   = await page.locator('#bkfToErr').isVisible();
  console.log(fromErrVis ? '✅ From error shown' : '❌ From error not shown');
  console.log(toErrVis   ? '✅ To error shown'   : '❌ To error not shown');
  await shot('09_booking_validation_error');

  // ── TEST 6: Building name appended ───────────────────────────
  console.log('\n=== TEST 6: Building name appends to hidden address ===');
  await page.locator('#bkFromZip').fill('1600023');
  await page.waitForTimeout(1200);
  try {
    await page.waitForFunction(
      () => { const el = document.getElementById('bkFromBldgField'); return el && el.style.display !== 'none'; },
      { timeout: 7000 }
    );
    await page.locator('#bkFromBldg').fill('テストマンション101');
    await page.waitForTimeout(300);
    const combined = await page.inputValue('#bkFrom');
    console.log('Combined value:', combined);
    console.log(combined.includes('テストマンション101') ? '✅ Building appended' : '❌ Building missing');
  } catch {
    console.log('❌ Building field did not appear');
  }
  await shot('10_building_appended');

  // ── TEST 7: Auto-format NNN-NNNN ─────────────────────────────
  console.log('\n=== TEST 7: Postal code auto-formatted to NNN-NNNN ===');
  await page.locator('#bkToZip').fill('1000001');
  await page.waitForTimeout(200);
  const formatted = await page.inputValue('#bkToZip');
  console.log('Input value after typing 1000001:', formatted);
  console.log(formatted === '100-0001' ? '✅ Auto-formatted correctly' : '❌ Format unexpected: ' + formatted);

  await browser.close();
  console.log('\nAll screenshots saved as _verify_*.png');
})();
