/* Public runtime config for deployed environments.
   Self-hosted PHP + MySQL backend. API_BASE is the public URL of the hm-api/
   folder uploaded to cPanel. Self-hosted; no third-party backend.

   ⚠ Set API_BASE to the public URL where you uploaded hm-api/. */
window.API_BASE = 'https://hello-moving.com/hm-api';

// Must EXACTLY match 'api_key' in hm-api/_config.php when the gate is enabled.
// Left empty here; the deploy injects it from the API_KEY secret into env.js.
window.API_KEY = '';

window.ENV = {
  API_BASE: window.API_BASE,
  API_KEY:  window.API_KEY,
  ready: !!window.API_BASE,
};
