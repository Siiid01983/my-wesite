'use strict';

/* ════════════════════════════════════════════════════════
   CRM CORE — Phase 25
   Customer identity matching across bookings, quotes, reviews.

   Matching priority:
     1. email  — stable, cross-session
     2. phone  — fallback (maps to a known email key)
     3. name   — last resort (may merge different people with same name)

   buildMap() → Map<identityKey, { key, name, email, phone, bookings[], quotes[], reviews[] }>
   makeId(key) → stable customer ID string ('cust_xxxxxxxx')
   ════════════════════════════════════════════════════════ */

window.CRMCore = (function () {

  /* Stable 32-bit hash → 'cust_xxxxxxxx' */
  function makeId(key) {
    var s = (key || '').toLowerCase().trim();
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return 'cust_' + (h >>> 0).toString(16).padStart(8, '0');
  }

  function _n(s) { return (s || '').toLowerCase().trim(); }

  function buildMap(bookings, quotes, reviews) {
    var byKey   = new Map(); /* identityKey → entry */
    var byPhone = new Map(); /* normPhone → identityKey */
    var byName  = new Map(); /* normName  → identityKey */

    function _resolveKey(email, phone, name) {
      var ne = _n(email), np = _n(phone), nn = _n(name);
      if (ne) return ne;
      if (np && byPhone.has(np)) return byPhone.get(np);
      if (nn && byName.has(nn))  return byName.get(nn);
      return np ? ('phone:' + np) : nn ? ('name:' + nn) : ('anon:' + Math.random().toString(36).slice(2));
    }

    function _ensure(k, name, email, phone) {
      if (!byKey.has(k)) byKey.set(k, { key: k, name: '', email: '', phone: '', bookings: [], quotes: [], reviews: [] });
      var e = byKey.get(k);
      if (!e.name  && name)  e.name  = name;
      if (!e.email && email) e.email = email;
      if (!e.phone && phone) e.phone = phone;
      return e;
    }

    function _index(k, phone, name) {
      var np = _n(phone), nn = _n(name);
      if (np && !byPhone.has(np)) byPhone.set(np, k);
      if (nn && !byName.has(nn))  byName.set(nn, k);
    }

    function _process(arr, getEmail, getPhone, getName, push) {
      (arr || []).forEach(function (r) {
        var k = _resolveKey(getEmail(r), getPhone(r), getName(r));
        var e = _ensure(k, getName(r), getEmail(r), getPhone(r));
        _index(k, getPhone(r), getName(r));
        push(e, r);
      });
    }

    _process(bookings,
      function (b) { return b.email; },
      function (b) { return b.phone; },
      function (b) { return b.customer_name || b.name; },
      function (e, b) { e.bookings.push(b); });

    _process(quotes,
      function (q) { return q.email; },
      function (q) { return q.phone; },
      function (q) { return q.name || q.customer_name; },
      function (e, q) { e.quotes.push(q); });

    _process(reviews,
      function (r) { return r.email; },
      function (r) { return r.phone; },
      function (r) { return r.customer_name || r.name; },
      function (e, r) { e.reviews.push(r); });

    return byKey;
  }

  return { makeId: makeId, buildMap: buildMap };

})();
