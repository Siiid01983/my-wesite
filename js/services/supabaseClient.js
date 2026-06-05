// Plain-script singleton — exposes window.SupabaseClient (Supabase JS client instance).
// Load order: supabase UMD → js/config/env.js → this file
(function () {
  'use strict';

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
