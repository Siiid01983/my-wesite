// Single source of truth for the Supabase client.
// ALL services must read window.SupabaseClient — never call createClient() elsewhere.
// Load order: supabase UMD → js/config/env.js → this file → (all other services)
(function () {
  'use strict';

  if (!window.ENV || !window.ENV.ready) {
    console.error('[SupabaseClient] ENV not ready — env.js did not load or credentials are missing. Supabase disabled.');
    window.SupabaseClient = null;
    return;
  }

  const url = window.SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY;

  if (!url || !key || url.includes('<') || key.includes('<')) {
    console.warn(
      '[SupabaseClient] Missing or placeholder credentials — ' +
      'copy js/config/env.example.js → js/config/env.js and fill in values.'
    );
    window.SupabaseClient = null;
    return;
  }

  if (!window.supabase) {
    console.warn('[SupabaseClient] Supabase UMD library not loaded — include it before this script.');
    window.SupabaseClient = null;
    return;
  }

  try {
    window.SupabaseClient = window.supabase.createClient(url, key);
  } catch (e) {
    console.error('[SupabaseClient] createClient failed:', e);
    window.SupabaseClient = null;
  }
})();
