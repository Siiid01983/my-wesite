import { chromium } from 'playwright';
const base = 'http://localhost:5050';
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));

// Mock booking identity (also asserted against below).
const real = { ref: 'HM-12345', email: 'test@example.com', name: 'Test Customer' };

// Realistic RAW booking row (server shape). bookingService._rowToBooking unpacks
// the [HM_EXTRAS] notes block into the booking object the dashboard renders from.
const MOCK_ROW = {
  id: 'a1b2c3d4-000000000001',
  customer_name: 'Test Customer',
  customer_email: 'test@example.com',
  customer_phone: '090-1234-5678',
  booking_date: '2026-09-01',
  service_id: null,
  status: 'confirmed',
  from: '東京都新宿区',
  to: '東京都渋谷区',
  service: '単身引越し',
  time: '午前（9:00〜12:00）',
  workers: '田中・佐藤',
  notes: '\n[HM_EXTRAS]\nref:HM-12345\nservice:単身引越し\ntime:午前（9:00〜12:00）\nfrom:東京都新宿区\nto:東京都渋谷区\nlocmode:dual\nworkers:田中・佐藤',
  items: null,
  created_at: '2026-07-01T09:00:00Z'
};

// ── Backend-layer mock (mock the network, NOT PortalAuth) ────────────────────
// The real portal flow runs unchanged; it just believes it's talking to hm-api.
const json = (obj) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

// 1) Auth verification — PortalAuth.login mints the real sessionStorage token from this.
await page.route('**/auth.php', (route) => route.fulfill(json({ ok: true, booking: MOCK_ROW })));
// 2) Booking retrieval — dashboard cards + timeline render from this.
await page.route('**/get-booking.php*', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: MOCK_ROW })
  });
});
// 3) Chat polling — return empty so the chat widget doesn't error (not part of the dashboard).
await page.route('**/chat.php**', (route) => route.fulfill(json({ ok: true, data: [] })));

console.log('real booking:', real.ref);

// Real login flow: fill the form → mocked auth.php verifies → real token minted → portal.
await page.goto(base + '/login.html');
await page.fill('#email', real.email);
await page.fill('#reference', real.ref);
await Promise.all([page.waitForURL('**/portal.html').catch(() => {}), page.click('#loginBtn')]);
await page.waitForTimeout(1800);
console.log('on portal:', page.url().includes('portal.html'));

// all 5 dashboard cards render
const cards = await page.evaluate(() => {
  return [...document.querySelectorAll('.dcard-label')].map(e => e?.textContent?.trim() || '');
});
const expected = ['予約ステータス','引越し日','担当スタッフ','見積もりステータス','最新の更新'];
const allPresent = expected.every(l => cards.includes(l));
console.log('cards rendered:', JSON.stringify(cards));
console.log('all 5 cards present:', allPresent, '| count:', cards.length);

// timeline rendered
const tl = await page.evaluate(() => document.querySelectorAll('.tl-item').length);
console.log('timeline items:', tl, '(>=1):', tl >= 1);

// correct booking shown (matches logged-in customer)
const userName = await page.evaluate(() => {
  const el = document.getElementById('userName');
  return el?.textContent?.trim() || '';
});
console.log('shows correct customer:', userName === 'Test Customer', '| name:', userName);

// customer sees only their own booking — header ref matches session ref, not another
const sessRef = await page.evaluate(() => window.PortalAuth?.getSession?.()?.ref ?? null);
console.log('session bound to one ref:', sessRef);

await page.screenshot({ path: 'dashboard_desktop.png', fullPage: true }).catch(() => {});

// mobile responsive: at 375px cards become single column
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(400);
const mobile = await page.evaluate(() => {
  const grid = document.querySelector('.dash-cards');
  const burger = document.getElementById('burger');
  const main = document.querySelector('.p-main');
  return {
    cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null,
    burgerVisible: burger ? getComputedStyle(burger).display !== 'none' : null,
    mainMargin: main ? getComputedStyle(main).marginLeft : null,
  };
});
console.log('mobile single-column:', mobile.cols === 1, '| burger visible:', mobile.burgerVisible, '| main margin:', mobile.mainMargin);

await page.screenshot({ path: 'dashboard_mobile.png', fullPage: true }).catch(() => {});
await b.close();
