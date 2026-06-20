// Copy this file to env.js and set your API base URL.
// js/config/env.js is gitignored — keep environment-specific values out of git.
// Load as a plain <script> tag before dataClient.js.
//
// Self-hosted PHP + MySQL backend: API_BASE is the public URL of the uploaded
// hm-api/ folder. Self-hosted; no third-party backend.
window.API_BASE = 'https://hello-moving.com/hm-api'; // ← your hm-api URL

// For local development against a PHP server on your machine, e.g.:
//   window.API_BASE = 'http://localhost/hm-api';

// Required: signals to dataClient.js that config is present and valid.
window.ENV = { ready: true };
