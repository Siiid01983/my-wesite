'use strict';

/* ════════════════════════════════════════════════════════
   CUSTOMER PROFILES — Phase 25A
   Builds unified CRM profiles from Adapter data.

   Status logic:
     VIP       : totalBookings ≥ 3  OR  totalRevenue ≥ ¥200,000
     Returning : totalBookings ≥ 2
     New       : totalBookings < 2

   Sort order: VIP → Returning → New, then lastBookingDate desc.

   Depends on: CRMCore, CRMTags, CRMNotes
   ════════════════════════════════════════════════════════ */

window.CustomerProfiles = (function () {

  var VIP_BOOKINGS = 3;
  var VIP_REVENUE  = 200000;
  var _cache       = null;

  function _status(nBk, rev) {
    if (nBk >= VIP_BOOKINGS || rev >= VIP_REVENUE) return 'vip';
    if (nBk >= 2) return 'returning';
    return 'new';
  }

  function _revenue(bookings) {
    return bookings.reduce(function (s, b) {
      return s + (parseFloat(b.amount || b.price || b.total || 0) || 0);
    }, 0);
  }

  function _sortedDates(bookings) {
    return bookings
      .map(function (b) { return b.move_date || b.date || b.created_at || b.createdAt || ''; })
      .filter(Boolean)
      .sort();
  }

  function _avgRating(reviews) {
    if (!reviews.length) return 0;
    return reviews.reduce(function (s, r) { return s + (parseFloat(r.rating) || 0); }, 0) / reviews.length;
  }

  function _firstAddr(bookings) {
    for (var i = 0; i < bookings.length; i++) {
      var b = bookings[i];
      var a = b.from_address || b.to_address || b.address || b.fromAddr || b.toAddr || '';
      if (a) return a;
    }
    return '';
  }

  function _buildList(map) {
    var ORDER  = { vip: 0, returning: 1, new: 2 };
    var result = [];
    map.forEach(function (entry) {
      var id  = CRMCore.makeId(entry.key);
      var rev = _revenue(entry.bookings);
      var ds  = _sortedDates(entry.bookings);
      result.push({
        id:               id,
        name:             entry.name  || '（名前なし）',
        email:            entry.email || '',
        phone:            entry.phone || '',
        address:          _firstAddr(entry.bookings),
        firstBookingDate: ds[0]             || null,
        lastBookingDate:  ds[ds.length - 1] || null,
        totalBookings:    entry.bookings.length,
        totalRevenue:     rev,
        totalQuotes:      entry.quotes.length,
        totalReviews:     entry.reviews.length,
        avgRating:        _avgRating(entry.reviews),
        status:           _status(entry.bookings.length, rev),
        bookings:         entry.bookings,
        quotes:           entry.quotes,
        reviews:          entry.reviews,
        tags:             window.CRMTags  ? CRMTags.get(id)  : [],
        notes:            window.CRMNotes ? CRMNotes.get(id) : [],
      });
    });
    result.sort(function (a, b) {
      var d = ORDER[a.status] - ORDER[b.status];
      if (d !== 0) return d;
      return (b.lastBookingDate || '') > (a.lastBookingDate || '') ? 1 : -1;
    });
    return result;
  }

  function build() {
    var bookings = (window.Adapter && Adapter.getBookings) ? (Adapter.getBookings() || []) : [];
    var quotes   = (window.Adapter && Adapter.getQuotes)   ? (Adapter.getQuotes()   || []) : [];
    var reviews  = (window.Adapter && Adapter.getReviews)  ? (Adapter.getReviews()  || []) : [];
    _cache = _buildList(CRMCore.buildMap(bookings, quotes, reviews));
    return _cache;
  }

  function getAll()  { return _cache || build(); }
  function get(id)   { return getAll().find(function (p) { return p.id === id; }) || null; }
  function refresh() { _cache = null; }

  /* Auto-invalidate when bookings change */
  if (window.EventBus) {
    ['booking:updated', 'booking:created', 'booking:deleted'].forEach(function (ev) {
      EventBus.on(ev, refresh);
    });
  }

  return { build: build, getAll: getAll, get: get, refresh: refresh };

})();
