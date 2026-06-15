// js/portal/portalApproval.js → window.PortalApproval
// Customer estimate approval (Phase 5F).
//
// A customer can approve the estimate on their OWN booking. Approval transitions
// the booking status 新規 / 確認中 ("Quote Sent") → 確定 ("Quote Approved") through the
// existing BookingService update path — no schema change and no new status value.
// It then records an audit-log entry the admin panel can see.
//
// Preservation guarantees:
//   • Schema     — reuses the existing `confirmed` status value (no DB change).
//   • CRM/admin  — uses BookingService.approveEstimate (a targeted single-column
//                  update), so no other booking field or workflow is disturbed.
//   • Audit      — appends to the shared `hm_audit_log` key in AuditLog's exact
//                  format, so the customer's approval shows in 監査ログ.

(function () {
  'use strict';

  // Pre-approval states in which an "Approve Estimate" action is offered.
  const APPROVABLE = ['新規', '確認中'];
  const APPROVED   = '確定';
  const AUDIT_KEY  = 'hm_audit_log';   // shared with admin AuditLog (same origin)
  const AUDIT_MAX  = 500;              // ring-buffer cap (matches AuditLog)

  function canApprove(booking) {
    return !!booking && APPROVABLE.indexOf(booking.status) !== -1;
  }

  // Identify the acting customer from the portal session (falls back gracefully).
  function _actor() {
    try {
      const s = window.PortalAuth && PortalAuth.getSession && PortalAuth.getSession();
      if (s && (s.email || s.ref)) return 'customer:' + (s.email || s.ref);
    } catch (_) {}
    return 'customer';
  }

  // Append an entry to the shared admin audit log (same shape as AuditLog.record),
  // so a customer approval is visible in the admin 監査ログ view.
  function _writeAudit(bookingRef, fromStatus) {
    try {
      let store = null;
      try { store = JSON.parse(localStorage.getItem(AUDIT_KEY) || 'null'); } catch (_) {}
      if (!store || store.version !== 1 || !Array.isArray(store.entries)) {
        store = { version: 1, entries: [] };
      }
      store.entries.unshift({
        id:       Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        ts:       Date.now(),
        actor:    _actor(),
        action:   'update',
        entity:   'quote',
        entityId: String(bookingRef || ''),
        detail:   '見積りをお客様が承認 (' + (fromStatus || '—') + '→' + APPROVED + ')',
      });
      if (store.entries.length > AUDIT_MAX) store.entries = store.entries.slice(0, AUDIT_MAX);
      localStorage.setItem(AUDIT_KEY, JSON.stringify(store));
      return true;
    } catch (_) { return false; }
  }

  // Approve the estimate on the customer's own booking.
  // Returns { ok, from, to } or { ok:false, error, from? }.
  async function approve(bookingId) {
    if (typeof BookingService === 'undefined' || !BookingService.approveEstimate) {
      return { ok: false, error: 'unavailable' };
    }
    let res;
    try {
      res = await BookingService.approveEstimate(bookingId);
    } catch (err) {
      console.error('[PortalApproval] approve failed:', err);
      return { ok: false, error: (err && err.message) || 'update-failed' };
    }
    if (!res || !res.ok) {
      return { ok: false, error: (res && res.reason) || 'not-approvable', from: res && res.from };
    }
    _writeAudit(bookingId, res.from);
    return { ok: true, from: res.from, to: res.to };
  }

  window.PortalApproval = { canApprove, approve, APPROVABLE, APPROVED, _writeAudit };
})();
