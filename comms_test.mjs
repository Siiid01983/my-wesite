import { chromium } from 'playwright';
const base = 'http://localhost:5050';
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? '✅' : '❌') + ' ' + name); cond ? pass++ : fail++; };

await page.goto(base + '/login.html');

// Pick a real booking; prefer one that actually has communications.
const bookings = await page.evaluate(async () => {
  const { data } = await window.SupabaseClient.from('bookings').select('*').limit(50);
  return data || [];
});
const commIndex = await page.evaluate(async () => {
  const { data } = await window.SupabaseClient
    .from('communications').select('booking_id, customer_email').limit(500);
  return data || [];
});
const commSet = new Set(commIndex.map(r => String(r.booking_id)));
let target = null, anyBooking = null;
for (const r of bookings) {
  const m = /ref:(HM-[^\s\n]+)/.exec(r.notes || '');
  const ref = m ? m[1] : String(r.id);
  if (!r.customer_email) continue;
  if (!anyBooking) anyBooking = { ref, email: r.customer_email, name: r.customer_name };
  if (commSet.has(ref) || commSet.has(String(r.id))) { target = { ref, email: r.customer_email, name: r.customer_name }; break; }
}
const login = target || anyBooking;
console.log('   login booking:', login.ref, '| has comms:', !!target);

// Authenticate → reach portal.html (where PortalComms is loaded)
await page.fill('#email', login.email);
await page.fill('#ref', login.ref);
await Promise.all([page.waitForURL('**/portal.html').catch(()=>{}), page.click('#loginBtn')]);
await page.waitForTimeout(1500);
check('reached portal after login', page.url().includes('portal.html'));

// ---- Function-level security (PortalComms) — booking "15" has 10 rows ----
const A = '15', Aemail = 'test-verify@hello-moving.com', Bemail = 's.amrane1983@gmail.com';

const own = await page.evaluate(([id, em]) => window.PortalComms.fetchForBooking(id, em), [A, Aemail]);
check('history loads for own booking (>0 rows)', Array.isArray(own) && own.length > 0);
check('every row scoped to the booking_id', own.every(r => String(r.booking_id) === A));
check('every row belongs to the customer email', own.every(r => (r.customer_email||'').toLowerCase() === Aemail));

const wrongCustomer = await page.evaluate(([id, em]) => window.PortalComms.fetchForBooking(id, em), [A, Bemail]);
check('cross-customer (wrong email) sees nothing', Array.isArray(wrongCustomer) && wrongCustomer.length === 0);

// Array form (HM-ref + numeric id) stays scoped to ONE booking's rows only
const arrForm = await page.evaluate(([ids, em]) => window.PortalComms.fetchForBooking(ids, em), [[A, 'HM-NONEXISTENT'], Aemail]);
check('array of ids stays single-booking scoped', arrForm.every(r => String(r.booking_id) === A) && arrForm.length > 0);

const noScope = await page.evaluate((em) => window.PortalComms.fetchForBooking(null, em), Aemail);
check('no booking id → empty (no unfiltered read)', Array.isArray(noScope) && noScope.length === 0);

const nullScope = await page.evaluate((em) => window.PortalComms.fetchForBooking('(null)', em), Aemail);
check('null booking_id rows not exposed', Array.isArray(nullScope) && nullScope.length === 0);

const none = await page.evaluate((em) => window.PortalComms.fetchForBooking('HM-NO-SUCH-BOOKING', em), Aemail);
check('booking with no history → empty', Array.isArray(none) && none.length === 0);

// ---- UI flow ----
await page.click('.p-nav-item[data-view="messages"]');
await page.waitForTimeout(1500);
const ui = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.comm-item')];
  return {
    items: items.length,
    count: document.getElementById('commCount')?.textContent || '',
    empty: !!document.querySelector('.comm-empty'),
    hasDir: items.every(i => i.querySelector('.comm-dir')),
    hasBody: items.every(i => i.querySelector('.comm-body')),
  };
});
if (target) {
  check('messages view renders comm items', ui.items > 0);
  check('each item shows direction + body', ui.hasDir && ui.hasBody);
  check('count label populated', /件/.test(ui.count));
  // every rendered message belongs to the logged-in booking only
  const ok = await page.evaluate((em) => {
    const routes = [...document.querySelectorAll('.comm-route')].map(e => e.textContent);
    return routes.every(t => t.toLowerCase().includes(em.toLowerCase()));
  }, login.email);
  check('every rendered message involves the logged-in customer', ok);
} else {
  check('messages view renders cleanly (empty state)', ui.empty);
}

// ---- Mobile responsive ----
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
const mob = await page.evaluate(() => {
  const burger = getComputedStyle(document.getElementById('burger')).display !== 'none';
  const item = document.querySelector('.comm-item');
  const fits = item ? item.getBoundingClientRect().width <= 375 : true;
  return { burger, fits };
});
check('mobile: drawer burger visible + content fits width', mob.burger && mob.fits);

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
