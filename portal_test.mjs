import { chromium } from 'playwright';
const base = 'http://localhost:5050';
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));

// 1) login page loads + Supabase client present
await page.goto(base + '/login.html');
const hasForm = await page.$('#loginForm') !== null;
const sbReady = await page.evaluate(() => !!window.SupabaseClient);
console.log('1. login loads:', hasForm, '| supabase client:', sbReady);

// pull a real booking to drive happy-path
const bk = await page.evaluate(async () => {
  if (!window.SupabaseClient) return null;
  const { data } = await window.SupabaseClient.from('bookings').select('*').limit(30);
  return data || [];
});
let real = null;
if (Array.isArray(bk)) {
  for (const r of bk) {
    const m = /ref:(HM-[^\s\n]+)/.exec(r.notes || '');
    if (m && r.customer_email) { real = { ref: m[1], email: r.customer_email }; break; }
  }
}
console.log('   real booking:', real ? real.ref : 'NONE', '| rows:', Array.isArray(bk) ? bk.length : 'n/a');

// 4) invalid ref blocked
const badResult = await page.evaluate(async () =>
  (await window.PortalAuth.login('nobody@example.com', 'HM-00000000-XXXX')).ok);
console.log('4. invalid ref blocked:', badResult === false);

if (real) {
  const wrongEmail = await page.evaluate(async (ref) =>
    (await window.PortalAuth.login('wrong@nope.com', ref)).ok, real.ref);
  console.log('4b valid ref + wrong email blocked:', wrongEmail === false);

  await page.evaluate(() => window.PortalAuth.logout());
  await page.fill('#email', real.email);
  await page.fill('#ref', real.ref);
  await Promise.all([page.waitForURL('**/portal.html').catch(()=>{}), page.click('#loginBtn')]);
  await page.waitForTimeout(1500);
  console.log('2. login -> portal:', page.url().includes('portal.html'));

  await page.reload();
  await page.waitForTimeout(1000);
  const hasSess = await page.evaluate(() => !!window.PortalAuth.getSession());
  console.log('3. session persists after refresh:', page.url().includes('portal.html') && hasSess);

  const refShown = await page.evaluate(() => document.getElementById('userRef')?.textContent || '');
  console.log('   portal renders booking ref:', refShown.includes('HM-'));

  await page.click('#logoutBtn');
  await page.waitForTimeout(500);
  await page.goto(base + '/portal.html');
  await page.waitForTimeout(800);
  console.log('   portal blocked after logout:', page.url().includes('login.html'));
} else {
  await page.goto(base + '/portal.html');
  await page.waitForTimeout(800);
  console.log('2/3 portal guard redirects (no session):', page.url().includes('login.html'));
}
await b.close();
