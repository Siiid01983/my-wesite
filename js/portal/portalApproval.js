// js/portal/portalApproval.js → window.PortalApproval
// Customer estimate approval (Phase 5F).
//
// A customer approves the estimate on their OWN booking. Approval transitions the
// booking status 新規 / 確認中 ("Quote Sent") → 確定 ("Quote Approved") through the
// existing BookingService update path — no schema change and no new status value.
// It then records an audit-log entry the admin panel can see.
//
// Preservation guarantees:
//   • Schema     — reuses the existing `confirmed` status value (no DB change).
//   • CRM/admin  — uses BookingService.approveEstimate (a targeted single-column
//                  update), so no other booking field or workflow is disturbed.
//   • Audit      — records the approval to the centralized API-backed
//                  AuditService (Phase 5F Audit Migration), so it appears in the
//                  admin 監査ログ and survives browser cache clearing.

(function () {
  'use strict';

  // Pre-approval states in which an "Approve Estimate" action is offered.
  const APPROVABLE = ['新規', '確認中'];
  const APPROVED   = '確定';

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

  // Record the approval to the centralized API audit trail (AuditService).
  // Customers may only INSERT — this never reads the audit log. Returns a promise
  // resolving to whether the entry was persisted.
  function _writeAudit(bookingRef, fromStatus) {
    if (!window.AuditService) return Promise.resolve(false);
    return AuditService.record({
      actor:      _actor(),
      action:     'update',
      targetType: 'quote',
      targetId:   String(bookingRef || ''),
      details:    'Quote Approved — 見積りをお客様が承認 (' + (fromStatus || '—') + '→' + APPROVED + ')',
    }).then(function (res) { return !!(res && res.ok); })
      .catch(function () { return false; });
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
    await _writeAudit(bookingId, res.from);
    return { ok: true, from: res.from, to: res.to };
  }

  window.PortalApproval = { canApprove, approve, APPROVABLE, APPROVED, _writeAudit };
})();
