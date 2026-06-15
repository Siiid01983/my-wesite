import { chromium } from 'playwright';
const base = 'http://localhost:5050';
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? '✅' : '❌') + ' ' + name); cond ? pass++ : fail++; };

await page.goto(base + '/login.html');

// log into a real booking to reach the portal (where PortalPhotos is loaded)
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

check('PortalPhotos module loaded', await page.evaluate(() => typeof window.PortalPhotos === 'object'));
check('three categories defined (room/furniture/special)', await page.evaluate(() =>
  JSON.stringify(window.PortalPhotos.CATEGORIES.map(c => c.id)) === '["room","furniture","special"]'));

// ---- Security: booking-scoping guard (no storage needed) ----
const guard = await page.evaluate(() => {
  const A = ['HM-AAA', '101'];
  const P = window.PortalPhotos;
  return {
    inOwnRef:   P._inScope('customer-documents/HM-AAA/photos/room/a.jpg', A),
    inOwnDbId:  P._inScope('customer-documents/101/photos/furniture/b.jpg', A),
    other:      P._inScope('customer-documents/HM-BBB/photos/room/secret.jpg', A),
    root:       P._inScope('customer-documents/', A),
    traverse:   P._inScope('customer-documents/HM-AAA/photos/../../HM-BBB/x.jpg', A),
    siblingDoc: P._inScope('customer-documents/HM-AAA/contracts/c.pdf', A), // not under /photos/
  };
});
check('own photo path (HM ref) in scope', guard.inOwnRef === true);
check('own photo path (numeric id) in scope', guard.inOwnDbId === true);
check('other booking photo blocked', guard.other === false);
check('bucket-root path blocked', guard.root === false);
check('path traversal blocked', guard.traverse === false);

// signed URL refuses an out-of-scope path
const blockedUrl = await page.evaluate(() =>
  window.PortalPhotos.signedUrl(['HM-AAA'], 'customer-documents/HM-BBB/photos/room/secret.jpg'));
check('signedUrl returns null for out-of-scope path', blockedUrl === null);

// delete refuses an out-of-scope path
const blockedDel = await page.evaluate(() =>
  window.PortalPhotos.remove(['HM-AAA'], 'customer-documents/HM-BBB/photos/room/secret.jpg'));
check('remove() refuses out-of-scope path', blockedDel && blockedDel.ok === false && blockedDel.error === 'out-of-scope');

