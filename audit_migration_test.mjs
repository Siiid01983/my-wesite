import { chromium } from 'playwright';
const base = 'http://localhost:5050';
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? '✅' : '❌') + ' ' + name); cond ? pass++ : fail++; };

// ─────────────────────────────────────────────────────────────
// PART 1 — Portal: AuditService contract + customer approval + security
// ─────────────────────────────────────────────────────────────
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
check('AuditService loaded on portal', await page.evaluate(() =>
  typeof window.AuditService === 'object' && typeof AuditService.record === 'function' && typeof AuditService.query === 'function'));

// Install a controlled fake Supabase modeling audit_log + bookings (no live table needed).
await page.evaluate(() => {
  window.__audit = [];
  window.__bk = {
    id: 901, customer_name: 'A', customer_email: 't@e.com', booking_date: '2026-07-01',
    status: 'checking', notes: 'n\n[HM_EXTRAS]\nref:HM-AUD-1', created_at: '2026-06-01T00:00:00Z',
  };
  window.SupabaseClient = {
    from(table) {
      if (table === 'audit_log') {
        return {
          insert(row) {
            const r = Object.assign(
              { id: 'a' + (window.__audit.length + 1), created_at: new Date(Date.now() + window.__audit.length).toISOString() },
              row);
            window.__audit.push(r);
            return Promise.resolve({ error: null });
          },
          select() {
            const api2 = {
              order() { return api2; },
              limit() { return Promise.resolve({ data: window.__audit.slice().reverse(), error: null }); },
            };
            return api2;
          },
        };
      }
      // bookings branch (for the approval flow)
      let mode = 'select';
      const api = {
        select() { return api; },
        ilike()  { return api; },
        async maybeSingle() { return { data: window.__bk, error: null }; },
        update(r) { mode = 'update'; window.__upd = r; return api; },
        eq() { return mode === 'update' ? Promise.resolve({ error: null }) : api; },
      };
      return api;
    },
  };
});

// record() contract — maps the 7-field schema correctly.
const rec = await page.evaluate(async () => {
  const before = window.__audit.length;
  const res = await AuditService.record({ actor: 'customer:x@y.com', action: 'login', targetType: 'auth', targetId: 'HM-X', details: 'Portal Login' });
  const row = window.__audit[window.__audit.length - 1];
  return { ok: res.ok, added: window.__audit.length - before, row };
});
check('AuditService.record() inserts a row', rec.ok === true && rec.added === 1);
check('row has all schema fields (id, created_at, actor, action, target_type, target_id, details)',
  rec.row && rec.row.id && rec.row.created_at && rec.row.actor === 'customer:x@y.com' &&
  rec.row.action === 'login' && rec.row.target_type === 'auth' && rec.row.target_id === 'HM-X' && rec.row.details === 'Portal Login');

// Quote approval creates an audit row (end-to-end via PortalApproval).
const appr = await page.evaluate(async () => {
  const before = window.__audit.length;
  const res = await PortalApproval.approve('HM-AUD-1');
  const row = window.__audit[window.__audit.length - 1];
  return { ok: res.ok, to: res.to, added: window.__audit.length - before, row, statusWritten: window.__upd && window.__upd.status };
});
check('quote approval succeeds (確認中 → 確定)', appr.ok === true && appr.to === '確定');
check('quote approval creates an audit row', appr.added === 1);
check('audit row is a customer quote action describing the approval',
  appr.row && appr.row.target_type === 'quote' && appr.row.target_id === 'HM-AUD-1' &&
  /^customer/.test(appr.row.actor) && /Quote Approved/.test(appr.row.details) && /確定/.test(appr.row.details));
check('booking status still persisted to bookings table (confirmed)', appr.statusWritten === 'confirmed');

// No localStorage dependency — nothing was written to the legacy key.
check('no localStorage dependency (hm_audit_log not written)',
  await page.evaluate(() => localStorage.getItem('hm_audit_log') === null));

// SECURITY: customer context cannot read the system-wide audit log.
const custRead = await page.evaluate(async () => {
  // portal reality: window.Auth is not loaded → not an admin context
  return { hasAuth: !!window.Auth, rows: (await AuditService.query({ limit: 50 })).length };
});
check('portal has no admin Auth context', custRead.hasAuth === false);
check('SECURITY: customer cannot read audit log (query returns empty)', custRead.rows === 0);

// ADMIN read: simulate an admin session → can read all entries.
const adminRead = await page.evaluate(async () => {
  window.Auth = { isLoggedIn: () => true };           // simulate admin session
  const rows = await AuditService.query({ limit: 50 });
  const quote = rows.find(r => r.entity === 'quote' && /Quote Approved/.test(r.detail || ''));
  return { count: rows.length, sawQuote: !!quote };
});
check('admin can read audit entries', adminRead.count >= 2);
check('admin sees the customer quote-approval entry', adminRead.sawQuote === true);

// Backward compatibility: legacy localStorage entries are merged in for admin.
const compat = await page.evaluate(async () => {
  localStorage.setItem('hm_audit_log', JSON.stringify({ version: 1, entries: [
    { id: 'leg1', ts: Date.now() - 99999, actor: 'admin', action: 'save', entity: 'price', entityId: '料金', detail: 'レガシー項目' },
  ]}));
  const rows = await AuditService.query({ limit: 50 });
  return { sawLegacy: rows.some(r => r.id === 'leg1' && r.detail === 'レガシー項目') };
});
check('backward compatibility: legacy localStorage entries still visible', compat.sawLegacy === true);

// Audit survives browser cache clearing (data lives in Supabase, not localStorage).
const survive = await page.evaluate(async () => {
  localStorage.clear();                                 // simulate cache/storage clear
  const rows = await AuditService.query({ limit: 50 });
  return { sawQuote: rows.some(r => r.entity === 'quote' && /Quote Approved/.test(r.detail || '')), legacyGone: localStorage.getItem('hm_audit_log') === null };
});
check('audit survives browser cache clearing (Supabase-backed)', survive.sawQuote === true && survive.legacyGone === true);

// ─────────────────────────────────────────────────────────────
// PART 2 — Admin: AuditLog routes through AuditService (integration)
// ─────────────────────────────────────────────────────────────
await page.goto(base + '/admin.html');
await page.waitForTimeout(800);
check('AuditService loaded on admin', await page.evaluate(() => typeof window.AuditService === 'object'));
check('admin AuditLog present', await page.evaluate(() => typeof window.AuditLog === 'object' && typeof AuditLog.record === 'function'));

const adminIntegration = await page.evaluate(() => {
  let captured = null;
  window.AuditService.record = (e) => { captured = e; return Promise.resolve({ ok: true }); };
  AuditLog.record('update', 'booking', 'HM-INT-1', '予約を更新');
  const cached = AuditLog.getAll();
  return {
    routed:  !!captured,
    mapping: captured && captured.action === 'update' && captured.targetType === 'booking' &&
             captured.targetId === 'HM-INT-1' && captured.details === '予約を更新',
    cacheHasEntry: Array.isArray(cached) && cached.some(e => e.entityId === 'HM-INT-1'),
  };
});
check('admin AuditLog.record routes to AuditService (Supabase)', adminIntegration.routed === true);
check('admin AuditLog.record maps fields to the new schema', adminIntegration.mapping === true);
check('admin AuditLog UI cache reflects the new entry (UI not broken)', adminIntegration.cacheHasEntry === true);

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
