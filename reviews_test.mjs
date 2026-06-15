import { chromium } from 'playwright';
const base = 'http://localhost:5050';
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? '✅' : '❌') + ' ' + name); cond ? pass++ : fail++; };

await page.goto(base + '/login.html');
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
check('PortalReviews module loaded', await page.evaluate(() =>
  typeof window.PortalReviews === 'object' && typeof PortalReviews.submit === 'function'));

// ---- Availability: canReview only after completion (完了) ----
const ca = await page.evaluate(() => {
  const P = window.PortalReviews;
  return {
    done:    P.canReview({ status: '完了' }),
    nuevo:   P.canReview({ status: '新規' }),
    review:  P.canReview({ status: '確認中' }),
    confirm: P.canReview({ status: '確定' }),
    cancel:  P.canReview({ status: 'キャンセル' }),
    none:    P.canReview(null),
  };
});
check('canReview true only for 完了 (completed)', ca.done === true);
check('canReview false for 新規/確認中/確定/キャンセル/null',
  !ca.nuevo && !ca.review && !ca.confirm && !ca.cancel && !ca.none);

// ---- Scope guard for review photos ----
const guard = await page.evaluate(() => {
  const A = ['HM-REV-1', '777'];
  const P = window.PortalReviews;
  return {
    own:      P._inScope('customer-documents/HM-REV-1/reviews/a.jpg', A),
    ownId:    P._inScope('customer-documents/777/reviews/b.jpg', A),
    other:    P._inScope('customer-documents/HM-XXX/reviews/secret.jpg', A),
    traverse: P._inScope('customer-documents/HM-REV-1/reviews/../../HM-XXX/x.jpg', A),
    notReview:P._inScope('customer-documents/HM-REV-1/photos/room/a.jpg', A),
  };
});
check('own review-photo path in scope', guard.own === true && guard.ownId === true);
check('other-booking / traversal / non-review paths blocked',
  guard.other === false && guard.traverse === false && guard.notReview === false);

// ---- Install a controlled fake Supabase (reviews table + storage + audit) ----
await page.evaluate(() => {
  window.__reviews = [];
  window.__audit = [];
  window.__store = {};
  window.SupabaseClient = {
    from(table) {
      if (table === 'reviews') {
        let filterIds = null;
        const api = {
          select() { return api; },
          in(col, vals) { filterIds = vals; return api; },
          limit(n) {
            let rows = window.__reviews;
            if (filterIds) rows = rows.filter(r => filterIds.map(String).includes(String(r.booking_reference)));
            return Promise.resolve({ data: rows.slice(0, n), error: null });
          },
          insert(row) { window.__reviews.push(row); return Promise.resolve({ error: null }); },
        };
        return api;
      }
      if (table === 'audit_log') {
        return { insert(row) { window.__audit.push(row); return Promise.resolve({ error: null }); } };
      }
      return { select(){ return { in(){ return { limit(){ return Promise.resolve({ data: [], error: null }); } }; } }; } };
    },
    storage: {
      from() {
        return {
          async upload(path, file) { window.__store[path] = { size: file.size || 1 }; return { error: null }; },
          async list(folder) {
            return { data: Object.keys(window.__store).filter(p => p.startsWith(folder + '/'))
              .map(p => ({ name: p.split('/').pop(), created_at: '2026-06-16T00:00:00Z', metadata: { size: 1 } })), error: null };
          },
          async createSignedUrl(path) { return { data: { signedUrl: 'https://signed.example/' + encodeURIComponent(path) }, error: null }; },
        };
      },
    },
  };
});

// ---- Active (not completed) customer cannot review ----
const active = await page.evaluate(async () => {
  const before = window.__reviews.length;
  const res = await PortalReviews.submit({ id: 'HM-ACT-1', name: 'A', service: '単身', status: '確定' }, { rating: 5, text: 'great' });
  return { ok: res.ok, error: res.error, added: window.__reviews.length - before };
});
check('active customer cannot review (not-completed, no row written)',
  active.ok === false && active.error === 'not-completed' && active.added === 0);

