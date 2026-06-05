(function () {
  'use strict';
  window.HM_CONFIG = {
    FORCE_FALLBACK: false,
    LOG_FALLBACK:   true,
    // Per-table TTL overrides in ms. Defaults: bookings/calendar=2min, reviews=5min, services/hm_data=10min
    CACHE_TTL: {},
  };
})();
