'use strict';
/**
 * PortalSelfService + PortalDocs attachment unit tests — Phase 6C
 *
 * Self-contained: loads the portal modules onto about:blank via addScriptTag
 * (no dev server required) and stubs BookingService / AuditService / Supabase
 * storage so every case is deterministic and offline.
 *
 * Run: node --test tests/portalSelfService.test.js
 *
 * Coverage:
 *   • reschedule          — happy path, past/invalid date, terminal status, audit
 *   • updateContact       — phone/name, email immutability (RLS WITH CHECK), validation
 *   • requestCancellation — note marker (no status change), duplicate, terminal
 *   • progressSteps       — status → step mapping, cancelled
 *   • predicates          — canReschedule / canCancel / canEditContact / hasCancellationRequest
 *   • PortalDocs          — attachment scope guard (no cross-booking writes/deletes)
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('path');

const SS_PATH   = path.resolve(__dirname, '..', 'js', 'portal', 'portalSelfService.js');
const DOCS_PATH = path.resolve(__dirname, '..', 'js', 'portal', 'portalDocs.js');

// A future date (always valid for reschedule) computed in Node.
function futureDate() {
  const d = new Date(Date.now() + 7 * 86400000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const FUTURE = futureDate();

let browser, page;

before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ path: SS_PATH });
  await page.addScriptTag({ path: DOCS_PATH });

  // Install fresh stubs + a current booking for one scenario.
  await page.evaluate(() => {
    window.__installStubs = function (opts) {
      opts = opts || {};
      window.__lastPatch = null;
      window.__lastAudit = null;
      window.BookingService = {
        updateBooking: async function (id, patch) {
          window.__lastPatch = { id: id, patch: patch };
          if (opts.updateReturnsNull) return null;
          if (opts.updateThrows) throw new Error('boom');
          return Object.assign({}, window.__current, patch, { updatedAt: 'T0' });
        },
      };
      window.AuditService = {
        record: async function (e) { window.__lastAudit = e; return { ok: true }; },
      };
      window.PortalAuth = { getSession: function () { return { email: 'a@example.com' }; } };
    };
  });
});

after(async () => { await browser.close(); });

// Run a PortalSelfService action against a fresh stubbed environment.
async function act(booking, action, args, opts) {
  return page.evaluate(async ({ booking, action, args, opts }) => {
    window.__current = booking;
    window.__installStubs(opts);
    const res = await window.PortalSelfService[action](booking, args);
    return { res, patch: window.__lastPatch, audit: window.__lastAudit };
  }, { booking, action, args: args || {}, opts: opts || {} });
}

function booking(over) {
  return Object.assign({
    id: 'HM-20260617-AAAA', _dbId: 1, status: '確認中',
    name: '山田太郎', email: 'a@example.com', phone: '090-1111-2222',
    date: '2020-01-01', time: '', notes: '',
  }, over || {});
}

// ── reschedule ──────────────────────────────────────────────────────────────
describe('reschedule()', () => {
  it('valid date + time → ok, patches date/time, records audit', async () => {
    const { res, patch, audit } = await act(booking(), 'reschedule', { date: FUTURE, time: '午前中' });
    assert.equal(res.ok, true);
    assert.equal(patch.patch.date, FUTURE);
    assert.equal(patch.patch.time, '午前中');
    assert.equal(patch.id, 'HM-20260617-AAAA');
    assert.ok(audit && audit.targetType === 'booking');
    assert.match(audit.details, /Reschedule/);
  });

  it('past date → past-date error, no write', async () => {
    const { res, patch } = await act(booking(), 'reschedule', { date: '2000-01-01' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'past-date');
    assert.equal(patch, null);
  });

  it('malformed date → bad-date error', async () => {
    const { res } = await act(booking(), 'reschedule', { date: '17/06/2026' });
    assert.equal(res.error, 'bad-date');
  });

  it('completed booking → not-reschedulable', async () => {
    const { res } = await act(booking({ status: '完了' }), 'reschedule', { date: FUTURE });
    assert.equal(res.error, 'not-reschedulable');
  });

  it('time omitted → patch carries date only', async () => {
    const { res, patch } = await act(booking(), 'reschedule', { date: FUTURE });
    assert.equal(res.ok, true);
    assert.equal(patch.patch.date, FUTURE);
    assert.equal('time' in patch.patch, false);
  });

  it('updateBooking returns null → not-found', async () => {
    const { res } = await act(booking(), 'reschedule', { date: FUTURE }, { updateReturnsNull: true });
    assert.equal(res.error, 'not-found');
  });
});

// ── updateContact ─────────────────────────────────────────────────────────────
describe('updateContact()', () => {
  it('phone + name → ok, patches both, NEVER patches email (RLS WITH CHECK)', async () => {
    const { res, patch, audit } = await act(booking(), 'updateContact',
      { name: '田中花子', phone: '080-3333-4444', email: 'attacker@evil.com' });
    assert.equal(res.ok, true);
    assert.equal(patch.patch.name, '田中花子');
    assert.equal(patch.patch.phone, '080-3333-4444');
    assert.equal('email' in patch.patch, false);     // email is the immutable auth identity
    assert.equal('id' in patch.patch, false);
    assert.ok(audit && /Contact updated/.test(audit.details));
  });

  it('invalid phone → bad-phone, no write', async () => {
    const { res, patch } = await act(booking(), 'updateContact', { phone: 'abc' });
    assert.equal(res.error, 'bad-phone');
    assert.equal(patch, null);
  });

  it('empty name → bad-name', async () => {
    const { res } = await act(booking(), 'updateContact', { name: '   ' });
    assert.equal(res.error, 'bad-name');
  });

  it('no fields → no-change', async () => {
    const { res } = await act(booking(), 'updateContact', {});
    assert.equal(res.error, 'no-change');
  });

  it('terminal booking → locked', async () => {
    const { res } = await act(booking({ status: 'キャンセル' }), 'updateContact', { phone: '090-0000-0000' });
    assert.equal(res.error, 'locked');
  });
});

// ── requestCancellation ───────────────────────────────────────────────────────
describe('requestCancellation()', () => {
  it('records a note marker WITHOUT changing status; writes audit', async () => {
    const { res, patch, audit } = await act(booking(), 'requestCancellation', { reason: '日程が合わない' });
    assert.equal(res.ok, true);
    assert.ok(patch.patch.notes.includes('【キャンセル希望】'));
    assert.ok(patch.patch.notes.includes('日程が合わない'));
    assert.equal('status' in patch.patch, false);     // admin owns the real status transition
    assert.ok(audit && /Cancellation requested/.test(audit.details));
  });

  it('preserves existing user notes (appends, not replaces)', async () => {
    const { patch } = await act(booking({ notes: '既存のメモ' }), 'requestCancellation', { reason: 'x' });
    assert.ok(patch.patch.notes.startsWith('既存のメモ'));
    assert.ok(patch.patch.notes.includes('【キャンセル希望】'));
  });

  it('already-requested (marker present) → blocked, no double write', async () => {
    const b = booking({ notes: '【キャンセル希望】前回 (2026-06-17T00:00:00Z)' });
    const { res, patch } = await act(b, 'requestCancellation', { reason: 'again' });
    assert.equal(res.error, 'already-requested');
    assert.equal(patch, null);
  });

  it('terminal booking → not-cancellable', async () => {
    const { res } = await act(booking({ status: '完了' }), 'requestCancellation', {});
    assert.equal(res.error, 'not-cancellable');
  });
});

// ── progressSteps + predicates (pure, sync) ──────────────────────────────────
describe('progressSteps() & predicates', () => {
  async function steps(status) {
    return page.evaluate(s => window.PortalSelfService.progressSteps({ status: s }), status);
  }

  it('新規 → current at step 0 (受付)', async () => {
    const p = await steps('新規');
    assert.equal(p.cancelled, false);
    assert.equal(p.steps[0].current, true);
    assert.equal(p.steps[0].done, false);
  });

  it('確定 → steps 0-1 done, step 2 current', async () => {
    const p = await steps('確定');
    assert.equal(p.steps[0].done, true);
    assert.equal(p.steps[1].done, true);
    assert.equal(p.steps[2].current, true);
  });

  it('完了 → final step current, earlier done', async () => {
    const p = await steps('完了');
    assert.equal(p.steps[3].current, true);
    assert.equal(p.steps[0].done && p.steps[1].done && p.steps[2].done, true);
  });

  it('キャンセル → cancelled flag, no current step', async () => {
    const p = await steps('キャンセル');
    assert.equal(p.cancelled, true);
    assert.equal(p.steps.some(s => s.current), false);
  });

  it('predicates gate by status / marker', async () => {
    const r = await page.evaluate(() => {
      const SS = window.PortalSelfService;
      return {
        reschedConfirmed: SS.canReschedule({ status: '確定' }),
        reschedDone:      SS.canReschedule({ status: '完了' }),
        cancelOpen:       SS.canCancel({ status: '確認中', notes: '' }),
        cancelDup:        SS.canCancel({ status: '確認中', notes: '【キャンセル希望】x' }),
        editActive:       SS.canEditContact({ status: '新規' }),
        editTerminal:     SS.canEditContact({ status: 'キャンセル' }),
        hasReq:           SS.hasCancellationRequest({ notes: 'a\n【キャンセル希望】b' }),
        noReq:            SS.hasCancellationRequest({ notes: 'plain' }),
      };
    });
    assert.equal(r.reschedConfirmed, true);
    assert.equal(r.reschedDone, false);
    assert.equal(r.cancelOpen, true);
    assert.equal(r.cancelDup, false);
    assert.equal(r.editActive, true);
    assert.equal(r.editTerminal, false);
    assert.equal(r.hasReq, true);
    assert.equal(r.noReq, false);
  });
});

// ── PortalDocs attachment scope guard ────────────────────────────────────────
describe('PortalDocs attachment isolation', () => {
  beforeEach(async () => {
    await page.evaluate(() => {
      window.__removed = null;
      window.SupabaseClient = {
        storage: {
          from: () => ({
            upload: async (p) => ({ data: { path: p }, error: null }),
            remove: async (paths) => { window.__removed = paths; return { data: paths, error: null }; },
          }),
        },
      };
    });
  });

  it('_inAttachScope allows own attachments folder, blocks others + traversal', async () => {
    const r = await page.evaluate(() => {
      const D = window.PortalDocs;
      return {
        own:   D._inAttachScope('customer-documents/HM-1/attachments/x.pdf', ['HM-1']),
        other: D._inAttachScope('customer-documents/HM-2/attachments/x.pdf', ['HM-1']),
        estim: D._inAttachScope('customer-documents/HM-1/estimates/x.pdf', ['HM-1']),
        trav:  D._inAttachScope('customer-documents/HM-1/attachments/../../HM-2/x', ['HM-1']),
      };
    });
    assert.equal(r.own, true);
    assert.equal(r.other, false);   // cannot reach another booking
    assert.equal(r.estim, false);   // cannot write into admin-issued sections
    assert.equal(r.trav, false);    // path traversal blocked
  });

  it('removeAttachment refuses an out-of-scope path (no storage call)', async () => {
    const r = await page.evaluate(async () => {
      const res = await window.PortalDocs.removeAttachment(['HM-1'], 'customer-documents/HM-2/attachments/x.pdf');
      return { res, removed: window.__removed };
    });
    assert.equal(r.res.ok, false);
    assert.equal(r.res.error, 'out-of-scope');
    assert.equal(r.removed, null);  // storage.remove was never invoked
  });

  it('removeAttachment deletes an in-scope path', async () => {
    const r = await page.evaluate(async () => {
      const res = await window.PortalDocs.removeAttachment(['HM-1'], 'customer-documents/HM-1/attachments/x.pdf');
      return { res, removed: window.__removed };
    });
    assert.equal(r.res.ok, true);
    assert.deepEqual(r.removed, ['customer-documents/HM-1/attachments/x.pdf']);
  });

  it('uploadAttachment with no booking id → no-booking', async () => {
    const r = await page.evaluate(async () => window.PortalDocs.uploadAttachment('', { size: 10, name: 'a.pdf' }));
    assert.equal(r.ok, false);
    assert.equal(r.error, 'no-booking');
  });

  it('uploadAttachment over size limit → too-large', async () => {
    const r = await page.evaluate(async () =>
      window.PortalDocs.uploadAttachment('HM-1', { size: 999 * 1024 * 1024, name: 'big.pdf' }));
    assert.equal(r.error, 'too-large');
  });
});
