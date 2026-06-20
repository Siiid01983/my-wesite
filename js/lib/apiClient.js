/* ════════════════════════════════════════════════════════════════════════════
   apiClient.js — the data client for the self-hosted PHP + MySQL backend.

   Talks ONLY to the cPanel PHP API (hm-api/). No third-party backend and no
   external SDK — every call is a plain fetch() to your own server. The client
   mirrors a small query-builder / realtime / storage
   surface so the existing app modules keep working unchanged.

   Exposes:  window.ApiClient = { createClient(apiBase) }
   `apiBase` is window.API_BASE, e.g. 'https://www.dzsecurity.com/hm-api'.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function _base(url) { return String(url || '').replace(/\/+$/, ''); }

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
    return fetch(this._url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
    })
      .then((res) => res.json().then(
        (j) => j,
        () => ({ data: null, error: { message: 'Invalid JSON from API (HTTP ' + res.status + ')' } })
      ))
      .then((j) => ({ data: (j && 'data' in j) ? j.data : null, count: (j && 'count' in j) ? j.count : null, error: (j && j.error) || null }))
      .catch((e) => ({ data: null, error: { message: (e && e.message) || 'network error' } }));
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  function StorageBucket(storageUrl, bucket) { this._url = storageUrl; this._bucket = bucket; }
  StorageBucket.prototype.upload = function (path, file, opts) {
    const fd = new FormData();
    fd.append('bucket', this._bucket); fd.append('path', path); fd.append('file', file);
    return fetch(this._url + '?action=upload', { method: 'POST', body: fd })
      .then((r) => r.json())
      .catch((e) => ({ data: null, error: { message: (e && e.message) || 'upload failed' } }));
  };
  StorageBucket.prototype.remove = function (paths) {
    return fetch(this._url + '?action=remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: this._bucket, paths: Array.isArray(paths) ? paths : [paths] }),
    }).then((r) => r.json()).catch((e) => ({ data: null, error: { message: (e && e.message) || 'remove failed' } }));
  };
  StorageBucket.prototype.list = function (folder, _opts) {
    const q = '?action=list&bucket=' + encodeURIComponent(this._bucket) + '&prefix=' + encodeURIComponent(folder || '');
    return fetch(this._url + q).then((r) => r.json())
      .catch((e) => ({ data: null, error: { message: (e && e.message) || 'list failed' } }));
  };
  StorageBucket.prototype.createSignedUrl = function (path, ttl) {
    const q = '?action=sign&bucket=' + encodeURIComponent(this._bucket) + '&path=' + encodeURIComponent(path) + '&ttl=' + (ttl || 300);
    return fetch(this._url + q).then((r) => r.json())
      .catch((e) => ({ data: null, error: { message: (e && e.message) || 'sign failed' } }));
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
