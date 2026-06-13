/* Public-safe Supabase credentials for deployed environments (GitHub Pages, etc.).
   This file is committed intentionally — it contains ONLY the anon (public) key.
   The anon key is designed to be client-side visible; Supabase RLS policies restrict access.
   For local development use js/config/env.js (gitignored) with the same or dev credentials. */
window.SUPABASE_URL      = 'https://ursohvtxzqxeczvrspiw.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyc29odnR4enF4ZWN6dnJzcGl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjkzMjksImV4cCI6MjA5NjUwNTMyOX0.KHaP1wGqeEdlIze3c2zSQt7QIj3Uea2gh5t3Zsx6vn4';

window.ENV = {
  SUPABASE_URL:      window.SUPABASE_URL,
  SUPABASE_ANON_KEY: window.SUPABASE_ANON_KEY,
  ready: true,
};
