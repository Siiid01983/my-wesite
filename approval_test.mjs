import { chromium } from 'playwright';
const base = 'http://localhost:5050';
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? '✅' : '❌') + ' ' + name); cond ? pass++ : fail++; };

await page.goto(base + '/login.html');

// log into a real booking to reach the portal (where PortalApproval is loaded)
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

check('PortalApproval module loaded', await page.evaluate(() => typeof window.PortalApproval === 'object'));
check('BookingService.approveEstimate exists', await page.evaluate(() =>
  typeof BookingService !== 'undefined' && typeof BookingService.approveEstimate === 'function'));

// ---- canApprove logic (pre-approval states only) ----
const ca = await page.evaluate(() => {
  const P = window.PortalApproval;
  return {
    nuevo:   P.canApprove({ status: '新規' }),
    review:  P.canApprove({ status: '確認中' }),
    confirm: P.canApprove({ status: '確定' }),
    done:    P.canApprove({ status: '完了' }),
    cancel:  P.canApprove({ status: 'キャンセル' }),
    none:    P.canApprove(null),
  };
});
check('canApprove true for 新規 (Quote Sent)', ca.nuevo === true);
check('canApprove true for 確認中 (Quote Sent)', ca.review === true);
check('canApprove false for 確定 (already approved)', ca.confirm === false);
check('canApprove false for 完了', ca.done === false);
check('canApprove false for キャンセル', ca.cancel === false);
check('canApprove false for null booking', ca.none === false);

// ---- End-to-end approve against a controlled fake Supabase (no real mutation) ----
const flow = await page.evaluate(async () => {
  const realSb = window.SupabaseClient;
  // Audit log starts empty so we can detect the new entry.
  localStorage.setItem('hm_audit_log', JSON.stringify({ version: 1, entries: [] }));

  const calls = { update: null, eqId: null, table: null };
  window.__fakeRow = {
    id: 555,
    customer_name:  'テスト 太郎',
    customer_email: 't@example.com',
    customer_phone: '09000000000',
    booking_date:   '2026-07-01',
    status:         'checking',                 // → 確認中 ("Quote Sent")
    notes:          'メモ\n[HM_EXTRAS]\nref:HM-TEST-1\nservice:単身引越し',
    created_at:     '2026-06-01T00:00:00Z',
  };
  window.SupabaseClient = {
    from(table) {
      let mode = 'select';
      const api = {
        select() { return api; },
        ilike()  { return api; },
        async maybeSingle() { return { data: window.__fakeRow, error: null }; },
        update(row) { mode = 'update'; calls.update = row; calls.table = table; return api; },
        eq(col, val) {
          if (mode === 'update') { calls.eqId = val; return Promise.resolve({ error: null }); }
          return api;
        },
      };
      return api;
    },
  };

  const res = await window.PortalApproval.approve('HM-TEST-1');

  // Guard: a second attempt on an already-approved row must be refused.
  window.__fakeRow.status = 'confirmed';
  const guard = await BookingService.approveEstimate('HM-TEST-1');

  const auditRaw = localStorage.getItem('hm_audit_log');
  const audit = JSON.parse(auditRaw).entries[0] || null;

  window.SupabaseClient = realSb; // restore
  return {
    ok: res.ok, from: res.from, to: res.to,
    updatePayload: calls.update,
    updateKeys: calls.update ? Object.keys(calls.update).sort() : [],
    eqId: calls.eqId,
    table: calls.table,
    guardOk: guard && guard.ok === false && guard.reason === 'not-approvable',
    audit,
  };
});
check('approve() returns ok', flow.ok === true);
check('status changes 確認中 → 確定', flow.from === '確認中' && flow.to === '確定');
check('DB write maps to existing "confirmed" value (schema preserved)',
  flow.updatePayload && flow.updatePayload.status === 'confirmed');
check('targeted update only touches status + updated_at (no row rewrite)',
  JSON.stringify(flow.updateKeys) === JSON.stringify(['status', 'updated_at']));
check('update targets the bookings table by DB id', flow.table === 'bookings' && flow.eqId === 555);
check('admin-visible: status persisted to bookings (Supabase update issued)',
  flow.updatePayload.status === 'confirmed');
check('already-approved booking is refused (idempotent guard)', flow.guardOk === true);
check('audit entry created', !!flow.audit);
check('audit entry is a quote update by the customer',
  flow.audit && flow.audit.entity === 'quote' && flow.audit.action === 'update' &&
  /^customer/.test(flow.audit.actor || ''));
check('audit detail records the transition to 確定',
  flow.audit && /確定/.test(flow.audit.detail || ''));

// ---- UI invariant: button presence matches the booking's approvability ----
await page.click('.p-nav-item[data-view="overview"]');
await page.waitForTimeout(400);
const ui = await page.evaluate(() => {
  const badge = document.querySelector('#content .dash-cards .dcard .dcard-value .badge');
  const status = badge ? badge.textContent.trim() : '';
  const hasBtn = !!document.getElementById('approveEstimateBtn');
  const approvable = ['新規', '確認中'].indexOf(status) !== -1;
  return { status, hasBtn, approvable };
});
check('Approve button shown iff booking is in a pre-approval state (status=' + ui.status + ')',
  ui.hasBtn === ui.approvable);

// ---- Mobile responsive ----
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
const mob = await page.evaluate(() => {
  const burger = getComputedStyle(document.getElementById('burger')).display !== 'none';
  const content = document.getElementById('content');
  const fits = content ? content.getBoundingClientRect().width <= 375 : true;
  return { burger, fits };
});
check('mobile: drawer burger visible + content fits width', mob.burger && mob.fits);

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
