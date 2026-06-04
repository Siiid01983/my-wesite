const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://localhost:8787', { waitUntil: 'networkidle' });

  // Services section
  await page.evaluate(() => document.querySelector('#services').scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshot-services.png', fullPage: false });

  // Booking form step 1
  await page.evaluate(() => document.querySelector('#booking').scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshot-booking.png', fullPage: false });

  await browser.close();
  console.log('done');
})();