// ---- Completed customer can review; rating saves correctly ----
const submit = await page.evaluate(async () => {
  const res = await PortalReviews.submit(
    { id: 'HM-REV-1', _dbId: 777, name: 'テスト花子', service: '家族引越し', status: '完了' },
    { rating: 4, text: 'とても丁寧でした。' });
  const row = window.__reviews[window.__reviews.length - 1];
  return { ok: res.ok, row, audited: window.__audit[window.__audit.length - 1] };
});
check('completed customer can review (submit ok)', submit.ok === true);
check('rating saves correctly (1–5)', submit.row && submit.row.rating === 4);
check('review_text saved', submit.row && submit.row.review_text === 'とても丁寧でした。');
check('connects to workflow: source=customer, approved=false (pending)',
  submit.row && submit.row.source === 'customer' && submit.row.approved === false);
check('linked to booking (booking_reference) + has reference_id',
  submit.row && submit.row.booking_reference === 'HM-REV-1' && /^REV-/.test(submit.row.reference_id));
check('submission writes a centralized audit entry',
  submit.audited && submit.audited.target_type === 'review' && submit.audited.action === 'add');

// ---- Invalid rating rejected ----
const bad = await page.evaluate(async () => {
  const r0 = await PortalReviews.submit({ id: 'HM-REV-2', name: 'B', status: '完了' }, { rating: 0, text: 'x' });
  const r6 = await PortalReviews.submit({ id: 'HM-REV-2', name: 'B', status: '完了' }, { rating: 6, text: 'x' });
  return { r0: r0.error, r6: r6.error };
});
check('invalid rating rejected (0 and 6 → bad-rating)', bad.r0 === 'bad-rating' && bad.r6 === 'bad-rating');

// ---- Duplicate prevention ----
const dup = await page.evaluate(async () => {
  const before = window.__reviews.length;
  const res = await PortalReviews.submit(
    { id: 'HM-REV-1', _dbId: 777, name: 'テスト花子', service: '家族引越し', status: '完了' },
    { rating: 5, text: '二回目のレビュー' });
  return { ok: res.ok, error: res.error, added: window.__reviews.length - before };
});
check('duplicate review prevented (one per booking)', dup.ok === false && dup.error === 'duplicate' && dup.added === 0);

// ---- Photo upload to the booking-scoped review folder ----
const photo = await page.evaluate(async () => {
  const f = new File([new Uint8Array(2048)], 'after.PNG', { type: 'image/png' });
  const res = await PortalReviews.uploadPhoto('HM-REV-1', f);
  const list = await PortalReviews.listPhotos(['HM-REV-1']);
  return { ok: res.ok, path: res.path, listed: list.length, signed: list[0] && list[0].url };
});
check('review photo uploads to customer-documents/<id>/reviews/',
  photo.ok === true && /^customer-documents\/HM-REV-1\/reviews\//.test(photo.path));
check('review photo listed with a signed (non-public) URL',
  photo.listed === 1 && typeof photo.signed === 'string' && photo.signed.startsWith('https://signed'));

// ---- UI invariant: form shown iff completed, else locked message ----
await page.click('.p-nav-item[data-view="overview"]');
await page.waitForTimeout(300);
const status = await page.evaluate(() => {
  const badge = document.querySelector('#content .dash-cards .dcard .dcard-value .badge');
  return badge ? badge.textContent.trim() : '';
});
await page.click('.p-nav-item[data-view="reviews"]');
await page.waitForTimeout(500);
const ui = await page.evaluate(() => ({
  locked: !!document.querySelector('#reviewSection .rev-locked'),
  form:   !!document.getElementById('revSubmitBtn'),
  existing: !!document.querySelector('#reviewSection .rev-done'),
}));
const completed = status === '完了';
check('reviews UI: locked for non-completed / available for completed (status=' + status + ')',
  completed ? (ui.form || ui.existing) : ui.locked);

// ---- Mobile responsive ----
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
const mob = await page.evaluate(() => {
  const burger = getComputedStyle(document.getElementById('burger')).display !== 'none';
  const host = document.getElementById('reviewSection');
  const fits = host ? host.getBoundingClientRect().width <= 375 : true;
  return { burger, fits };
});
check('mobile: drawer burger visible + content fits width', mob.burger && mob.fits);

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
