const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://localhost:5050', { waitUntil: 'networkidle' });

  // Close-up: service cards grid (the 3-card row)
  await page.evaluate(() => {
    const cards = document.querySelectorAll('.service-grid .service-card:not(.service-card-featured)');
    if (cards[0]) cards[0].scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(400);
  const gridBox = await page.evaluate(() => {
    const g = document.querySelector('.service-grid');
    const r = g.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.screenshot({ path: 'screenshot-cards-closeup.png', clip: { x: Math.max(0, gridBox.x - 20), y: Math.max(0, gridBox.y - 20), width: gridBox.width + 40, height: gridBox.height + 40 } });

  // Booking form: scroll into service choice grid
  await page.evaluate(() => {
    const bk = document.querySelector('#bkStep1');
    if (bk) bk.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshot-booking-choices.png', fullPage: false });

  await browser.close();
  console.log('done');
})();
