'use strict';

/* ════════════════════════════════════════════════════════
   CUSTOMER PROFILES — Phase 25A
   Builds unified CRM profiles from Adapter data.

   Status logic (Phase 25E):
     VIP       : totalRevenue > ¥300,000  OR  totalBookings ≥ 3  OR  Score = A
     Returning : totalBookings ≥ 2
     New       : totalBookings < 2

   Sort order: VIP → Returning → New, then lastBookingDate desc.

   Depends on: CRMCore, CRMTags, CRMNotes
   ════════════════════════════════════════════════════════ */

window.CustomerProfiles = (function () {

  var VIP_BOOKINGS = 3;
  var VIP_REVENUE  = 300000;
  var _cache       = null;

  /* Grade computation (mirrors CRMInsights.score — duplicated for load-order independence) */
  function _grade(nBk, rev, lastDate) {
    var revPts  = rev  >= 300000 ? 40 : rev  >= 150000 ? 30 : rev  >= 50000 ? 20 : 10;
    var freqPts = nBk  >= 5      ? 30 : nBk  >= 3      ? 20 : nBk  >= 2     ? 15 : 10;
    var days    = lastDate ? Math.round((Date.now() - new Date(lastDate).getTime()) / 86400000) : 999;
    var recPts  = days <= 60 ? 30 : days <= 180 ? 20 : days <= 365 ? 10 : 0;
    var total   = revPts + freqPts + recPts;
    return total >= 80 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : 'D';
  }

  function _status(nBk, rev, grade) {
    if (rev >= VIP_REVENUE || nBk >= VIP_BOOKINGS || grade === 'A') return 'vip';
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
      var id   = CRMCore.makeId(entry.key);
      var rev  = _revenue(entry.bookings);
      var ds   = _sortedDates(entry.bookings);
      var nBk  = entry.bookings.length;
      var last = ds[ds.length - 1] || null;
      var gr   = _grade(nBk, rev, last);
      result.push({
        id:               id,
        name:             entry.name  || '（名前なし）',
        email:            entry.email || '',
        phone:            entry.phone || '',
        address:          _firstAddr(entry.bookings),
        firstBookingDate: ds[0]  || null,
        lastBookingDate:  last,
        totalBookings:    nBk,
        totalRevenue:     rev,
        totalQuotes:      entry.quotes.length,
        totalReviews:     entry.reviews.length,
        avgRating:        _avgRating(entry.reviews),
        score:            gr,
        status:           _status(nBk, rev, gr),
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
