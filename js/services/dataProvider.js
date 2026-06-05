// Load order: appConfig.js → supabaseClient.js → fallbackLogger.js → this file
(function () {
  'use strict';

  function _cfg() { return window.HM_CONFIG || {}; }
  function _sb()  { return window.SupabaseClient || null; }

  function _log(operation, table, error, success) {
    if (window.FallbackLogger) window.FallbackLogger.log(operation, table, error, success);
  }

  function _cacheKey(table) { return 'hm_dp_' + table; }

  function _cacheRead(table) {
    try { return JSON.parse(localStorage.getItem(_cacheKey(table)) || 'null'); } catch { return null; }
  }

  function _cacheWrite(table, data) {
    try { localStorage.setItem(_cacheKey(table), JSON.stringify(data)); } catch { /* no-op */ }
  }

  function _applyFilters(query, filters) {
    if (!filters) return query;
    Object.entries(filters).forEach(([col, val]) => { query = query.eq(col, val); });
    return query;
  }

  const DataProvider = {

    async read(table, filters) {
      const sb = _sb();
      if (sb && !_cfg().FORCE_FALLBACK) {
        try {
          const { data, error } = await _applyFilters(sb.from(table).select('*'), filters);
          if (error) throw error;
          _cacheWrite(table, data);
          return { data, source: 'supabase', error: null };
        } catch (e) {
          _log('read', table, e, false);
          console.warn('[DataProvider] read fallback for', table, '—', e.message || e);
        }
      }
      const cached = _cacheRead(table);
      _log('read', table, null, true);
      return { data: cached !== null ? cached : [], source: 'localStorage', error: null };
    },

    async write(table, data) {
      const rows = Array.isArray(data) ? data : [data];
      const sb = _sb();
      if (sb && !_cfg().FORCE_FALLBACK) {
        try {
          const { error } = await sb.from(table).insert(rows);
          if (error) throw error;
          const cached = _cacheRead(table) || [];
          _cacheWrite(table, [...cached, ...rows]);
          return { success: true, source: 'supabase', error: null };
        } catch (e) {
          _log('write', table, e, false);
          console.warn('[DataProvider] write fallback for', table, '—', e.message || e);
        }
      }
      const cached = _cacheRead(table) || [];
      _cacheWrite(table, [...cached, ...rows]);
      _log('write', table, null, true);
      return { success: true, source: 'localStorage', error: null };
    },

    async update(table, id, patch) {
      const sb = _sb();
      if (sb && !_cfg().FORCE_FALLBACK) {
        try {
          const { error } = await sb.from(table).update(patch).eq('id', id);
          if (error) throw error;
          const cached = (_cacheRead(table) || []).map(r => (r.id === id ? { ...r, ...patch } : r));
          _cacheWrite(table, cached);
          return { success: true, source: 'supabase', error: null };
        } catch (e) {
          _log('update', table, e, false);
          console.warn('[DataProvider] update fallback for', table, '—', e.message || e);
        }
      }
      const cached = (_cacheRead(table) || []).map(r => (r.id === id ? { ...r, ...patch } : r));
      _cacheWrite(table, cached);
      _log('update', table, null, true);
      return { success: true, source: 'localStorage', error: null };
    },

    async delete(table, id) {
      const sb = _sb();
      if (sb && !_cfg().FORCE_FALLBACK) {
        try {
          const { error } = await sb.from(table).delete().eq('id', id);
          if (error) throw error;
          const cached = (_cacheRead(table) || []).filter(r => r.id !== id);
          _cacheWrite(table, cached);
          return { success: true, source: 'supabase', error: null };
        } catch (e) {
          _log('delete', table, e, false);
          console.warn('[DataProvider] delete fallback for', table, '—', e.message || e);
        }
      }
      const cached = (_cacheRead(table) || []).filter(r => r.id !== id);
      _cacheWrite(table, cached);
      _log('delete', table, null, true);
      return { success: true, source: 'localStorage', error: null };
    },
  };

  window.DataProvider = DataProvider;
})();
