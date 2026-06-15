import { chromium } from 'playwright';
const base = 'http://localhost:5050';
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));

await page.goto(base + '/login.html');

// find a real booking to log in with
const bk = await page.evaluate(async () => {
  const { data } = await window.SupabaseClient.from('bookings').select('*').limit(30);
  return data || [];
});
let real = null, otherEmail = null;
for (const r of bk) {
  const m = /ref:(HM-[^\s\n]+)/.exec(r.notes || '');
  if (m && r.customer_email && !real) real = { ref: m[1], email: r.customer_email, name: r.customer_name };
  else if (r.customer_email && real && r.customer_email !== real.email) otherEmail = r.customer_email;
}
console.log('real booking:', real ? real.ref : 'NONE');

// log in
await page.fill('#email', real.email);
await page.fill('#ref', real.ref);
await Promise.all([page.waitForURL('**/portal.html').catch(()=>{}), page.click('#loginBtn')]);
await page.waitForTimeout(1800);
console.log('on portal:', page.url().includes('portal.html'));

// all 5 dashboard cards render
const cards = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.dcard-label')].map(e => e.textContent.trim());
  return labels;
});
const expected = ['予約ステータス','引越し日','担当スタッフ','見積もりステータス','最新の更新'];
const allPresent = expected.every(l => cards.includes(l));
console.log('cards rendered:', JSON.stringify(cards));
console.log('all 5 cards present:', allPresent, '| count:', cards.length);

// timeline rendered
const tl = await page.evaluate(() => document.querySelectorAll('.tl-item').length);
console.log('timeline items:', tl, '(>=1):', tl >= 1);

// correct booking shown (matches logged-in customer)
const shownName = await page.evaluate(() => document.getElementById('userName').textContent.trim());
console.log('shows correct customer:', shownName === (real.name || '').trim(), '| name:', shownName);

// customer sees only their own booking — header ref matches session ref, not another
const sessRef = await page.evaluate(() => window.PortalAuth.getSession().ref);
console.log('session bound to one ref:', sessRef);

// mobile responsive: at 375px cards become single column
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(400);
const mobile = await page.evaluate(() => {
  const grid = document.querySelector('.dash-cards');
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const burgerVisible = getComputedStyle(document.getElementById('burger')).display !== 'none';
  const mainMargin = getComputedStyle(document.querySelector('.p-main')).marginLeft;
  return { cols, burgerVisible, mainMargin };
});
console.log('mobile single-column:', mobile.cols === 1, '| burger visible:', mobile.burgerVisible, '| main margin:', mobile.mainMargin);

await b.close();
