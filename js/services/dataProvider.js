// Load order: appConfig.js → supabaseClient.js → fallbackLogger.js → this file
(function () {
  'use strict';

  function _cfg() { return window.HM_CONFIG || {}; }
  function _sb()  { return window.SupabaseClient || null; }

  function _log(operation, table, error, success) {
    if (window.FallbackLogger) window.FallbackLogger.log(operation, table, error, success);
  }

  /* ── Per-table TTL defaults (ms) ─────────────────────────────────────────
     Override per-table via window.HM_CONFIG.CACHE_TTL = { bookings: 60000 }  */
  const _TTL_DEFAULTS = {
    bookings:              2 * 60 * 1000,   //  2 min — high-change transactional
    calendar_availability: 2 * 60 * 1000,   //  2 min — high-change transactional
    reviews:               5 * 60 * 1000,   //  5 min
    services:             10 * 60 * 1000,   // 10 min — low-change config
    hm_data:              10 * 60 * 1000,   // 10 min — low-change config
  };
  const _TTL_FALLBACK = 5 * 60 * 1000;     //  5 min default for unknown tables

  function _ttl(table) {
    const override = (_cfg().CACHE_TTL || {})[table];
    return typeof override === 'number' ? override : (_TTL_DEFAULTS[table] ?? _TTL_FALLBACK);
  }

  /* ── Cache envelope: { data, ts, ttl } ───────────────────────────────── */
  function _cacheKey(table) { return 'hm_dp_' + table; }

  function _cacheGet(table) {
    try {
      const raw = localStorage.getItem(_cacheKey(table));
      if (!raw) return null;
      const env = JSON.parse(raw);
      return (env && typeof env.ts === 'number') ? env : null;
    } catch { return null; }
  }

  function _cacheSet(table, data) {
    try {
      localStorage.setItem(_cacheKey(table), JSON.stringify({ data, ts: Date.now(), ttl: _ttl(table) }));
    } catch { /* storage quota exceeded — no-op */ }
  }

  function _cacheIsValid(table) {
    const env = _cacheGet(table);
    if (!env) return false;
    return (Date.now() - env.ts) < (env.ttl ?? _ttl(table));
  }

  /* Stamp ts=0 to mark stale without losing data (data is still usable as fallback) */
  function _cacheInvalidate(table) {
    const env = _cacheGet(table);
    if (!env) return;
    try { localStorage.setItem(_cacheKey(table), JSON.stringify({ ...env, ts: 0 })); } catch { /* no-op */ }
  }

  function _applyFilters(query, filters) {
    if (!filters) return query;
    Object.entries(filters).forEach(([col, val]) => { query = query.eq(col, val); });
    return query;
  }

  /* ── In-memory metrics (reset on page reload) ─────────────────────────── */
  const _metrics = {
    reads: 0, cacheHits: 0, supabaseReads: 0, fallbacks: 0,
    lastLatencyMs: null, lastSyncTs: null,
  };

  const DataProvider = {

    async read(table, filters) {
      _metrics.reads++;
      const sb = _sb();

      /* Fresh cache — skip Supabase entirely */
      if (!_cfg().FORCE_FALLBACK && _cacheIsValid(table)) {
        _metrics.cacheHits++;
        return { data: _cacheGet(table).data, source: 'cache', error: null };
      }

      if (sb && !_cfg().FORCE_FALLBACK) {
        try {
          const t0 = Date.now();
          const { data, error } = await _applyFilters(sb.from(table).select('*'), filters);
          _metrics.lastLatencyMs = Date.now() - t0;
          if (error) throw error;
          _metrics.supabaseReads++;
          _metrics.lastSyncTs = Date.now();
          _cacheSet(table, data);
          return { data, source: 'supabase', error: null };
        } catch (e) {
          _log('read', table, e, false);
          console.warn('[DataProvider] read fallback for', table, '—', e.message || e);
        }
      }

      /* Serve stale cache if available rather than an empty array */
      _metrics.fallbacks++;
      const env = _cacheGet(table);
      _log('read', table, null, true);
      return { data: env?.data ?? [], source: 'localStorage', error: null };
    },

    async write(table, data) {
      const rows = Array.isArray(data) ? data : [data];
      const sb = _sb();
      if (sb && !_cfg().FORCE_FALLBACK) {
        try {
          const { error } = await sb.from(table).insert(rows);
          if (error) throw error;
          _cacheInvalidate(table); // force fresh fetch on next read
          return { success: true, source: 'supabase', error: null };
        } catch (e) {
          _log('write', table, e, false);
          console.warn('[DataProvider] write fallback for', table, '—', e.message || e);
        }
      }
      const env = _cacheGet(table);
      _cacheSet(table, [...(env?.data || []), ...rows]);
      _log('write', table, null, true);
      return { success: true, source: 'localStorage', error: null };
    },

    async update(table, id, patch) {
      const sb = _sb();
      if (sb && !_cfg().FORCE_FALLBACK) {
        try {
          const { error } = await sb.from(table).update(patch).eq('id', id);
          if (error) throw error;
          _cacheInvalidate(table);
          return { success: true, source: 'supabase', error: null };
        } catch (e) {
          _log('update', table, e, false);
          console.warn('[DataProvider] update fallback for', table, '—', e.message || e);
        }
      }
      const env = _cacheGet(table);
      _cacheSet(table, (env?.data || []).map(r => (r.id === id ? { ...r, ...patch } : r)));
      _log('update', table, null, true);
      return { success: true, source: 'localStorage', error: null };
    },

    async delete(table, id) {
      const sb = _sb();
      if (sb && !_cfg().FORCE_FALLBACK) {
        try {
          const { error } = await sb.from(table).delete().eq('id', id);
          if (error) throw error;
          _cacheInvalidate(table);
          return { success: true, source: 'supabase', error: null };
        } catch (e) {
          _log('delete', table, e, false);
          console.warn('[DataProvider] delete fallback for', table, '—', e.message || e);
        }
      }
      const env = _cacheGet(table);
      _cacheSet(table, (env?.data || []).filter(r => r.id !== id));
      _log('delete', table, null, true);
      return { success: true, source: 'localStorage', error: null };
    },

    /* Explicitly bust a table's cache — call after external writes */
    invalidate(table) { _cacheInvalidate(table); },

    /* Remove all DataProvider cache keys from localStorage */
    clearAllCache() {
      Object.keys(localStorage)
        .filter(k => k.startsWith('hm_dp_'))
        .forEach(k => localStorage.removeItem(k));
    },

    /* Observability: [{table, age_s, ttl_s, valid, rows}] for all cached tables */
    cacheStatus() {
      return Object.keys(localStorage)
        .filter(k => k.startsWith('hm_dp_'))
        .map(k => {
          try {
            const env   = JSON.parse(localStorage.getItem(k));
            const table = k.replace('hm_dp_', '');
            return {
              table,
              age_s: env?.ts ? Math.round((Date.now() - env.ts) / 1000) : null,
              ttl_s: env?.ttl ? Math.round(env.ttl / 1000) : null,
              valid: _cacheIsValid(table),
              rows:  Array.isArray(env?.data) ? env.data.length : 0,
            };
          } catch { return null; }
        })
        .filter(Boolean);
    },

    /* Runtime metrics accumulated since page load */
    getMetrics() {
      const total = _metrics.reads || 1;
      return {
        reads:         _metrics.reads,
        cacheHits:     _metrics.cacheHits,
        supabaseReads: _metrics.supabaseReads,
        fallbacks:     _metrics.fallbacks,
        hitRate:       Math.round((_metrics.cacheHits / total) * 100),
        lastLatencyMs: _metrics.lastLatencyMs,
        lastSyncTs:    _metrics.lastSyncTs,
      };
    },

    resetMetrics() {
      _metrics.reads = _metrics.cacheHits = _metrics.supabaseReads = _metrics.fallbacks = 0;
      _metrics.lastLatencyMs = _metrics.lastSyncTs = null;
    },
  };

  window.DataProvider = DataProvider;
})();
