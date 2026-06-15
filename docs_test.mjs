import { chromium } from 'playwright';
const base = 'http://localhost:5050';
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? '✅' : '❌') + ' ' + name); cond ? pass++ : fail++; };

await page.goto(base + '/login.html');

// log into a real booking to reach the portal (where PortalDocs is loaded)
const login = await page.evaluate(async () => {
  const { data } = await window.SupabaseClient.from('bookings').select('*').limit(20);
  for (const r of (data || [])) {
    const m = /ref:(HM-[^\s\n]+)/.exec(r.notes || '');
    if (r.customer_email) return { ref: m ? m[1] : String(r.id), email: r.customer_email };
  }
  return null;
});
await page.fill('#email', login.email);
await page.fill('#ref', login.ref);
await Promise.all([page.waitForURL('**/portal.html').catch(()=>{}), page.click('#loginBtn')]);
await page.waitForTimeout(1500);
check('reached portal after login', page.url().includes('portal.html'));

// ---- Security: out-of-scope download is blocked (no storage needed) ----
const guard = await page.evaluate(() => {
  const A = ['HM-AAA', '101'];
  return {
    inOwn:   window.PortalDocs._inScope('customer-documents/HM-AAA/contracts/c.pdf', A),
    inDbId:  window.PortalDocs._inScope('customer-documents/101/estimates/e.pdf', A),
    other:   window.PortalDocs._inScope('customer-documents/HM-BBB/contracts/secret.pdf', A),
    root:    window.PortalDocs._inScope('customer-documents/', A),
    traverse:window.PortalDocs._inScope('customer-documents/HM-AAA/../HM-BBB/x.pdf', A),
  };
});
check('in-scope path (HM ref) allowed', guard.inOwn === true);
check('in-scope path (numeric id) allowed', guard.inDbId === true);
check('other booking path blocked', guard.other === false);
check('bucket-root path blocked', guard.root === false);

const blockedUrl = await page.evaluate(() =>
  window.PortalDocs.getDownloadUrl(['HM-AAA'], 'customer-documents/HM-BBB/contracts/secret.pdf'));
check('getDownloadUrl returns null for out-of-scope path', blockedUrl === null);

// ---- Listing + download with a controlled fake Storage layer ----
const faked = await page.evaluate(async () => {
  const real = window.SupabaseClient.storage;
  const now = '2026-06-10T09:30:00Z';
  const files = {
    'customer-documents/HM-AAA/estimates':   [{ name: 'estimate-001.pdf', created_at: now, metadata: { size: 23456 } }],
    'customer-documents/HM-AAA/contracts':   [{ name: 'contract.pdf', created_at: now, metadata: { size: 88888 } },
                                              { name: '.emptyFolderPlaceholder', created_at: now, metadata: { size: 0 } }],
    'customer-documents/HM-AAA/attachments': [{ name: 'photo.jpg', created_at: now, metadata: { size: 120000 } }],
    'customer-documents/HM-BBB/contracts':   [{ name: 'OTHER-SECRET.pdf', created_at: now, metadata: { size: 1 } }],
  };
  window.SupabaseClient.storage = {
    from() {
      return {
        async list(folder) { return { data: files[folder] || [], error: null }; },
        async createSignedUrl(path) { return { data: { signedUrl: 'https://signed.example/' + encodeURIComponent(path) }, error: null }; },
        getPublicUrl(path) { return { data: { publicUrl: 'https://pub.example/' + path } }; },
      };
    },
  };
  const res = await window.PortalDocs.list(['HM-AAA']);
  const url = await window.PortalDocs.getDownloadUrl(['HM-AAA'], 'customer-documents/HM-AAA/contracts/contract.pdf');
  const leak = res.all.some(f => /SECRET/i.test(f.name));
  window.SupabaseClient.storage = real; // restore
  return {
    est: res.sections.estimates.length,
    con: res.sections.contracts.length,
    att: res.sections.attachments.length,
    all: res.all.length,
    uploadedAt: res.all[0] && res.all[0].uploadedAt,
    placeholderFiltered: !res.sections.contracts.some(f => f.name.includes('Placeholder')),
    url, leak,
  };
});
check('listing returns estimate file', faked.est === 1);
check('listing returns contract file (placeholder filtered)', faked.con === 1 && faked.placeholderFiltered);
check('listing returns attachment file', faked.att === 1);
check('download center aggregates all (3)', faked.all === 3);
check('upload date present on files', !!faked.uploadedAt);
check('download resolves a signed URL', typeof faked.url === 'string' && faked.url.startsWith('https://signed'));
check('no other-booking files leak into listing', faked.leak === false);

// ---- UI render (live storage — likely empty, must render gracefully) ----
await page.click('.p-nav-item[data-view="documents"]');
await page.waitForTimeout(1200);
const ui = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('#docSections .panel')];
  const titles = panels.map(p => p.querySelector('.panel-title')?.textContent.trim());
  return { panels: panels.length, titles };
});
check('documents view renders 4 sections', ui.panels === 4);
check('sections include Estimate/Contracts/Attachments/Download Center',
  ui.titles.some(t=>/見積書/.test(t)) && ui.titles.some(t=>/契約書/.test(t)) &&
  ui.titles.some(t=>/添付/.test(t)) && ui.titles.some(t=>/ダウンロードセンター/.test(t)));

// ---- Mobile responsive ----
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
const mob = await page.evaluate(() => {
  const burger = getComputedStyle(document.getElementById('burger')).display !== 'none';
  const host = document.getElementById('docSections');
  const fits = host ? host.getBoundingClientRect().width <= 375 : true;
  return { burger, fits };
});
check('mobile: drawer burger visible + content fits width', mob.burger && mob.fits);

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
