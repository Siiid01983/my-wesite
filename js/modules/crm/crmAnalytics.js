'use strict';

/* ════════════════════════════════════════════════════════
   CRM ANALYTICS — Phase 25 Integration
   Exposes CRM-derived metrics to the analytics layer.

   window.CRMAnalytics.compute() → {
     totalCustomers, vipCount, repeatCount,
     repeatRate, avgRevenue, topCustomers[]
   }

   10-minute TTL cache. Auto-invalidates on booking events.
   ════════════════════════════════════════════════════════ */

window.CRMAnalytics = (function () {

  var _cache   = null;
  var _cacheTs = 0;
  var TTL      = 10 * 60 * 1000;

  function compute() {
    var now = Date.now();
    if (_cache && (now - _cacheTs) < TTL) return _cache;

    var profiles = window.CustomerProfiles ? CustomerProfiles.getAll() : [];

    var vipCount    = 0;
    var repeatCount = 0;
    var totalRev    = 0;

    profiles.forEach(function (p) {
      if (p.status === 'vip') vipCount++;
      if (p.status === 'returning' || p.status === 'vip') repeatCount++;
      totalRev += p.totalRevenue || 0;
    });

    var total      = profiles.length;
    var repeatRate = total > 0 ? Math.round(repeatCount / total * 100) : 0;
    var avgRevenue = total > 0 ? Math.round(totalRev / total) : 0;

    var topCustomers = profiles.slice()
      .sort(function (a, b) { return (b.totalRevenue || 0) - (a.totalRevenue || 0); })
      .slice(0, 10)
      .map(function (p) {
        return {
          id:            p.id,
          name:          p.name,
          status:        p.status,
          score:         p.score,
          totalRevenue:  p.totalRevenue,
          totalBookings: p.totalBookings,
        };
      });

    _cache = {
      totalCustomers: total,
      vipCount:       vipCount,
      repeatCount:    repeatCount,
      repeatRate:     repeatRate,
      avgRevenue:     avgRevenue,
      topCustomers:   topCustomers,
    };
    _cacheTs = now;
    return _cache;
  }

  function invalidate() { _cache = null; _cacheTs = 0; }

  if (window.EventBus) {
    ['booking:updated', 'booking:created', 'booking:deleted'].forEach(function (ev) {
      EventBus.on(ev, invalidate);
    });
  }

  return { compute: compute, invalidate: invalidate };

})();
