/* ════════════════════════════════════════════════════════════════════════════
   apiClient.js — the data client for the self-hosted PHP + MySQL backend.

   Talks ONLY to the cPanel PHP API (hm-api/). No third-party backend and no
   external SDK — every call is a plain fetch() to your own server. The client
   mirrors a small query-builder / realtime / storage
   surface so the existing app modules keep working unchanged.

   Exposes:  window.ApiClient = { createClient(apiBase) }
   `apiBase` is window.API_BASE, e.g. 'https://hello-moving.com/hm-api'.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function _base(url) { return String(url || '').replace(/\/+$/, ''); }

  // Attach the API key (window.API_KEY) when configured. A no-op when unset, so
  // the gate can be enabled/disabled from config alone without code changes.
  function _hdrs(base) {
    const h = base || {};
    const k = window.API_KEY;
    if (k) h['X-API-KEY'] = k;
    // Admin session token (set by js/core/auth.js after admin login). Authorizes
    // rest.php admin-only operations; harmless on customer/portal pages where it
    // is never set, and ignored by the server for non-admin operations.
    if (window.__HM_ADMIN_TOKEN) h['X-ADMIN-TOKEN'] = window.__HM_ADMIN_TOKEN;
    return h;
  }

  // ── REST query builder (thenable) ──────────────────────────────────────────
  function QueryBuilder(restUrl, table) {
    this._url = restUrl;
    this._spec = { table: table, action: 'select', columns: '*', filters: [], order: [], limit: null, single: false, returning: false };
  }
  const QP = QueryBuilder.prototype;

  QP._filter = function (col, op, val, negate) {
    this._spec.filters.push({ col: col, op: op, val: val, negate: !!negate });
    return this;
  };

  QP.select = function (cols, opts) {
    if (this._spec.action === 'select') {
      this._spec.columns = cols || '*';
      if (opts && opts.count) { this._spec.count = opts.count; this._spec.head = !!opts.head; }
    } else {
      this._spec.returning = true;               // insert/upsert/update/delete → return rows
    }
    return this;
  };
  QP.insert = function (rows)        { this._spec.action = 'insert'; this._spec.values = rows; return this; };
  QP.upsert = function (rows, opts)  { this._spec.action = 'upsert'; this._spec.values = rows; if (opts && opts.onConflict) this._spec.onConflict = opts.onConflict; return this; };
  QP.update = function (patch)       { this._spec.action = 'update'; this._spec.values = patch; return this; };
  QP.delete = function ()            { this._spec.action = 'delete'; return this; };

  QP.eq  = function (c, v) { return this._filter(c, 'eq',  v); };
  QP.neq = function (c, v) { return this._filter(c, 'neq', v); };
  QP.gt  = function (c, v) { return this._filter(c, 'gt',  v); };
  QP.gte = function (c, v) { return this._filter(c, 'gte', v); };
  QP.lt  = function (c, v) { return this._filter(c, 'lt',  v); };
  QP.lte = function (c, v) { return this._filter(c, 'lte', v); };
  QP.like  = function (c, v) { return this._filter(c, 'like',  v); };
  QP.ilike = function (c, v) { return this._filter(c, 'ilike', v); };
  QP.in  = function (c, arr) { return this._filter(c, 'in', arr); };
  QP.is  = function (c, v) { return this._filter(c, 'is', v); };
  QP.not = function (c, op, v) { return this._filter(c, op, v, true); };
  QP.match = function (obj) { Object.keys(obj || {}).forEach((k) => this._filter(k, 'eq', obj[k])); return this; };

  QP.order = function (col, opts) { this._spec.order.push({ col: col, ascending: !(opts && opts.ascending === false) }); return this; };
  QP.limit = function (n) { this._spec.limit = n; return this; };
  QP.range = function (a, b) { this._spec.limit = (b - a + 1); return this; };

  QP.single      = function () { this._spec.single = 'one';   return this; };
  QP.maybeSingle = function () { this._spec.single = 'maybe'; return this; };

  QP._exec = function () {
    const spec = this._spec;
    // Pre-flight admin gate: when admin enforcement is active and no admin token
    // exists, never even attempt a protected write — return admin_required so the
    // optimistic save is rolled back and the re-login prompt shown. No-op when
    // AdminReauth is absent (portal pages) or enforcement is off.
    if (window.AdminReauth && window.AdminReauth.shouldBlock(spec)) {
      window.AdminReauth.notify();
      return Promise.resolve({ data: null, count: null, error: { message: 'Admin authorization required', code: 'admin_required' } });
    }
    return fetch(this._url, {
      method: 'POST',
      headers: _hdrs({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(spec),
    })
      .then((res) => res.text().then((text) => {
        try {
          return JSON.parse(text);
        } catch (_) {
          const snippet = String(text || '').slice(0, 300);
          return { data: null, error: { message: 'Invalid JSON from API (HTTP ' + res.status + '): ' + snippet } };
        }
      }))
      .then((j) => {
        const out = { data: (j && 'data' in j) ? j.data : null, count: (j && 'count' in j) ? j.count : null, error: (j && j.error) || null };
        // Centralized detection of a real rest.php admin_required (401): roll back
        // optimistic local state + show the re-login prompt — once, for every
        // protected write path, with no per-module duplication.
        if (out.error && out.error.code === 'admin_required' && window.AdminReauth) window.AdminReauth.handle(out.error);
        return out;
      })
      // A rejection here is a transport-level failure (fetch threw: DNS, TLS,
      // CORS, connection reset, offline) — NOT a server query error. Tag it with
      // isNetwork so callers (e.g. HealthCheck) can distinguish "can't reach the
      // server" from "server replied with an error" and never mislabel a network
      // outage as "database connected (query error)".
      .catch((e) => {
        if (window.HMDiagnostics) window.HMDiagnostics.record('api', { table: spec && spec.table, action: spec && spec.action, message: (e && e.message) || 'network error', network: true });
        return { data: null, error: { message: (e && e.message) || 'network error', isNetwork: true } };
      });
  };

  // Thenable: `await client.from('x').select()...` resolves to { data, error }.
  QP.then  = function (resolve, reject) { return this._exec().then(resolve, reject); };
  QP.catch = function (reject) { return this._exec().catch(reject); };

  // ── Realtime via polling ───────────────────────────────────────────────────
  function pollMs() {
    const c = window.HM_CONFIG || {};
    return (typeof c.REALTIME_POLL_MS === 'number') ? c.REALTIME_POLL_MS : 12000;
  }

  function RealtimeChannel(restUrl, name) {
    this._url = restUrl;
    this.name = name;
    this._handlers = [];   // { event, table, cb }
    this._timers = [];
    this._snap = {};       // table → { id: JSONstring }
  }
  RealtimeChannel.prototype.on = function (_type, filter, cb) {
    this._handlers.push({ event: (filter && filter.event) || '*', table: filter && filter.table, cb: cb });
    return this;
  };
  RealtimeChannel.prototype.subscribe = function (cb) {
    const tables = {};
    this._handlers.forEach((h) => { if (h.table) tables[h.table] = true; });
    Object.keys(tables).forEach((table) => this._watch(table));
    if (typeof cb === 'function') { try { cb('SUBSCRIBED'); } catch (_) {} }
    return this;
  };
  RealtimeChannel.prototype._fetch = function (table) {
    return fetch(this._url, {
      method: 'POST', headers: _hdrs({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ table: table, action: 'select', columns: '*' }),
    }).then((r) => r.json()).then((j) => (j && j.data) || []).catch(() => null);
  };
  RealtimeChannel.prototype._watch = function (table) {
    const self = this;
    const fire = (event, row) => {
      self._handlers.forEach((h) => {
        if (h.table !== table) return;
        if (h.event !== '*' && h.event !== event) return;
        const payload = { schema: 'public', table: table, eventType: event,
          new: (event === 'DELETE') ? {} : row, old: (event === 'DELETE') ? row : {} };
        try { h.cb(payload); } catch (e) { console.warn('[realtime]', e); }
      });
    };
    const tick = () => self._fetch(table).then((rows) => {
      if (rows === null) return;                       // network blip — keep last snapshot
      const next = {};
      rows.forEach((r) => { next[r.id] = JSON.stringify(r); });
      const prev = self._snap[table];
      if (prev) {                                      // skip first poll (baseline only)
        rows.forEach((r) => {
          if (!(r.id in prev)) fire('INSERT', r);
          else if (prev[r.id] !== next[r.id]) fire('UPDATE', r);
        });
        Object.keys(prev).forEach((id) => { if (!(id in next)) fire('DELETE', { id: id }); });
      }
      self._snap[table] = next;
    });
    tick();
    self._timers.push(setInterval(tick, pollMs()));
  };
  RealtimeChannel.prototype.unsubscribe = function () {
    this._timers.forEach(clearInterval); this._timers = [];
    return Promise.resolve({ error: null });
  };

  // ── Storage (buckets backed by storage.php) ────────────────────────────────
  // Parse a storage.php response defensively. storage.php returns the standard
  // { ok, data, error } envelope — but a PHP fatal, a 413/500 HTML error page,
  // or an empty body would make a naive r.json() throw and collapse EVERY
  // failure into a generic "upload failed", hiding the real cause (size limit,
  // permissions, MIME). Here we read text, honour the envelope when present,
  // and otherwise surface the HTTP status + a body snippet so callers (and
  // HMDiagnostics) can see what actually went wrong.
  function _readStorage(res, label) {
    return res.text().then((text) => {
      let j = null;
      try { j = JSON.parse(text); } catch (_) { /* non-JSON error body */ }
      if (j && (('data' in j) || ('error' in j))) {
        return { data: ('data' in j) ? j.data : null, error: j.error || null };
      }
      if (!res.ok) {
        const snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 200);
        const msg = label + ' failed (HTTP ' + res.status + ')' + (snippet ? ': ' + snippet : '');
        if (window.HMDiagnostics) window.HMDiagnostics.record('upload', { label, status: res.status, message: snippet });
        return { data: null, error: { message: msg, status: res.status } };
      }
      return { data: j, error: null };
    });
  }
  function _storageNetErr(e, label) {
    if (window.HMDiagnostics) window.HMDiagnostics.record('upload', { label, network: true, message: (e && e.message) || '' });
    return { data: null, error: { message: (e && e.message) || (label + ' failed'), isNetwork: true } };
  }

  function StorageBucket(storageUrl, bucket) { this._url = storageUrl; this._bucket = bucket; }
  StorageBucket.prototype.upload = function (path, file, opts) {
    const fd = new FormData();
    fd.append('bucket', this._bucket); fd.append('path', path); fd.append('file', file);
    return fetch(this._url + '?action=upload', { method: 'POST', headers: _hdrs(), body: fd })
      .then((r) => _readStorage(r, 'upload'))
      .catch((e) => _storageNetErr(e, 'upload'));
  };
  StorageBucket.prototype.remove = function (paths) {
    return fetch(this._url + '?action=remove', {
      method: 'POST', headers: _hdrs({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ bucket: this._bucket, paths: Array.isArray(paths) ? paths : [paths] }),
    }).then((r) => _readStorage(r, 'remove')).catch((e) => _storageNetErr(e, 'remove'));
  };
  StorageBucket.prototype.list = function (folder, _opts) {
    const q = '?action=list&bucket=' + encodeURIComponent(this._bucket) + '&prefix=' + encodeURIComponent(folder || '');
    return fetch(this._url + q, { headers: _hdrs() }).then((r) => _readStorage(r, 'list'))
      .catch((e) => _storageNetErr(e, 'list'));
  };
  StorageBucket.prototype.createSignedUrl = function (path, ttl) {
    const q = '?action=sign&bucket=' + encodeURIComponent(this._bucket) + '&path=' + encodeURIComponent(path) + '&ttl=' + (ttl || 300);
    return fetch(this._url + q, { headers: _hdrs() }).then((r) => _readStorage(r, 'sign'))
      .catch((e) => _storageNetErr(e, 'sign'));
  };
  StorageBucket.prototype.getPublicUrl = function (path) {
    const url = this._url + '?action=get&bucket=' + encodeURIComponent(this._bucket) + '&path=' + encodeURIComponent(path);
    return { data: { publicUrl: url } };
  };

  // ── Auth stub (portal authenticates via auth.php + PortalAuth, not an SDK) ──
  const authStub = {
    getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
    getUser:    function () { return Promise.resolve({ data: { user: null }, error: null }); },
    onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    setSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
    signOut:    function () { return Promise.resolve({ error: null }); },
  };

  // ── Client factory ─────────────────────────────────────────────────────────
  function createClient(apiBase) {
    const base       = _base(apiBase);
    const restUrl    = base + '/rest.php';
    const storageUrl = base + '/storage.php';
    return {
      apiBase: base,
      from:    function (table) { return new QueryBuilder(restUrl, table); },
      channel: function (name)  { return new RealtimeChannel(restUrl, name); },
      removeChannel: function (ch) { return ch && ch.unsubscribe ? ch.unsubscribe() : Promise.resolve({ error: null }); },
      storage: { from: function (bucket) { return new StorageBucket(storageUrl, bucket); } },
      auth:    authStub,
    };
  }

  window.ApiClient = { createClient: createClient };
})();
