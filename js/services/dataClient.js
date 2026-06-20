// Single source of truth for the data client (self-hosted PHP + MySQL).
// Builds the one live client instance: window.api = ApiClient.createClient(API_BASE).
// ALL services must read window.api — never call createClient() elsewhere.
// Load order: apiClient.js → js/config/env.js → this file → (all other services)
(function () {
  'use strict';

  if (window.ENV && !window.ENV.ready) {
    console.error('[DataClient] ENV not ready — env.js reported config as invalid. API disabled.');
    window.api = null;
    return;
  }

  const apiBase = window.API_BASE;

  if (!apiBase || apiBase.includes('<')) {
    console.warn('[DataClient] Missing or placeholder API_BASE — set window.API_BASE in js/config/env.js to your hm-api URL.');
    window.api = null;
    return;
  }

  if (!window.ApiClient) {
    console.warn('[DataClient] apiClient.js not loaded — include it before this script.');
    window.api = null;
    return;
  }

  try {
    window.api = window.ApiClient.createClient(apiBase);
  } catch (e) {
    console.error('[DataClient] createClient failed:', e);
    window.api = null;
  }
})();
