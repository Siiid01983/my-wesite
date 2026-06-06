/* ════════════════════════════════════════════════════════
   CONTENT SERVICE — Phase 11
   Manages ui_content table: section / content_key / content_value

   Load order: supabaseClient.js → dataProvider.js → this file
   Exposed as: window.ContentService
   ════════════════════════════════════════════════════════ */
window.ContentService = (() => {
  'use strict';

  const TABLE  = 'ui_content';
  const LS_KEY = 'hm_ui_content';

  /* ── Read all rows via DataProvider (cache-aware) ─────── */
  async function load() {
    const { data } = await window.DataProvider.read(TABLE);
    return _rowsToMap(data || []);
  }

  /* ── Get one section's data as {key: value} ───────────── */
  async function getSection(section) {
    const all = await load();
    return all[section] || {};
  }

  /* ── Upsert an entire section to Supabase ─────────────── */
  async function saveSection(section, data) {
    const sb = window.SupabaseClient;
    if (!sb) {
      _setLocal(section, data);
      return { success: true, source: 'localStorage' };
    }
    const rows = Object.entries(data).map(([key, value]) => ({
      section,
      content_key: key,
      content_value: String(value ?? ''),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sb
      .from(TABLE)
      .upsert(rows, { onConflict: 'section,content_key' });
    if (error) {
      console.warn('[ContentService] saveSection error:', section, error.message);
      _setLocal(section, data);
      return { success: false, error, source: 'localStorage' };
    }
    window.DataProvider.invalidate(TABLE);
    _setLocal(section, data);
    return { success: true, source: 'supabase' };
  }

  /* ── Pull all sections from Supabase → localStorage ───── */
  async function syncToLocalStorage() {
    const sb = window.SupabaseClient;
    if (!sb) return false;
    const { data, error } = await sb
      .from(TABLE)
      .select('section, content_key, content_value');
    if (error || !data) return false;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(_rowsToMap(data)));
    } catch {}
    window.DataProvider.invalidate(TABLE);
    return true;
  }

  /* ── Read from localStorage (sync, used by public site) ── */
  function getLocal(section) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return {};
      return JSON.parse(raw)[section] || {};
    } catch { return {}; }
  }

  /* ── Internal helpers ─────────────────────────────────── */
  function _rowsToMap(rows) {
    const map = {};
    rows.forEach(row => {
      if (!map[row.section]) map[row.section] = {};
      map[row.section][row.content_key] = row.content_value ?? '';
    });
    return map;
  }

  function _setLocal(section, data) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const map = raw ? JSON.parse(raw) : {};
      map[section] = { ...(map[section] || {}), ...data };
      localStorage.setItem(LS_KEY, JSON.stringify(map));
    } catch {}
  }

  return { load, getSection, saveSection, syncToLocalStorage, getLocal };
})();
