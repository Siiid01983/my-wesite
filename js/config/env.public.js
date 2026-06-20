/* Public runtime config for deployed environments.
   Self-hosted PHP + MySQL backend. API_BASE is the public URL of the hm-api/
   folder uploaded to cPanel. Self-hosted; no third-party backend.

   ⚠ Set API_BASE to the public URL where you uploaded hm-api/. */
window.API_BASE = 'https://www.dzsecurity.com/hm-api';

window.ENV = {
  API_BASE: window.API_BASE,
  ready: !!window.API_BASE,
};
