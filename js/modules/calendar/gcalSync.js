'use strict';

/* ════════════════════════════════════════════════════════
   GOOGLE CALENDAR SYNC  (Phase 16)
   ════════════════════════════════════════════════════════
   Provides two-way sync between the admin availability
   calendar and a Google Calendar.

   Push: admin date status → Google Calendar event
   Pull: all-day Google Calendar events → block admin dates

   OAuth uses Google Identity Services (GIS) implicit flow.
   Access token is kept in sessionStorage only (not persisted).
   Settings (clientId, calendarId, syncDir) live in Adapter
   under the key "hm_gcal".

   Public API:
     GCalSync.isConnected()           → bool
     GCalSync.connect()               → triggers OAuth popup
     GCalSync.disconnect()            → revokes + clears token
     GCalSync.pushDate(ds, status)    → async; push one date
     GCalSync.pullMonth(year, month)  → async; import GCal → admin
     GCalSync.syncMonth(year, month)  → async; full two-way sync
     GCalSync.getLog()                → recent sync entries
   ════════════════════════════════════════════════════════ */
window.GCalSync = (function () {

  const SCOPES    = 'https://www.googleapis.com/auth/calendar';
  const LOG_KEY   = 'hm_gcal_log';
  const TOKEN_KEY = 'hm_gcal_token';
  const HM_SOURCE = 'hello-moving-admin';

  let _gapiReady = false;
  let _gisReady  = false;
  let _tokenClient = null;

  /* ── Settings & token ───────────────────────────────── */
  function _cfg()  { return Adapter.getGcalSettings(); }

  function _getToken() {
    try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY)); } catch { return null; }
  }
  function _setToken(t) {
    if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else    sessionStorage.removeItem(TOKEN_KEY);
  }

  function isConnected() {
    const t = _getToken();
    return !!(t && t.access_token && t.expires_at > Date.now());
  }

  /* ── Lazy library loaders ───────────────────────────── */
  function _loadGAPI() {
    if (_gapiReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://apis.google.com/js/api.js';
      s.onload = () => {
        gapi.load('client', () => {
          gapi.client
            .load('https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest')
            .then(() => { _gapiReady = true; resolve(); })
            .catch(reject);
        });
      };
      s.onerror = () => reject(new Error('Failed to load Google API'));
      document.head.appendChild(s);
    });
  }

  function _loadGIS() {
    if (_gisReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload  = () => { _gisReady = true; resolve(); };
      s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(s);
    });
  }

  async function _ensureLibs() {
    await Promise.all([_loadGAPI(), _loadGIS()]);
  }

  /* ── OAuth ──────────────────────────────────────────── */
  function _initTokenClient(clientId) {
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback(response) {
        if (response.error) {
          toast('Google認証エラー: ' + response.error);
          _log({ ts: _now(), dir: 'auth', ok: false, error: response.error });
          return;
        }
        const token = {
          access_token: response.access_token,
          expires_at:   Date.now() + (response.expires_in - 60) * 1000,
        };
        _setToken(token);
        gapi.client.setToken(token);
        _log({ ts: _now(), dir: 'auth', ok: true });
        toast('Googleカレンダーに接続しました');
        if (typeof renderGCalPanel === 'function') renderGCalPanel();
      },
    });
  }

  async function connect() {
    const cfg = _cfg();
    if (!cfg.clientId) { toast('OAuth クライアントIDを入力してください'); return; }
    try {
      await _ensureLibs();
      _initTokenClient(cfg.clientId);
      _tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (e) {
      toast('Google APIの読み込みに失敗しました');
      console.error('[GCalSync] connect:', e);
    }
  }

  function disconnect() {
    const t = _getToken();
    if (t?.access_token) {
      try { google.accounts.oauth2.revoke(t.access_token); } catch (_) {}
    }
    _setToken(null);
    try { gapi.client.setToken(null); } catch (_) {}
    _log({ ts: _now(), dir: 'auth', ok: false, error: 'disconnected' });
    toast('Googleカレンダーから切断しました');
    if (typeof renderGCalPanel === 'function') renderGCalPanel();
  }

  /* Returns true if token is valid; false if re-auth is needed */
  async function _ensureToken() {
    if (isConnected()) {
      gapi.client.setToken(_getToken());
      return true;
    }
    return false;
  }

  /* ── GCal helpers ───────────────────────────────────── */
  function _nextDay(ds) {
    const d = new Date(ds + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  async function _findHMEvent(calId, ds) {
    try {
      const res = await gapi.client.calendar.events.list({
        calendarId: calId,
        timeMin: ds + 'T00:00:00Z',
        timeMax: ds + 'T23:59:59Z',
        privateExtendedProperty: 'hmSource=' + HM_SOURCE,
        singleEvents: true,
      });
      return res.result.items?.[0] || null;
    } catch (e) {
      console.warn('[GCalSync] _findHMEvent:', e);
      return null;
    }
  }

  const STATUS_LABEL = { limited: '残りわずか', booked: '満了' };
  const STATUS_COLOR = { limited: '5', booked: '11' }; // Google Calendar color IDs

  /* ── Push single date ───────────────────────────────── */
  async function pushDate(ds, status) {
    const cfg = _cfg();
    if (!cfg.enabled || cfg.syncDir === 'pull') return;
    const ready = await _ensureToken();
    if (!ready) {
      toast('Googleカレンダーのセッションが期限切れです。再接続してください');
      if (typeof renderGCalPanel === 'function') renderGCalPanel();
      return;
    }

    const calId = cfg.calendarId || 'primary';
    try {
      const existing = await _findHMEvent(calId, ds);

      if (status === 'available') {
        if (existing) {
          await gapi.client.calendar.events.delete({ calendarId: calId, eventId: existing.id });
        }
      } else {
        const body = {
          summary: 'Hello Moving – ' + (STATUS_LABEL[status] || status),
          start:   { date: ds },
          end:     { date: _nextDay(ds) },
          colorId: STATUS_COLOR[status] || '5',
          extendedProperties: { private: { hmStatus: status, hmSource: HM_SOURCE } },
        };
        if (existing) {
          await gapi.client.calendar.events.update({ calendarId: calId, eventId: existing.id, resource: body });
        } else {
          await gapi.client.calendar.events.insert({ calendarId: calId, resource: body });
        }
      }
      _log({ ts: _now(), dir: 'push', date: ds, status, ok: true });
    } catch (e) {
      _log({ ts: _now(), dir: 'push', date: ds, status, ok: false, error: e.message });
      console.warn('[GCalSync] pushDate:', e);
    }
  }

  /* ── Pull external events for a month ──────────────── */
  async function pullMonth(year, month) {
    const cfg = _cfg();
    if (!cfg.enabled || cfg.syncDir === 'push') return { blocked: 0, skipped: 0 };
    const ready = await _ensureToken();
    if (!ready) {
      toast('Googleカレンダーのセッションが期限切れです。再接続してください');
      if (typeof renderGCalPanel === 'function') renderGCalPanel();
      return null;
    }

    const calId  = cfg.calendarId || 'primary';
    const timeMin = new Date(year, month, 1).toISOString();
    const timeMax = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    try {
      const res = await gapi.client.calendar.events.list({
        calendarId: calId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const avail = Adapter.getAvail();
      let blocked = 0, skipped = 0;

      for (const ev of (res.result.items || [])) {
        if (ev.extendedProperties?.private?.hmSource === HM_SOURCE) continue;
        if (!ev.start?.date) continue; // skip timed events; only all-day block

        const ds = ev.start.date;
        if (!avail[ds] || avail[ds] === 'available') {
          CalendarService.updateAvailability(ds, 'booked');
          blocked++;
        } else {
          skipped++;
        }
      }

      _log({ ts: _now(), dir: 'pull', month: `${year}-${String(month+1).padStart(2,'0')}`, blocked, skipped, ok: true });
      return { blocked, skipped };
    } catch (e) {
      _log({ ts: _now(), dir: 'pull', month: `${year}-${String(month+1).padStart(2,'0')}`, ok: false, error: e.message });
      console.error('[GCalSync] pullMonth:', e);
      return null;
    }
  }

  /* ── Two-way sync for a month ───────────────────────── */
  async function syncMonth(year, month) {
    const cfg = _cfg();
    if (!cfg.enabled) { toast('Google Calendar連携が無効です'); return; }

    /* Pull first so pushed state reflects pulled blocks */
    if (cfg.syncDir === 'pull' || cfg.syncDir === 'both') {
      const r = await pullMonth(year, month);
      if (r) toast(`← Google: ${r.blocked}件インポート（${r.skipped}件スキップ）`);
    }

    if (cfg.syncDir === 'push' || cfg.syncDir === 'both') {
      const avail = Adapter.getAvail();
      const p2 = n => String(n).padStart(2, '0');
      const total = new Date(year, month + 1, 0).getDate();
      let pushed = 0;
      for (let d = 1; d <= total; d++) {
        const ds = `${year}-${p2(month + 1)}-${p2(d)}`;
        const st = avail[ds];
        if (st && st !== 'available') { await pushDate(ds, st); pushed++; }
      }
      toast(`→ Google: ${pushed}件エクスポート`);
    }

    const updated = _cfg();
    updated.lastSync = new Date().toISOString();
    Adapter.saveGcalSettings(updated);
    if (typeof renderGCalPanel === 'function') renderGCalPanel();
  }

  /* ── Log ────────────────────────────────────────────── */
  function _now() { return new Date().toISOString(); }

  function _log(entry) {
    try {
      const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      log.unshift(entry);
      if (log.length > 30) log.splice(30);
      localStorage.setItem(LOG_KEY, JSON.stringify(log));
    } catch (_) {}
  }

  function getLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; }
  }

  return { isConnected, connect, disconnect, pushDate, pullMonth, syncMonth, getLog };

})();
