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
    bookings:              2 * 60 * 1000,
    calendar_availability: 2 * 60 * 1000,
    reviews:               5 * 60 * 1000,
    services:             10 * 60 * 1000,
    hm_data:              10 * 60 * 1000,
  };
  const _TTL_FALLBACK = 5 * 60 * 1000;

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

  /* ── Retry helpers ────────────────────────────────────────────────────── */
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ±25% jitter prevents thundering herd after shared outages */
  function _jitter(ms) { return Math.round(ms * (0.75 + Math.random() * 0.5)); }

  /* Retry on: network errors (no status), 429 rate-limit, 5xx server errors.
     Do NOT retry: 4xx client errors (bad schema, auth, forbidden, not-found). */
  function _isRetryable(err) {
    if (!err) return false;
    const status = err.status ?? err.statusCode ?? err.code;
    if (status === undefined || status === null) return true;  // pure network error
    if (status === 429) return true;                           // rate limit
    if (typeof status === 'number' && status >= 500) return true; // server error
    return false;
  }

  /* Wraps a Supabase fn() → {data, error} with exponential-backoff retries.
     Returns the last response; caller checks result.error as before. */
  async function _withRetry(sbFn, table, operation) {
    const rc       = (_cfg().RETRY) || {};
    const maxTries = (rc.maxAttempts ?? 3) + 1; // first attempt + retries
    const base     = rc.baseDelayMs ?? 500;
    const cap      = rc.maxDelayMs  ?? 10000;
    const factor   = rc.factor      ?? 2;

    let result;
    for (let attempt = 0; attempt < maxTries; attempt++) {
      try {
        result = await sbFn();
      } catch (thrown) {
        result = { data: null, error: thrown };
      }

      const done = !result.error || !_isRetryable(result.error) || attempt === maxTries - 1;
      if (done) return result;

      _metrics.retries++;
      _metrics.lastRetryTs = Date.now();
      const delay = _jitter(Math.min(base * Math.pow(factor, attempt), cap));
      console.warn(`[DataProvider] ${operation} on ${table}: retry ${attempt + 1}/${maxTries - 1} in ${delay}ms —`, result.error?.message || result.error);
      await _sleep(delay);
    }
    return result;
  }

  /* ── In-memory metrics (reset on page reload) ─────────────────────────── */
  const _metrics = {
    reads: 0, cacheHits: 0, supabaseReads: 0, fallbacks: 0, retries: 0,
    lastLatencyMs: null, lastSyncTs: null, lastRetryTs: null,
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
          const { data, error } = await _withRetry(
            () => _applyFilters(sb.from(table).select('*'), filters),
            table, 'read'
          );
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
          const { error } = await _withRetry(() => sb.from(table).insert(rows), table, 'write');
          if (error) throw error;
          _cacheInvalidate(table);
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
          const { error } = await _withRetry(
            () => sb.from(table).update(patch).eq('id', id),
            table, 'update'
          );
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
          const { error } = await _withRetry(
            () => sb.from(table).delete().eq('id', id),
            table, 'delete'
          );
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

    invalidate(table) { _cacheInvalidate(table); },

    /* Seed the cache with raw Supabase rows without making a network request.
       Used by Adapter.syncFromSupabase() so the observability panel shows all
       tables as valid immediately after login, not only after each view is visited. */
    seed(table, data) { _cacheSet(table, data); },

    clearAllCache() {
      Object.keys(localStorage)
        .filter(k => k.startsWith('hm_dp_'))
        .forEach(k => localStorage.removeItem(k));
    },

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

    getMetrics() {
      const total = _metrics.reads || 1;
      return {
        reads:         _metrics.reads,
        cacheHits:     _metrics.cacheHits,
        supabaseReads: _metrics.supabaseReads,
        fallbacks:     _metrics.fallbacks,
        retries:       _metrics.retries,
        hitRate:       Math.round((_metrics.cacheHits / total) * 100),
        lastLatencyMs: _metrics.lastLatencyMs,
        lastSyncTs:    _metrics.lastSyncTs,
        lastRetryTs:   _metrics.lastRetryTs,
      };
    },

    resetMetrics() {
      _metrics.reads = _metrics.cacheHits = _metrics.supabaseReads =
        _metrics.fallbacks = _metrics.retries = 0;
      _metrics.lastLatencyMs = _metrics.lastSyncTs = _metrics.lastRetryTs = null;
    },
  };

  window.DataProvider = DataProvider;
})();
