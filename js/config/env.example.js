// Copy this file to env.js and set your API base URL.
// js/config/env.js is gitignored — keep environment-specific values out of git.
// Load as a plain <script> tag before dataClient.js.
//
// Self-hosted PHP + MySQL backend. The API lives at /hm-api on the SAME host as
// the site, so prefer the same-origin form below — it never triggers CORS and
// works identically on apex and www. Only hardcode an absolute URL if hm-api is
// hosted on a different domain.
window.API_BASE = window.location.origin + '/hm-api'; // same-origin (recommended)

// API key — must EXACTLY match 'api_key' in hm-api/_config.php when the gate is
// enabled (leave '' to disable). NOT secret (it ships to the browser); it deters
// casual/cross-origin abuse alongside CORS, it is not user authentication.
window.API_KEY = '';

// For local development against a PHP server on your machine, e.g.:
//   window.API_BASE = 'http://localhost/hm-api';

// Required: signals to dataClient.js that config is present and valid.
window.ENV = { ready: true };
