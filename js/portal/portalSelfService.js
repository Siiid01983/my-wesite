// js/portal/portalSelfService.js → window.PortalSelfService
// Customer Self-Service actions (Phase 6C).
//
// Lets an authenticated customer act on their OWN booking:
//   • reschedule          — change move date / time
//   • requestCancellation — flag a cancellation request (admin performs the
//                           actual cancel; the DB status is NOT changed here)
//   • updateContact       — change phone / name (email is the auth identity and
//                           is intentionally immutable)
//   • progressSteps       — derive a read-only step tracker from the status
//
// Preservation guarantees (Phase 6C rules):
//   • Schema  — no new column/table/status value. All writes reuse the existing
//               BookingService.updateBooking path (which packs extras into notes).
//   • RLS 6B  — every write is an UPDATE on the customer's OWN row. The bookings
//               authenticated UPDATE policy is `customer_email = auth.email()`
//               (USING + WITH CHECK), so this module NEVER changes customer_email
//               (that would violate WITH CHECK and is the user's own identity).
//   • Auth 6A — actor is resolved from the verified PortalAuth session.
//   • Admin   — cancellation is a *request* (note marker + audit entry); the
//               admin keeps full control of the real status transition.
//   • Audit   — every action is recorded to the API AuditService (customers
//               may INSERT only — see 6B audit_auth_insert), so it appears in the
//               admin 監査ログ.

