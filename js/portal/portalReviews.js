// js/portal/portalReviews.js → window.PortalReviews
// Customer Review System (Phase 5G).
//
// A customer can leave ONE review for their OWN booking, but only AFTER the move
// is completed (booking status 完了). The review is written to the EXISTING
// `reviews` table with source:'customer' and approved:false, so it flows into the
// admin review-approval workflow exactly like the existing public review form —
// no schema change, no change to the public site or admin review code.
//
//   • Leave Review / Rate Service → reviews row (rating 1–5 + review_text).
//   • Upload Photos               → media bucket, booking-scoped:
//                                     customer-documents/<bookingId>/reviews/<file>
//   • Prevent duplicates          → one review per booking_reference.
//   • Connects to workflow        → source:'customer', approved:false (pending).
//   • Audit                       → AuditService (Phase 5F) records the submission.

(function () {
  'use strict';

  const BUCKET     = 'media';                 // reuse existing bucket
  const ROOT       = 'customer-documents';    // shared booking-scoped sub-tree
  const SUB        = 'reviews';               // review photo folder
  const TABLE      = 'reviews';               // existing reviews table
  const SIGNED_TTL = 300;                     // seconds (never public)
  const MAX_BYTES  = 10 * 1024 * 1024;        // 10 MB per photo
  const COMPLETED  = '完了';                  // reviews unlock only at this status

  function _ids(bookingIds) {
    const arr = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
    return [...new Set(arr.filter(v => v != null && v !== '').map(String))];
  }
  function _folder(id) { return `${ROOT}/${id}/${SUB}`; }

  // In-scope = under the booking's own review-photo sub-tree.
  function _inScope(path, ids) {
    if (!path || path.includes('..')) return false;
    return _ids(ids).some(id => path.startsWith(`${ROOT}/${id}/${SUB}/`));
  }

  function _safeName(name) {
    const dot = (name || '').lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'jpg';
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  }

  function _actor() {
    try {
      const s = window.PortalAuth && PortalAuth.getSession && PortalAuth.getSession();
      if (s && (s.email || s.ref)) return 'customer:' + (s.email || s.ref);
    } catch (_) {}
    return 'customer';
  }

  // Reviews are available only after the move is completed.
  function canReview(booking) {
    return !!booking && booking.status === COMPLETED;
  }

  // The customer's existing review for this booking, or null (duplicate guard).
  async function existingReview(bookingIds) {
    const sb = window.SupabaseClient;
    const ids = _ids(bookingIds);
    if (!sb || !ids.length) return null;
    try {
      const { data, error } = await sb.from(TABLE).select('*').in('booking_reference', ids).limit(1);
      if (error || !data || !data.length) return null;
      return data[0];
    } catch (_) { return null; }
  }

  // Upload one review photo to the customer's own booking folder. Path is built
  // from the booking id here, so it can never target another booking.
  async function uploadPhoto(bookingId, file) {
    const sb = window.SupabaseClient;
    const id = bookingId != null ? String(bookingId) : '';
    if (!sb || !sb.storage)              return { ok: false, error: 'storage-unavailable' };
    if (!id)                             return { ok: false, error: 'no-booking' };
    if (!file)                           return { ok: false, error: 'no-file' };
    if (!/^image\//.test(file.type || '')) return { ok: false, error: 'not-an-image' };
    if (file.size > MAX_BYTES)           return { ok: false, error: 'too-large' };
    const path = `${_folder(id)}/${_safeName(file.name)}`;
    try {
      const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (error) return { ok: false, error: error.message };
      return { ok: true, path };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'upload-failed' };
    }
  }

  // Short-lived signed URL for one in-scope review photo. Never public.
  async function signedUrl(bookingIds, path) {
    const sb = window.SupabaseClient;
    if (!sb || !sb.storage || !_inScope(path, bookingIds)) return null;
    try {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
      if (error || !data) return null;
      return data.signedUrl || null;
    } catch (_) { return null; }
  }

  // List the booking's review photos, each with a signed preview URL.
  async function listPhotos(bookingIds) {
    const sb = window.SupabaseClient;
    const ids = _ids(bookingIds);
    const out = [];
    const seen = {};
    if (!sb || !sb.storage || !ids.length) return out;
    for (const id of ids) {
      const folder = _folder(id);
      let data, error;
      try {
        ({ data, error } = await sb.storage.from(BUCKET).list(folder, {
          limit: 50, sortBy: { column: 'created_at', order: 'desc' },
        }));
      } catch (_) { continue; }
      if (error || !data) continue;
      for (const entry of data) {
        if (!entry.name || entry.name === '.emptyFolderPlaceholder') continue;
        if (entry.id === null && entry.metadata == null) continue;
        const path = `${folder}/${entry.name}`;
        if (seen[path]) continue;
        seen[path] = 1;
        out.push({ name: entry.name, path, url: await signedUrl(ids, path) });
      }
    }
    return out;
  }

  function _genId() {
    return 'REV-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  }

  // Submit a review for the booking. Guarded: completed booking, valid rating,
  // non-empty text, and no existing review (duplicate prevention).
  // Returns { ok, review } or { ok:false, error, review? }.
  async function submit(booking, payload) {
    const sb = window.SupabaseClient;
    payload = payload || {};
    if (!booking)            return { ok: false, error: 'no-booking' };
    if (!canReview(booking)) return { ok: false, error: 'not-completed' };

    const rating = parseInt(payload.rating, 10);
    if (!(rating >= 1 && rating <= 5)) return { ok: false, error: 'bad-rating' };
    const text = (payload.text || '').trim();
    if (!text)               return { ok: false, error: 'no-text' };
    if (!sb)                 return { ok: false, error: 'unavailable' };

    const ids = _ids([booking.id, booking._dbId]);
    const dup = await existingReview(ids);
    if (dup) return { ok: false, error: 'duplicate', review: dup };

    // Matches the Adapter's reviewToSb column shape — flows into the existing
    // admin review-approval workflow (pending tab, 顧客 badge).
    const row = {
      reference_id:      _genId(),
      customer_name:     booking.name || '',
      rating:            rating,
      review_text:       text,
      approved:          false,            // pending admin approval
      published:         false,
      source:            'customer',       // admin shows 顧客 badge; lands in pending
      service:           booking.service || null,
      booking_reference: String(booking.id || booking._dbId || ''),
      created_at:        new Date().toISOString(),
    };

    try {
      const { error } = await sb.from(TABLE).insert(row);
      if (error) return { ok: false, error: error.message };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'insert-failed' };
    }

    // Centralized audit trail (Phase 5F) — best-effort, never blocks the review.
    try {
      if (window.AuditService) {
        await AuditService.record({
          actor:      _actor(),
          action:     'add',
          targetType: 'review',
          targetId:   row.booking_reference,
          details:    'Review Submitted — ★' + rating + '（顧客レビュー）',
        });
      }
    } catch (_) {}

    return { ok: true, review: row };
  }

  window.PortalReviews = {
    canReview, existingReview, submit, uploadPhoto, signedUrl, listPhotos,
    BUCKET, ROOT, SUB, TABLE, MAX_BYTES, COMPLETED, _inScope,
  };
})();
