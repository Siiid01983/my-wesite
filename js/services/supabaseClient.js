// ES-module singleton — for module-based consumers.
// env.js (plain script) must be loaded first to set window.SUPABASE_URL / ANON_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const url = window.SUPABASE_URL;
const key = window.SUPABASE_ANON_KEY;

if (!url || !key || url.includes('<') || key.includes('<')) {
  throw new Error(
    'supabaseClient: copy js/config/env.example.js → js/config/env.js and fill in credentials.'
  );
}

export const supabase = createClient(url, key);
