'use strict';

/* ════════════════════════════════════════════════════════
   CRM INSIGHTS — Phase 25E
   Per-customer BI metrics + Customer Score (A–D).

   Customer Score formula (100 pts max):
     Revenue  (40 pts): ≥¥300k→40 / ≥¥150k→30 / ≥¥50k→20 / else→10
     Frequency(30 pts): ≥5 bk→30 / ≥3→20 / ≥2→15 / 1→10
     Recency  (30 pts): ≤60d→30 / ≤180d→20 / ≤365d→10 / else→0

   Grade: A≥80 / B≥60 / C≥40 / D<40

   VIP auto-detection: Revenue>¥300k OR Bookings≥3 OR Grade=A
   ════════════════════════════════════════════════════════ */

window.CRMInsights = (function () {

  var CHURN = { high: 365, medium: 180 };

  /* ── Score engine ── */

  function _pts(nBk, rev, lastDate) {
    var revPts  = rev  >= 300000 ? 40 : rev  >= 150000 ? 30 : rev  >= 50000 ? 20 : 10;
    var freqPts = nBk  >= 5      ? 30 : nBk  >= 3      ? 20 : nBk  >= 2     ? 15 : 10;
    var days    = lastDate ? Math.round((Date.now() - new Date(lastDate).getTime()) / 86400000) : 999;
    var recPts  = days <= 60 ? 30 : days <= 180 ? 20 : days <= 365 ? 10 : 0;
    return { revPts: revPts, freqPts: freqPts, recPts: recPts, total: revPts + freqPts + recPts };
  }

  /* Returns { total, grade, revPts, freqPts, recPts } */
  function score(profile) {
    if (!profile) return { total: 10, grade: 'D', revPts: 10, freqPts: 10, recPts: 0 };
    var s = _pts(profile.totalBookings || 0, profile.totalRevenue || 0, profile.lastBookingDate);
    s.grade = s.total >= 80 ? 'A' : s.total >= 60 ? 'B' : s.total >= 40 ? 'C' : 'D';
    return s;
  }

  /* ── Full compute ── */

  function compute(profile) {
    if (!profile) return null;
    var bk  = profile.bookings || [];
    var rev = profile.totalRevenue || 0;
    var nBk = bk.length;

    /* Revenue */
    var aov = nBk ? (rev / nBk) : 0;       /* Average Order Value */
    var ltv = rev;                          /* Lifetime Value = cumulative revenue */

    /* Booking timestamps for frequency */
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

    /* Recency */
    var lastTs    = profile.lastBookingDate ? new Date(profile.lastBookingDate).getTime() : 0;
    var daysInact = lastTs ? Math.round((Date.now() - lastTs) / 86400000) : 999;

    /* Churn risk */
    var churnRisk = daysInact >= CHURN.high ? 'high' : daysInact >= CHURN.medium ? 'medium' : 'low';

    /* Preferred service */
    var svcCnt = {};
    bk.forEach(function (b) {
      var s = b.service || '—';
      svcCnt[s] = (svcCnt[s] || 0) + 1;
    });
    var preferred = Object.keys(svcCnt).sort(function (a, b) { return svcCnt[b] - svcCnt[a]; })[0] || null;

    /* Next booking estimate */
    var nextEst = null;
    if (lastTs && freqDays > 0) nextEst = new Date(lastTs + freqDays * 86400000).toISOString().slice(0, 10);

    /* Customer Score */
    var sc = score(profile);

    return {
      totalRevenue:         rev,
      aov:                  aov,
      ltv:                  ltv,
      bookingFrequencyDays: freqDays,
      lastActivity:         daysInact < 999 ? daysInact : null,
      churnRisk:            churnRisk,
      preferredService:     preferred,
      nextBookingEstimate:  nextEst,
      score:                sc,
      /* legacy aliases kept for backward compat */
      clv:                  rev,
      avgBookingValue:      aov,
      daysInactive:         daysInact < 999 ? daysInact : null,
    };
  }

  return { compute: compute, score: score };

})();
