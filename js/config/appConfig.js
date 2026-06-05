(function () {
  'use strict';
  window.HM_CONFIG = {
    FORCE_FALLBACK: false,
    LOG_FALLBACK:   true,
    // Per-table TTL overrides in ms. Defaults: bookings/calendar=2min, reviews=5min, services/hm_data=10min
    CACHE_TTL: {},
    // Retry config for transient Supabase failures (network blips, 429, 5xx)
    RETRY: {
      maxAttempts: 3,       // retries after the first attempt
      baseDelayMs: 500,     // initial backoff delay
      maxDelayMs:  10000,   // backoff cap
      factor:      2,       // exponential multiplier per attempt
    },
  };
})();
