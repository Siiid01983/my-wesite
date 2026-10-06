/* ════════════════════════════════════════════════════════════════════════════
   repeatCustomer.js — returning-customer (リピート) detection for Ops bookings.

   PURE / additive. Given the list of bookings the Ops app already loaded
   (Api.listBookings → Ops.normalizeBooking shape), it annotates each booking
   in-place with:
     • isRepeat     — the SAME customer has ≥1 EARLIER real booking (this one excluded)
     • prevWorkDate — that immediately-previous real booking's work date ('' if none)

   Customer identity REUSES the admin directory's precedence
   (ops/js/customers.js → buildCustomers): email (lowercased) → phone — but DROPS
   the name fallback on purpose. Two different people who share a name must never
   be judged the same customer, so name alone is never an identifier.

   No DB schema, no new column, no network, no booking/slot/pricing logic. Reads
   only fields already present on a normalized booking (email, phone, date,
   createdAt, statusRaw, dbId).
   ════════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Ops = (global.Ops = global.Ops || {});

  // Field separator for the chronological sort key — a NUL char (built at
  // runtime so the source stays plain text), which never appears in a date,
  // timestamp or id, so adjacent fields can never run together ambiguously.
  var SEP = String.fromCharCode(0);

  // Stable customer identity for repeat detection. email → phone, NEVER name.
  // Phone is reduced to digits so formatting differences (090-1234-5678 vs
  // 09012345678) don't split one customer; a <7-digit remainder is treated as
  // junk and yields no identity.
  function identity(b) {
    if (!b) return '';
    var email = String(b.email || '').trim().toLowerCase();
    if (email) return 'email:' + email;
    var digits = String(b.phone || '').replace(/[^0-9]/g, '');
    if (digits.length >= 7) return 'tel:' + digits;
    return '';   // no email and no usable phone → cannot be judged a repeat
  }

  // A booking that represents real (completed / still-live) work. Cancelled and
  // rejected bookings never produced an actual job, so they are NOT a "previous
  // work" record — matching 前回作業日 ("previous WORK date"). statusRaw is the
  // canonical English status normalized by Ops.normalizeBooking.
  function isRealWork(b) {
    var s = (b && b.statusRaw) || '';
    return s !== 'cancelled' && s !== 'rejected';
  }

  // Chronological sort key: work date, then received-at, then id (stable). All
  // three are lexicographically sortable ('YYYY-MM-DD' / 'YYYY-MM-DD HH:MM:SS'),
  // so plain string comparison is also chronological — no Date parsing needed.
  function chrono(b) {
    return (b.date || '') + SEP + (b.createdAt || '') + SEP + String(b.dbId == null ? '' : b.dbId);
  }

  // Annotate every booking in-place. The CURRENT booking is never its own
  // previous: prevWorkDate is advanced only AFTER a booking is processed, so it
  // always reflects a STRICTLY-earlier entry in that customer's own timeline.
  function annotate(bookings) {
    if (!Array.isArray(bookings)) return bookings;
    var groups = {};
    bookings.forEach(function (b) {
      if (!b) return;
      b.isRepeat = false;
      b.prevWorkDate = '';
      var key = identity(b);
      if (!key) return;                               // unidentifiable → stays non-repeat
      (groups[key] || (groups[key] = [])).push(b);
    });
    Object.keys(groups).forEach(function (key) {
      var arr = groups[key];
      arr.sort(function (a, b) { var ka = chrono(a), kb = chrono(b); return ka < kb ? -1 : ka > kb ? 1 : 0; });
      var lastRealDate = '';
      arr.forEach(function (b) {
        if (lastRealDate) { b.isRepeat = true; b.prevWorkDate = lastRealDate; }
        if (isRealWork(b) && b.date) lastRealDate = b.date;   // advance AFTER (never self-reference)
      });
    });
    return bookings;
  }

  // Display helper: 'YYYY-MM-DD' → '2023年12月14日' (no timezone math; pure Y/M/D).
  function fmtWorkDate(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s || ''));
    return m ? (Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日') : String(s || '');
  }

  Ops.Repeat = { annotate: annotate, identity: identity, isRealWork: isRealWork, fmtWorkDate: fmtWorkDate };

  if (typeof module !== 'undefined' && module.exports) module.exports = Ops.Repeat;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