(function () {
  'use strict';

  // Local Japanese status labels (match BookingService._BK_TO_LOCAL).
  var RESCHEDULABLE = ['新規', '確認中', '確定'];
  var CANCELLABLE   = ['新規', '確認中', '確定'];
  var TERMINAL      = ['完了', 'キャンセル'];

  // Marker appended to a booking's user notes to flag a customer cancellation
  // request WITHOUT changing the DB status (admin performs the actual cancel).
  var CANCEL_MARK = '【キャンセル希望】';

  var STEPS = [
    { id: 'received',  label: '受付' },
    { id: 'reviewing', label: '確認中' },
    { id: 'confirmed', label: '確定' },
    { id: 'completed', label: '完了' },
  ];

  function _pad(n) { return String(n).padStart(2, '0'); }
  function _today() {
    var d = new Date();
    return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate());
  }
  function _isIsoDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

  function _svc() {
    if (typeof BookingService !== 'undefined' && BookingService) return BookingService;
    return window.BookingService || null;
  }

  // Acting customer from the verified portal session (graceful fallback).
  function _actor() {
    try {
      var s = window.PortalAuth && PortalAuth.getSession && PortalAuth.getSession();
      if (s && (s.email || s.ref)) return 'customer:' + (s.email || s.ref);
    } catch (_) {}
    return 'customer';
  }

  // Append an audit entry (INSERT-only; never reads the trail). Resolves to bool.
  function _audit(targetId, details) {
    if (!window.AuditService) return Promise.resolve(false);
    return AuditService.record({
      actor:      _actor(),
      action:     'update',
      targetType: 'booking',
      targetId:   String(targetId || ''),
      details:    details,
    }).then(function (r) { return !!(r && r.ok); }).catch(function () { return false; });
  }

  // ── Eligibility predicates (drive UI enablement) ────────────────────────────
  function canReschedule(b) { return !!b && RESCHEDULABLE.indexOf(b.status) !== -1; }
  function canEditContact(b) { return !!b && TERMINAL.indexOf(b.status) === -1; }
  function hasCancellationRequest(b) {
    return !!b && typeof b.notes === 'string' && b.notes.indexOf(CANCEL_MARK) !== -1;
  }
  function canCancel(b) {
    return !!b && CANCELLABLE.indexOf(b.status) !== -1 && !hasCancellationRequest(b);
  }

  // ── Reschedule: change move date / time on the customer's OWN booking ────────
  // opts: { date: 'YYYY-MM-DD' (required), time?: string }
  // Returns { ok, booking } or { ok:false, error }.
  async function reschedule(booking, opts) {
    opts = opts || {};
    var svc = _svc();
    if (!booking || !svc || !svc.updateBooking) return { ok: false, error: 'unavailable' };
    if (!canReschedule(booking))                return { ok: false, error: 'not-reschedulable' };

    var date = (opts.date || '').toString().trim();
    var time = (opts.time || '').toString().trim();
    if (!_isIsoDate(date)) return { ok: false, error: 'bad-date' };
    if (date < _today())   return { ok: false, error: 'past-date' };

    var patch = { date: date };
    if (time) patch.time = time;

    var updated;
    try {
      updated = await svc.updateBooking(booking.id, patch);
    } catch (err) {
      console.error('[PortalSelfService] reschedule failed:', err);
      return { ok: false, error: (err && err.message) || 'update-failed' };
    }
    if (!updated) return { ok: false, error: 'not-found' };

    await _audit(booking.id,
      'Reschedule — お客様が予約日時を変更 (→' + date + (time ? ' ' + time : '') + ')');
    return { ok: true, booking: updated };
  }

  // ── Update contact details (phone / name). Email is the auth identity and is
  //    intentionally NOT updatable (changing it would violate the RLS WITH CHECK
  //    and is the credential the customer authenticated with). ──────────────────
  // fields: { phone?, name? }. Returns { ok, booking } or { ok:false, error }.
  async function updateContact(booking, fields) {
    fields = fields || {};
    var svc = _svc();
    if (!booking || !svc || !svc.updateBooking) return { ok: false, error: 'unavailable' };
    if (!canEditContact(booking))               return { ok: false, error: 'locked' };

    var patch = {};
    if (fields.phone != null && String(fields.phone).trim() !== '') {
      var phone = String(fields.phone).trim();
      if (!/^[0-9+\-() 　]{6,20}$/.test(phone)) return { ok: false, error: 'bad-phone' };
      patch.phone = phone;
    }
    if (fields.name != null) {
      var name = String(fields.name).trim();
      if (!name) return { ok: false, error: 'bad-name' };
      patch.name = name;
    }
    // Defence-in-depth: identity / immutable fields can never pass through.
    delete patch.email; delete patch.id; delete patch.createdAt;
    if (!Object.keys(patch).length) return { ok: false, error: 'no-change' };

    var updated;
    try {
      updated = await svc.updateBooking(booking.id, patch);
    } catch (err) {
      console.error('[PortalSelfService] updateContact failed:', err);
      return { ok: false, error: (err && err.message) || 'update-failed' };
    }
    if (!updated) return { ok: false, error: 'not-found' };

    await _audit(booking.id, 'Contact updated — お客様が連絡先を更新');
    return { ok: true, booking: updated };
  }

  // ── Request cancellation: records the request (notes marker + audit entry)
  //    WITHOUT changing the DB status. The admin reviews it and performs the
  //    actual cancellation, preserving the existing admin workflow. ─────────────
  // opts: { reason?: string }. Returns { ok, booking } or { ok:false, error }.
  async function requestCancellation(booking, opts) {
    opts = opts || {};
    var svc = _svc();
    if (!booking || !svc || !svc.updateBooking) return { ok: false, error: 'unavailable' };
    if (TERMINAL.indexOf(booking.status) !== -1) return { ok: false, error: 'not-cancellable' };
    if (hasCancellationRequest(booking))         return { ok: false, error: 'already-requested' };

    var reason  = (opts.reason || '').toString().trim().slice(0, 500);
    var marker  = CANCEL_MARK + (reason || '理由の記載なし') + ' (' + new Date().toISOString() + ')';
    var base    = (booking.notes || '').toString().trim();
    var newNotes = base ? (base + '\n' + marker) : marker;

    var updated;
    try {
      updated = await svc.updateBooking(booking.id, { notes: newNotes });
    } catch (err) {
      console.error('[PortalSelfService] requestCancellation failed:', err);
      return { ok: false, error: (err && err.message) || 'update-failed' };
    }
    if (!updated) return { ok: false, error: 'not-found' };

    await _audit(booking.id,
      'Cancellation requested — お客様がキャンセルを申請' + (reason ? ' (' + reason + ')' : ''));
    return { ok: true, booking: updated };
  }

  // ── Progress tracker (read-only). Maps the status to ordered steps. ──────────
  // Returns { cancelled, steps:[{id,label,done,current}] }.
  function progressSteps(booking) {
    var st = booking && booking.status;
    if (st === 'キャンセル') {
      return {
        cancelled: true,
        steps: STEPS.map(function (s) { return { id: s.id, label: s.label, done: false, current: false }; }),
      };
    }
    var curIdx = st === '完了' ? 3 : st === '確定' ? 2 : st === '確認中' ? 1 : 0;
    return {
      cancelled: false,
      steps: STEPS.map(function (s, i) {
        return { id: s.id, label: s.label, done: i < curIdx, current: i === curIdx };
      }),
    };
  }

  window.PortalSelfService = {
    canReschedule: canReschedule,
    canEditContact: canEditContact,
    canCancel: canCancel,
    hasCancellationRequest: hasCancellationRequest,
    reschedule: reschedule,
    updateContact: updateContact,
    requestCancellation: requestCancellation,
    progressSteps: progressSteps,
    CANCEL_MARK: CANCEL_MARK,
    RESCHEDULABLE: RESCHEDULABLE,
    CANCELLABLE: CANCELLABLE,
    TERMINAL: TERMINAL,
    STEPS: STEPS,
  };
})();