// ---- Upload + preview + delete + path-linkage with a controlled fake Storage layer ----
const faked = await page.evaluate(async () => {
  const real = window.SupabaseClient.storage;
  const now = '2026-06-16T09:30:00Z';
  const store = {}; // folder -> [entries]
  const uploaded = [];
  const removed = [];
  // seed an existing room photo + an OTHER booking's photo (must never surface)
  store['customer-documents/HM-AAA/photos/room'] = [{ name: 'seed-room.jpg', created_at: now, metadata: { size: 4444 } }];
  store['customer-documents/HM-BBB/photos/room'] = [{ name: 'OTHER-SECRET.jpg', created_at: now, metadata: { size: 1 } }];

  window.SupabaseClient.storage = {
    from() {
      return {
        async list(folder) { return { data: store[folder] || [], error: null }; },
        async upload(path, file, opts) {
          uploaded.push(path);
          const slash = path.lastIndexOf('/');
          const folder = path.slice(0, slash), name = path.slice(slash + 1);
          (store[folder] = store[folder] || []).push({ name, created_at: now, metadata: { size: file.size || 99 } });
          return { error: null };
        },
        async createSignedUrl(path) { return { data: { signedUrl: 'https://signed.example/' + encodeURIComponent(path) }, error: null }; },
        async remove(paths) {
          paths.forEach(p => {
            removed.push(p);
            const slash = p.lastIndexOf('/');
            const folder = p.slice(0, slash), name = p.slice(slash + 1);
            if (store[folder]) store[folder] = store[folder].filter(e => e.name !== name);
          });
          return { error: null };
        },
      };
    },
  };

  const P = window.PortalPhotos;
  const fakeImg = new File([new Uint8Array(1234)], 'myroom.PNG', { type: 'image/png' });

  // 1) upload to own booking, furniture category
  const up = await P.upload('HM-AAA', 'furniture', fakeImg);
  // 2) bad category rejected
  const badCat = await P.upload('HM-AAA', 'garage', fakeImg);
  // 3) non-image rejected
  const notImg = await P.upload('HM-AAA', 'room', new File(['x'], 'a.txt', { type: 'text/plain' }));
  // 4) list everything for the booking (both ids)
  const listed = await P.list(['HM-AAA', '101']);
  // 5) delete the seeded room photo
  const del = await P.remove(['HM-AAA'], 'customer-documents/HM-AAA/photos/room/seed-room.jpg');
  const afterDel = await P.list(['HM-AAA']);

  window.SupabaseClient.storage = real; // restore
  return {
    upOk: up.ok, upPath: up.path,
    badCat: badCat.ok === false && badCat.error === 'bad-category',
    notImg: notImg.ok === false && notImg.error === 'not-an-image',
    uploadedPaths: uploaded,
    furnCount: listed.furniture.length,
    roomCount: listed.room.length,
    furnUrl: listed.furniture[0] && listed.furniture[0].url,
    furnDate: listed.furniture[0] && listed.furniture[0].uploadedAt,
    leak: [...listed.room, ...listed.furniture, ...listed.special].some(p => /SECRET/i.test(p.name)),
    removed,
    roomAfterDel: afterDel.room.length,
  };
});
check('upload succeeds for own booking', faked.upOk === true);
check('upload path is booking-scoped under /photos/<category>',
  /^customer-documents\/HM-AAA\/photos\/furniture\//.test(faked.upPath) &&
  faked.uploadedPaths.every(p => p.startsWith('customer-documents/HM-AAA/photos/')));
check('invalid category rejected', faked.badCat);
check('non-image file rejected', faked.notImg);
check('uploaded photo appears in its category listing', faked.furnCount === 1);
check('preview uses a signed URL (never public)',
  typeof faked.furnUrl === 'string' && faked.furnUrl.startsWith('https://signed'));
check('upload date present on photo', !!faked.furnDate);
check('no other-booking photos leak into listing', faked.leak === false);
check('delete removes own photo (room 1 → 0)', faked.roomCount === 1 && faked.roomAfterDel === 0);
check('delete targeted the booking-scoped path',
  faked.removed.length === 1 && faked.removed[0] === 'customer-documents/HM-AAA/photos/room/seed-room.jpg');

// ---- UI render (live storage — likely empty, must render gracefully) ----
await page.click('.p-nav-item[data-view="photos"]');
await page.waitForTimeout(1200);
const ui = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('#photoSections .panel')];
  const titles = panels.map(p => p.querySelector('.panel-title')?.textContent.trim());
  const uploads = document.querySelectorAll('#photoSections .ph-up input[type=file]').length;
  return { panels: panels.length, titles, uploads };
});
check('photos view renders 3 category sections', ui.panels === 3);
check('sections include Room/Furniture/Special',
  ui.titles.some(t=>/部屋|Room/.test(t)) && ui.titles.some(t=>/家具|Furniture/.test(t)) &&
  ui.titles.some(t=>/特別|Special/.test(t)));
check('each category exposes an upload control', ui.uploads === 3);

// ---- Mobile responsive ----
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
const mob = await page.evaluate(() => {
  const burger = getComputedStyle(document.getElementById('burger')).display !== 'none';
  const host = document.getElementById('photoSections');
  const fits = host ? host.getBoundingClientRect().width <= 375 : true;
  return { burger, fits };
});
check('mobile: drawer burger visible + content fits width', mob.burger && mob.fits);

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
