/* ════════════════════════════════════════════════════════════════════════════
   ops-core.js — shared foundation for the Hello Moving Operations app (/ops/).

   Standalone. Depends ONLY on:
     • ../js/config/env.js  → window.API_BASE, window.API_KEY   (deploy-injected)
     • ../js/lib/apiClient.js (optional; we also carry a self-contained fetch path)

   Reuses the EXISTING backend only (hm-api/*.php). No booking/pricing/slot logic
   is duplicated or modified here — this layer READS via rest.php / availability.php
   and, for chat, appends inbox_messages rows exactly like the admin Inbox does.

   Exposes window.Ops = { cfg, util, Auth, Api, Notify, UI, ready }.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var Ops = (window.Ops = window.Ops || {});

  /* ── Config ─────────────────────────────────────────────────────────────── */
  var cfg = (Ops.cfg = {
    base: String(window.API_BASE || (window.location.origin + '/hm-api')).replace(/\/+$/, ''),
    key:  window.API_KEY || '',
    POLL_MS: 15000,
  });

  /* ── Util ───────────────────────────────────────────────────────────────── */
  var util = (Ops.util = {
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    initials: function (name) {
      var n = String(name || '').trim();
      if (!n) return '?';
      var ch = n.charAt(0);
      return ch.toUpperCase();
    },
    todayStr: function (d) {
      d = d || new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },
    fmtDate: function (s) {
      if (!s) return '—';
      var d = new Date(String(s).replace(' ', 'T'));
      if (isNaN(d)) return String(s);
      return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    },
    fmtDateFull: function (s) {
      if (!s) return '—';
      var d = new Date(String(s).replace(' ', 'T'));
      if (isNaN(d)) return String(s);
      var wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + wd + '）';
    },
    fmtTime: function (s) {
      if (!s) return '';
      var d = new Date(String(s).replace(' ', 'T'));
      if (isNaN(d)) return '';
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    },
    relTime: function (s) {
      if (!s) return '';
      var d = new Date(String(s).replace(' ', 'T'));
      if (isNaN(d)) return '';
      var diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return 'たった今';
      if (diff < 3600) return Math.floor(diff / 60) + '分前';
      if (diff < 86400) return Math.floor(diff / 3600) + '時間前';
      if (diff < 604800) return Math.floor(diff / 86400) + '日前';
      return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    },
    debounce: function (fn, ms) {
      var t;
      return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms || 250); };
    },
  });

  /* Status maps — mirror js/services/apiAdapter.js (single source of truth for the
     DB⇄label translation). English is stored; Japanese is displayed. */
  var BK_TO_LOCAL = { pending: '新規', checking: '確認中', confirmed: '確定', completed: '完了', cancelled: 'キャンセル', rejected: '却下', needs_revision: '要修正' };
  var BK_TO_DB    = { '新規': 'pending', '確認中': 'checking', '確定': 'confirmed', '完了': 'completed', 'キャンセル': 'cancelled', '却下': 'rejected', '要修正': 'needs_revision' };
  Ops.STATUSES = ['新規', '確認中', '確定', '完了', 'キャンセル'];
  Ops.statusClass = function (jp) {
    return { '新規': 'st-new', '確認中': 'st-check', '確定': 'st-confirm', '完了': 'st-done', 'キャンセル': 'st-cancel', '却下': 'st-reject', '要修正': 'st-check' }[jp] || 'st-done';
  };
  Ops.toDbStatus = function (jp) { return BK_TO_DB[jp] || 'pending'; };

  /* Notes unpacking — mirrors apiAdapter._unpackBookingNotes so the ops app shows
     the same ref / service / addresses the admin panel shows. Read-only. */
  var HM_SEP = '\n[HM_EXTRAS]\n';
  function unpackNotes(raw) {
    raw = raw || '';
    var idx = raw.indexOf(HM_SEP);
    var userNotes = idx >= 0 ? raw.slice(0, idx) : raw;
    var block = idx >= 0 ? raw.slice(idx + HM_SEP.length) : '';
    var extra = {};
    block.split('\n').forEach(function (line) {
      var c = line.indexOf(':');
      if (c > 0) extra[line.slice(0, c).trim()] = line.slice(c + 1).trim();
    });
    return { userNotes: userNotes, extra: extra };
  }
  function normalizeBooking(r) {
    var u = unpackNotes(r.notes);
    var e = u.extra;
    return {
      dbId: r.id,
      ref: e.ref || String(r.id).slice(0, 8),
      name: r.customer_name || 'お客様',
      email: r.customer_email || '',
      phone: r.customer_phone || '',
      date: r.booking_date || '',
      fromAddr: e.from || '',
      toAddr: e.to || '',
      service: r.service_id || e.service || '',
      time: e.time || '',
      workers: e.workers || '',
      items: e.items ? e.items.split('|').filter(Boolean) : [],
      status: BK_TO_LOCAL[r.status] || '新規',
      statusRaw: r.status || 'pending',
      notes: u.userNotes || '',
      createdAt: r.created_at || '',
      startAt: r.start_at || null,
      endAt: r.end_at || null,
    };
  }
  Ops.normalizeBooking = normalizeBooking;

  /* ── Auth (reuses hm-api/admin-login.php; hybrid session + HMAC token) ─────
     Stores the admin token under ops-scoped keys so the app is independent of
     admin.html's session, and sets window.__HM_ADMIN_TOKEN so apiClient / our
     fetch path authorize rest.php admin operations. */
  var Auth = (Ops.Auth = {
    TOKEN: 'hm_ops_token', EXP: 'hm_ops_exp', USER: 'hm_ops_user',

    _get: function (k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    _set: function (k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    _del: function (k) { try { localStorage.removeItem(k); } catch (_) {} },

    restore: function () {
      var tok = this._get(this.TOKEN);
      var exp = parseInt(this._get(this.EXP) || '0', 10);
      if (tok && exp && exp * 1000 > Date.now()) {
        window.__HM_ADMIN_TOKEN = tok;
        return true;
      }
      this.clear();
      return false;
    },
    user: function () { try { return JSON.parse(this._get(this.USER) || 'null'); } catch (_) { return null; } },
    isValid: function () {
      var exp = parseInt(this._get(this.EXP) || '0', 10);
      return !!(this._get(this.TOKEN) && exp && exp * 1000 > Date.now());
    },
    clear: function () {
      this._del(this.TOKEN); this._del(this.EXP); this._del(this.USER);
      window.__HM_ADMIN_TOKEN = null;
    },
    login: function (email, password) {
      var self = this;
      return fetch(cfg.base + '/admin-login.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': cfg.key },
        credentials: 'include',
        body: JSON.stringify({ action: 'login', email: email, password: password }),
      }).then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (j) {
          if (!j || !j.ok || !j.data || !j.data.token) {
            var msg = (j && j.error && (j.error.message || j.error)) || 'ログインに失敗しました';
            return { ok: false, error: String(msg) };
          }
          var d = j.data;
          self._set(self.TOKEN, d.token);
          self._set(self.EXP, String(d.exp || 0));
          self._set(self.USER, JSON.stringify(d.user || { email: email }));
          window.__HM_ADMIN_TOKEN = d.token;
          return { ok: true, mustChange: !!d.mustChange, user: d.user };
        })
        .catch(function () { return { ok: false, error: 'サーバーに接続できません' }; });
    },
    logout: function () {
      var self = this;
      fetch(cfg.base + '/admin-logout.php', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': cfg.key, 'X-ADMIN-TOKEN': window.__HM_ADMIN_TOKEN || '' },
        body: JSON.stringify({ action: 'logout' }),
      }).catch(function () {}).then(function () {
        self.clear();
        window.location.reload();
      });
    },
  });

  /* ── API wrapper (rest.php + GET endpoints) ────────────────────────────── */
  function headers(json) {
    var h = json ? { 'Content-Type': 'application/json' } : {};
    if (cfg.key) h['X-API-KEY'] = cfg.key;
    if (window.__HM_ADMIN_TOKEN) h['X-ADMIN-TOKEN'] = window.__HM_ADMIN_TOKEN;
    return h;
  }
  function envelope(text, status) {
    var j = null;
    try { j = JSON.parse(text); } catch (_) {}
    if (!j) return { data: null, count: null, error: { message: 'HTTP ' + status } };
    return { data: 'data' in j ? j.data : null, count: 'count' in j ? j.count : null, error: j.error || null };
  }

  var Api = (Ops.Api = {
    rest: function (spec) {
      return fetch(cfg.base + '/rest.php', { method: 'POST', headers: headers(true), body: JSON.stringify(spec) })
        .then(function (r) { return r.text().then(function (t) { return envelope(t, r.status); }); })
        .catch(function (e) { return { data: null, error: { message: (e && e.message) || 'network', isNetwork: true } }; });
    },
    getJSON: function (path, query) {
      var qs = query ? ('?' + Object.keys(query).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&')) : '';
      return fetch(cfg.base + '/' + path + qs, { headers: headers(false) })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .catch(function () { return null; });
    },

    /* Bookings ------------------------------------------------------------- */
    listBookings: function (opts) {
      opts = opts || {};
      var spec = { table: 'bookings', action: 'select', columns: '*', order: [{ col: 'created_at', ascending: false }] };
      if (opts.limit) spec.limit = opts.limit;
      return Api.rest(spec).then(function (res) {
        if (res.error || !Array.isArray(res.data)) return { data: [], error: res.error };
        return { data: res.data.map(normalizeBooking), error: null };
      });
    },
    updateBookingStatus: function (dbId, jpStatus) {
      return Api.rest({
        table: 'bookings', action: 'update',
        values: { status: Ops.toDbStatus(jpStatus), updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') },
        filters: [{ col: 'id', op: 'eq', val: dbId }],
      });
    },

    /* Inbox / chat threads ------------------------------------------------- */
    listInbox: function () {
      return Api.rest({ table: 'inbox_messages', action: 'select', columns: '*', order: [{ col: 'created_at', ascending: false }], limit: 400 })
        .then(function (res) { return { data: Array.isArray(res.data) ? res.data : [], error: res.error }; });
    },
    /* Append a company reply into a booking's chat room — identical row shape to
       admin Inbox _directChatSend (labels.outbound + labels.chat). Requires the
       admin token (rest.php gates inbox_messages writes to staff). */
    sendChat: function (bookingId, text, ref, custEmail) {
      var uuid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(16).slice(2));
      var row = {
        id: uuid,
        sender: 'Hello Moving', sender_name: 'Hello Moving',
        email: custEmail || '',
        subject: 'チャット' + (ref ? '（予約番号 ' + ref + '）' : ''),
        body: text, body_text: text,
        booking_id: bookingId,
        mailbox: 'contact@hello-moving.com',
        message_id: '<chat-' + uuid + '@hello-moving.com>',
        thread_id: 'chat:' + bookingId,
        labels: { outbound: true, chat: true, ref: ref || '' },
        is_read: 1, status: 'open',
      };
      return Api.rest({ table: 'inbox_messages', action: 'insert', values: row }).then(function (res) {
        return { ok: !res.error, row: row, error: res.error };
      });
    },

    /* Calendar / availability --------------------------------------------- */
    availability: function (date) { return Api.getJSON('availability.php', { date: date }); },
  });

  /* ── Notifications (lightweight local store; push-ready shape) ──────────── */
  var Notify = (Ops.Notify = {
    STORE: 'hm_ops_notifs', SEEN_BK: 'hm_ops_seen_bk', SEEN_MSG: 'hm_ops_seen_msg', SEEN_ST: 'hm_ops_seen_status',
    MAX: 80,

    _read: function (k, def) { try { return JSON.parse(localStorage.getItem(k) || 'null') || def; } catch (_) { return def; } },
    _write: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },

    list: function () { return this._read(this.STORE, []); },
    unreadCount: function () { return this.list().filter(function (n) { return !n.read; }).length; },
    add: function (n) {
      var arr = this.list();
      if (arr.some(function (x) { return x.id === n.id; })) return false;
      arr.unshift(Object.assign({ read: false, ts: Date.now() }, n));
      if (arr.length > this.MAX) arr = arr.slice(0, this.MAX);
      this._write(this.STORE, arr);
      return true;
    },
    markAllRead: function () {
      var arr = this.list();
      arr.forEach(function (n) { n.read = true; });
      this._write(this.STORE, arr);
    },
    clear: function () { this._write(this.STORE, []); },

    /* Push-ready seam (no push service yet). A future Web Push / LINE integration
       registers a delivery transport here; add() will then also forward payloads to
       it. Kept as a no-op stub so page code never changes when push is enabled. */
    _transport: null,
    registerPush: function (fn) { this._transport = (typeof fn === 'function') ? fn : null; },

    /* Derive notifications from freshly-fetched data. First run just establishes a
       baseline (no notification spam for pre-existing rows). Returns how many new
       were added so callers can refresh the bell. */
    syncBookings: function (bookings) {
      var seen = this._read(this.SEEN_BK, null);
      var status = this._read(this.SEEN_ST, {});
      var ids = bookings.map(function (b) { return b.dbId; });
      var added = 0;
      if (seen === null) {
        this._write(this.SEEN_BK, ids);
        bookings.forEach(function (b) { status[b.dbId] = b.statusRaw; });
        this._write(this.SEEN_ST, status);
        return 0;
      }
      var seenSet = {}; seen.forEach(function (id) { seenSet[id] = 1; });
      bookings.forEach(function (b) {
        if (!seenSet[b.dbId]) {
          if (this.add({ id: 'bk-' + b.dbId, type: 'booking', title: '新規予約', text: b.name + '様 · ' + (b.service || 'ご予約') + ' · ' + Ops.util.fmtDate(b.date), link: 'bookings.html', ts: Date.parse((b.createdAt || '').replace(' ', 'T')) || Date.now() })) added++;
        } else if (status[b.dbId] && status[b.dbId] !== b.statusRaw) {
          if (this.add({ id: 'st-' + b.dbId + '-' + b.statusRaw, type: 'status', title: 'ステータス変更', text: b.name + '様 → ' + b.status, link: 'bookings.html' })) added++;
        }
        status[b.dbId] = b.statusRaw;
      }, this);
      this._write(this.SEEN_BK, ids);
      this._write(this.SEEN_ST, status);
      return added;
    },
    syncMessages: function (inboundRows) {
      var seen = this._read(this.SEEN_MSG, null);
      var ids = inboundRows.map(function (m) { return m.id; });
      var added = 0;
      if (seen === null) { this._write(this.SEEN_MSG, ids); return 0; }
      var seenSet = {}; seen.forEach(function (id) { seenSet[id] = 1; });
      inboundRows.forEach(function (m) {
        if (!seenSet[m.id]) {
          var who = m.sender_name || m.sender || m.email || 'お客様';
          var preview = (m.body_text || m.body || '').slice(0, 40);
          if (this.add({ id: 'msg-' + m.id, type: 'message', title: '新着メッセージ', text: who + '：' + preview, link: 'chat.html', ts: Date.parse((m.created_at || '').replace(' ', 'T')) || Date.now() })) added++;
        }
      }, this);
      this._write(this.SEEN_MSG, ids);
      return added;
    },
  });

  /* ── UI chrome & helpers ───────────────────────────────────────────────── */
  var ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
    bookings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    customers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    chevronL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    chevronR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  };
  Ops.ICONS = ICONS;

  var NAV = [
    { key: 'dashboard', href: 'index.html', label: 'ホーム', icon: 'dashboard' },
    { key: 'bookings', href: 'bookings.html', label: '予約', icon: 'bookings' },
    { key: 'customers', href: 'customers.html', label: '顧客', icon: 'customers' },
    { key: 'chat', href: 'chat.html', label: 'チャット', icon: 'chat' },
    { key: 'calendar', href: 'calendar.html', label: 'カレンダー', icon: 'calendar' },
  ];

  var UI = (Ops.UI = {
    icon: function (name) { return ICONS[name] || ''; },

    /* Injects the fixed top bar + bottom nav around the page's <main>. */
    mountChrome: function (opts) {
      opts = opts || {};
      var active = opts.active || 'dashboard';
      var title = opts.title || 'Hello Moving';
      var unread = Notify.unreadCount();

      var top = document.createElement('header');
      top.className = 'ops-top';
      top.innerHTML =
        '<div class="ops-top-inner">' +
          (opts.back ? '<button class="ops-back" aria-label="戻る" onclick="history.length>1?history.back():location.href=\'index.html\'">' + ICONS.back + '</button>'
                     : '<div class="ops-brand-dot">HM</div>') +
          '<h1>' + util.esc(title) + '</h1>' +
          '<button class="ops-bell" aria-label="通知" onclick="location.href=\'notifications.html\'">' + ICONS.bell +
            '<span class="ops-badge ' + (unread ? '' : 'ops-hide') + '" data-ops-bell>' + (unread > 99 ? '99+' : unread) + '</span>' +
          '</button>' +
        '</div>';

      var nav = document.createElement('nav');
      nav.className = 'ops-nav';
      var msgBadge = opts.navBadge && opts.navBadge.chat ? opts.navBadge.chat : 0;
      nav.innerHTML = '<div class="ops-nav-inner">' + NAV.map(function (n) {
        var badge = (n.key === 'chat' && msgBadge) ? '<span class="ops-nav-badge">' + (msgBadge > 9 ? '9+' : msgBadge) + '</span>' : '';
        return '<a href="' + n.href + '" class="' + (n.key === active ? 'active' : '') + '">' + ICONS[n.icon] + badge + '<span>' + n.label + '</span></a>';
      }).join('') + '</div>';

      document.body.insertBefore(top, document.body.firstChild);
      document.body.appendChild(nav);
    },

    setBell: function (n) {
      var el = document.querySelector('[data-ops-bell]');
      if (!el) return;
      if (n > 0) { el.textContent = n > 99 ? '99+' : n; el.classList.remove('ops-hide'); }
      else el.classList.add('ops-hide');
    },

    statusBadge: function (jp) {
      return '<span class="ops-badge-status ' + Ops.statusClass(jp) + '">' + util.esc(jp) + '</span>';
    },

    skeleton: function (n) {
      var s = '';
      for (var i = 0; i < (n || 4); i++) s += '<div class="ops-skel ops-skel-row"></div>';
      return s;
    },
    empty: function (title, sub, icon) {
      return '<div class="ops-empty">' + (ICONS[icon] || ICONS.empty) + '<h3>' + util.esc(title) + '</h3><p>' + util.esc(sub || '') + '</p></div>';
    },

    toast: function (msg) {
      var wrap = document.querySelector('.ops-toast-wrap');
      if (!wrap) { wrap = document.createElement('div'); wrap.className = 'ops-toast-wrap'; document.body.appendChild(wrap); }
      var t = document.createElement('div');
      t.className = 'ops-toast';
      t.textContent = msg;
      wrap.appendChild(t);
      requestAnimationFrame(function () { t.classList.add('show'); });
      setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 2600);
    },

    /* Reusable bottom sheet. Returns { open, close, el }. */
    sheet: function () {
      var bd = document.createElement('div'); bd.className = 'ops-sheet-backdrop';
      var sh = document.createElement('div'); sh.className = 'ops-sheet';
      bd.appendChild(sh);
      document.body.appendChild(bd);
      function close() { sh.classList.remove('open'); bd.classList.remove('open'); }
      bd.addEventListener('click', function (e) { if (e.target === bd) close(); });
      return {
        el: sh,
        open: function (html) { sh.innerHTML = '<div class="ops-sheet-grip"></div>' + html; bd.classList.add('open'); requestAnimationFrame(function () { sh.classList.add('open'); }); },
        close: close,
      };
    },
  });

  /* ── Login overlay ─────────────────────────────────────────────────────── */
  function showLogin(onDone) {
    var ov = document.createElement('div');
    ov.className = 'ops-login';
    ov.innerHTML =
      '<div class="ops-login-card">' +
        '<div class="ops-login-logo">HM</div>' +
        '<h1>オペレーション</h1>' +
        '<p>Hello Moving 業務アプリ</p>' +
        '<input id="ops-li-email" type="email" inputmode="email" autocomplete="username" placeholder="メールアドレス" />' +
        '<input id="ops-li-pass" type="password" autocomplete="current-password" placeholder="パスワード" />' +
        '<p class="ops-login-err" id="ops-li-err"></p>' +
        '<button class="ops-btn" id="ops-li-btn">ログイン</button>' +
      '</div>';
    document.body.appendChild(ov);
    var btn = ov.querySelector('#ops-li-btn');
    var err = ov.querySelector('#ops-li-err');
    function submit() {
      var email = ov.querySelector('#ops-li-email').value.trim();
      var pass = ov.querySelector('#ops-li-pass').value;
      if (!email || !pass) { err.textContent = 'メールとパスワードを入力してください'; return; }
      btn.disabled = true; btn.innerHTML = '<span class="ops-spin"></span>';
      Auth.login(email, pass).then(function (r) {
        btn.disabled = false; btn.textContent = 'ログイン';
        if (!r.ok) { err.textContent = r.error || 'ログインに失敗しました'; return; }
        if (r.mustChange) { err.textContent = '初回パスワード変更が必要です。管理画面で設定してください。'; Auth.clear(); return; }
        ov.remove();
        onDone();
      });
    }
    btn.addEventListener('click', submit);
    ov.querySelector('#ops-li-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }

  /* ── Boot: guard auth, then run the page initializer ───────────────────── */
  Ops.ready = function (init) {
    function start() {
      if (Auth.restore()) { init(); }
      else { showLogin(function () { init(); }); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  };

  // Keep window.__HM_ADMIN_TOKEN populated as early as possible.
  Auth.restore();
})();
