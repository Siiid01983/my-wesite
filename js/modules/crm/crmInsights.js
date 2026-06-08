'use strict';

/* ════════════════════════════════════════════════════════
   CRM INSIGHTS — Phase 25
   Per-customer BI: CLV, churn risk, booking frequency,
   preferred service, next booking estimate.
   ════════════════════════════════════════════════════════ */

window.CRMInsights = (function () {

  var CHURN = { high: 365, medium: 180 }; /* inactivity thresholds in days */

  function compute(profile) {
    if (!profile) return null;
    var bk  = profile.bookings || [];
    var rev = profile.totalRevenue || 0;

    /* Revenue metrics */
    var avgValue = bk.length ? (rev / bk.length) : 0;

    /* Booking timestamps for frequency analysis */
    var ts = bk
      .map(function (b) { return new Date(b.move_date || b.date || b.created_at || b.createdAt || 0).getTime(); })
      .filter(Boolean)
      .sort(function (a, b) { return a - b; });

    var freqDays = 0;
    if (ts.length >= 2) {
      var gaps = [];
      for (var i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 86400000);
      freqDays = Math.round(gaps.reduce(function (s, g) { return s + g; }, 0) / gaps.length);
    }

    /* Days inactive since last booking */
    var lastTs = profile.lastBookingDate ? new Date(profile.lastBookingDate).getTime() : 0;
    var daysInactive = lastTs ? Math.round((Date.now() - lastTs) / 86400000) : 999;

    /* Churn risk */
    var churnRisk = daysInactive >= CHURN.high   ? 'high'
                  : daysInactive >= CHURN.medium ? 'medium'
                  : 'low';

    /* Preferred service (most frequently booked) */
    var svcCount = {};
    bk.forEach(function (b) {
      var s = b.service || b.service_type || '—';
      svcCount[s] = (svcCount[s] || 0) + 1;
    });
    var preferred = Object.keys(svcCount).sort(function (a, b) {
      return svcCount[b] - svcCount[a];
    })[0] || null;

    /* Next booking estimate: lastDate + avg frequency */
    var nextEst = null;
    if (lastTs && freqDays > 0) {
      nextEst = new Date(lastTs + freqDays * 86400000).toISOString().slice(0, 10);
    }

    return {
      clv:                  rev,
      avgBookingValue:      avgValue,
      bookingFrequencyDays: freqDays,
      churnRisk:            churnRisk,
      daysInactive:         daysInactive < 999 ? daysInactive : null,
      preferredService:     preferred,
      nextBookingEstimate:  nextEst,
    };
  }

  return { compute: compute };

})();
