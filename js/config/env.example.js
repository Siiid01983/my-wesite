// Copy this file to env.js and fill in your Supabase project values.
// js/config/env.js is gitignored — never commit real credentials.
// Load as a plain <script> tag before supabaseAdapter.js.
window.SUPABASE_URL      = 'https://<project-ref>.supabase.co';
window.SUPABASE_ANON_KEY = '<anon-public-key>';

// Required: signals to supabaseClient.js that credentials are present and valid.
// supabaseClient.js sets SupabaseClient = null if window.ENV.ready is not true,
// which causes contentLoader.js to fall back to static defaults silently.
window.ENV = { ready: true };
