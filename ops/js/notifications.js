/* ════════════════════════════════════════════════════════════════════════════
   notifications.js — M6 Notification Center (/ops/notifications.html)

   A complete center over the SHARED Ops.Notify store (localStorage). It reuses
   the booking/message/status notifications the rest of the app already derives,
   and ADDS the types those don't cover — booking updated (field fingerprint),
   cancelled, reminder (tomorrow), calendar (today's schedule) and system — all
   from the existing rest.php reads. Read/unread · mark-all · archive · delete ·
   tabs · filters · search · detail modal with actions · settings (enable/disable
   per type) · live nav badges · a push-adapter layer (browser now; LINE / mobile
   are structural stubs). Polling only; no websocket. Ops.Notify is not modified.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, Api = Ops.Api, N = Ops.Notify;

  /* ── Settings (per-device) ─────────────────────────────────────────────── */
  var SET_KEY = 'hm_ops_notif_settings', FP_KEY = 'hm_ops_notif_fp', PUSH_KEY = 'hm_ops_push_seen';
  var SET_DEF = { booking: true, changes: true, messages: true, reminders: true, system: true };
  function loadSet() { try { return Object.assign({}, SET_DEF, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (_) { return Object.assign({}, SET_DEF); } }
  function saveSet(s) { try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch (_) {} }
  var S = loadSet();

  var state = { tab: 'all', scope: 'all', highOnly: false, showArchived: false, q: '', bookings: {}, inbox: {}, sheet: null, setSheet: null, poll: null };

  /* ── Local date helpers ────────────────────────────────────────────────── */
  function fmt(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  /* ── Store ops (operate on the shared Ops.Notify localStorage array) ────── */
  function all() { return N.list(); }
  function writeAll(arr) { try { localStorage.setItem(N.STORE, JSON.stringify(arr)); } catch (_) {} }
  function mutate(id, fn) { var a = all(), n = a.filter(function (x) { return x.id === id; })[0]; if (n) { fn(n); writeAll(a); } }
  function setRead(id, v) { mutate(id, function (n) { n.read = v; }); }
  function setArchived(id, v) { mutate(id, function (n) { n.archived = v; }); }
  function removeOne(id) { writeAll(all().filter(function (x) { return x.id !== id; })); }
  function markAllRead() { var a = all(); a.forEach(function (n) { if (visibleCat(meta(n).cat)) n.read = true; }); writeAll(a); }

  /* ── Type metadata / classification ────────────────────────────────────── */
  var MAP = {
    booking:  { cat: 'booking', icon: 'bookings', pr: 'high',   label: '新しい予約' },
    update:   { cat: 'booking', icon: 'clock',    pr: 'normal', label: '予約変更' },
    status:   { cat: 'booking', icon: 'clock',    pr: 'normal', label: '予約変更' },
    cancel:   { cat: 'booking', icon: 'bell',     pr: 'high',   label: '予約キャンセル' },
    message:  { cat: 'message', icon: 'chat',     pr: 'normal', label: '新しいメッセージ' },
    reminder: { cat: 'booking', icon: 'clock',    pr: 'normal', label: 'リマインダー' },
    calendar: { cat: 'booking', icon: 'calendar', pr: 'normal', label: '本日の予定' },
    system:   { cat: 'system',  icon: 'settings', pr: 'low',    label: 'システム通知' },
  };
  function typeKey(n) {
    var id = n.id || '', t = n.type || '';
    if (!t) { t = id.indexOf('bk-') === 0 ? 'booking' : id.indexOf('st-') === 0 ? 'status' : id.indexOf('msg-') === 0 ? 'message' : 'system'; }
    if ((t === 'status' || t === 'cancel') && /キャンセル/.test(n.text || n.title || '')) return 'cancel';
    return t;
  }
  function meta(n) {
    var k = typeKey(n), m = MAP[k] || MAP.system;
    // Canonical label per type (spec) — only system keeps a custom stored title.
    var label = (k === 'system' && n.title) ? n.title : m.label;
    return { key: k, cat: m.cat, icon: m.icon, priority: n.priority || m.pr, label: label };
  }
  function setKeyFor(cat, key) { return key === 'booking' ? 'booking' : (key === 'update' || key === 'status' || key === 'cancel') ? 'changes' : cat === 'message' ? 'messages' : (key === 'reminder' || key === 'calendar') ? 'reminders' : 'system'; }
  function enabled(n) { var mk = meta(n); return S[setKeyFor(mk.cat, mk.key)] !== false; }

  function dbIdOf(n) {
    if (n.dbId) return n.dbId;
    var id = n.id || '', m;
    if ((m = /^bk-(.+)$/.exec(id))) return m[1];
    if ((m = /^st-(.+)-[a-z_]+$/.exec(id))) return m[1];
    if (id.indexOf('msg-') === 0) { var row = state.inbox[id.slice(4)]; return row ? row.booking_id : null; }
    return null;
  }
  function relatedBooking(n) { var id = dbIdOf(n); return id ? state.bookings[id] : null; }

  /* ── Derivation of the extra types (from existing reads) ────────────────── */
  function hashStr(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return (h >>> 0).toString(36); }
  function timeOf(b) {
    if (b.startAt) { var d = new Date(String(b.startAt).replace(' ', 'T')); if (!isNaN(d)) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
    return (b.time && String(b.time).match(/\d{1,2}:\d{2}/) || ['時刻未定'])[0];
  }
  function derive(list) {
    var today = U.todayStr(), tomorrow = fmt(addDays(new Date(), 1));
    var fps; try { fps = JSON.parse(localStorage.getItem(FP_KEY) || '{}'); } catch (_) { fps = {}; }
    var firstFp = !Object.keys(fps).length;
    list.forEach(function (b) {
      if (b.status === 'キャンセル' || !b.date) return;
      if (b.date === today && S.reminders) N.add({ id: 'cal-' + b.dbId + '-' + b.date, type: 'calendar', title: '本日の予定', text: timeOf(b) + ' ' + b.name + '様' + (b.service ? ' · ' + b.service : ''), ts: Date.now(), dbId: b.dbId, ref: b.ref });
      if (b.date === tomorrow && S.reminders) N.add({ id: 'rem-' + b.dbId + '-' + b.date, type: 'reminder', title: 'リマインダー', text: '明日の引越しがあります：' + b.name + '様 ' + timeOf(b), ts: Date.now(), dbId: b.dbId, ref: b.ref, priority: 'high' });
      var fp = [b.date, b.fromAddr, b.toAddr, (b.items || []).join(','), b.notes].join('|');
      if (!firstFp && fps[b.dbId] !== undefined && fps[b.dbId] !== fp && S.changes) {
        N.add({ id: 'upd-' + b.dbId + '-' + hashStr(fp), type: 'update', title: '予約変更', text: b.name + '様の予約内容が更新されました（日付・住所・荷物・備考）', ts: Date.now(), dbId: b.dbId, ref: b.ref });
      }
      fps[b.dbId] = fp;
    });
    try { localStorage.setItem(FP_KEY, JSON.stringify(fps)); } catch (_) {}
  }
  function systemNote(id, title, text, pr) { if (S.system) N.add({ id: id, type: 'system', title: title, text: text, ts: Date.now(), priority: pr || 'low' }); }

  /* ── Push adapter layer (browser now; LINE / mobile structural) ─────────── */
  var Push = {
    t: { browser: false, line: false, mobile: false },
    browserReady: function () { return typeof window.Notification !== 'undefined'; },
    browserGranted: function () { return this.browserReady() && window.Notification.permission === 'granted'; },
    enableBrowser: function () {
      if (!this.browserReady()) return Promise.resolve(false);
      return window.Notification.requestPermission().then(function (p) { Push.t.browser = (p === 'granted'); return Push.t.browser; });
    },
    deliver: function (n) {
      if (this.browserGranted() && Push.t.browser !== false) { try { new window.Notification(n.title || '通知', { body: n.text || '', tag: n.id }); } catch (_) {} }
      if (this.t.line) this.sendLine(n);       // future: POST to an hm-api LINE-push endpoint
      if (this.t.mobile) this.sendMobile(n);   // future: native bridge
    },
    sendLine: function () { /* structural stub — no backend yet */ },
    sendMobile: function () { /* structural stub — mobile push not built yet */ },
    /* Deliver any brand-new, unread, enabled notifications through the transports
       exactly once (tracked by id) — the seam future push services plug into. */
    flush: function () {
      var seen; try { seen = JSON.parse(localStorage.getItem(PUSH_KEY) || '[]'); } catch (_) { seen = []; }
      var set = {}; seen.forEach(function (id) { set[id] = 1; });
      all().forEach(function (n) { if (!n.read && !set[n.id] && enabled(n)) { Push.deliver(n); set[n.id] = 1; } });
      try { localStorage.setItem(PUSH_KEY, JSON.stringify(Object.keys(set).slice(-200))); } catch (_) {}
    },
  };
  N.registerPush(function (n) { Push.deliver(n); });

  /* ── View model ────────────────────────────────────────────────────────── */
  function visibleCat(cat) { return state.tab === 'all' || state.tab === 'unread' || state.tab === cat; }
  function view() {
    var q = state.q.trim().toLowerCase();
    var now = new Date();
    return all().filter(function (n) {
      if (!enabled(n)) return false;
      if (!!n.archived !== state.showArchived) return false;
      var mk = meta(n);
      if (state.tab === 'unread') { if (n.read) return false; }
      else if (state.tab !== 'all' && mk.cat !== state.tab) return false;
      if (state.highOnly && mk.priority !== 'high') return false;
      if (state.scope !== 'all') {
        var d = new Date(n.ts);
        if (state.scope === 'today' && !sameDay(d, now)) return false;
        if (state.scope === 'week') { var ws = addDays(now, -now.getDay()); ws.setHours(0, 0, 0, 0); if (d < ws || d >= addDays(ws, 7)) return false; }
        if (state.scope === 'month' && !(d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth())) return false;
      }
      if (q) {
        var b = relatedBooking(n);
        var hay = (n.title + ' ' + (n.text || '') + ' ' + (n.ref || '') + ' ' + (b ? b.name + ' ' + b.ref : '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  }
  function unreadByCat() {
    var c = { all: 0, booking: 0, message: 0, system: 0 };
    all().forEach(function (n) { if (n.read || n.archived || !enabled(n)) return; var m = meta(n); c.all++; if (c[m.cat] != null) c[m.cat]++; });
    return c;
  }

  /* ── Render ────────────────────────────────────────────────────────────── */
  var TABS = [{ k: 'all', l: 'すべて' }, { k: 'unread', l: '未読' }, { k: 'booking', l: '予約' }, { k: 'message', l: 'メッセージ' }, { k: 'system', l: 'システム' }];
  var SCOPES = [{ k: 'all', l: 'すべて' }, { k: 'today', l: '今日' }, { k: 'week', l: '今週' }, { k: 'month', l: '今月' }];

  function card(n) {
    var m = meta(n), b = relatedBooking(n);
    var desc = n.text || (b ? b.ref : '');
    return '<div class="nc-card' + (n.read ? '' : ' unread') + (m.priority === 'high' && !n.read ? ' high' : '') + '" data-id="' + U.esc(n.id) + '">' +
      '<div class="nc-ico ntype-' + m.key + '">' + UI.icon(m.icon) + '</div>' +
      '<div class="nc-main">' +
        '<div class="nc-top"><span class="nc-title">' + U.esc(m.label) + '</span><span class="nc-time">' + U.relTime(new Date(n.ts).toISOString()) + '</span></div>' +
        '<div class="nc-desc">' + U.esc(desc) + '</div>' +
        (m.priority === 'high' ? '<span class="nc-pri">重要</span>' : '') +
      '</div>' +
      (n.read ? '' : '<span class="nc-dot"></span>') +
    '</div>';
  }

  function render() {
    var el = document.getElementById('ops-content');
    var cnt = unreadByCat();
    var list = view();

    el.innerHTML =
      '<div class="nc-tabs">' + TABS.map(function (t) {
        var badge = (t.k === 'unread' && cnt.all) ? '<span class="nc-tn">' + cnt.all + '</span>'
          : (cnt[t.k] ? '<span class="nc-tn">' + cnt[t.k] + '</span>' : '');
        return '<button class="nc-tab' + (state.tab === t.k ? ' active' : '') + '" data-tab="' + t.k + '">' + t.l + badge + '</button>';
      }).join('') + '</div>' +
      '<div class="nc-search">' + UI.icon('search') + '<input id="nc-q" type="search" placeholder="予約ID・顧客名・本文で検索" autocomplete="off" /></div>' +
      '<div class="nc-bar">' +
        SCOPES.map(function (s) { return '<button class="nc-chip' + (state.scope === s.k ? ' active' : '') + '" data-scope="' + s.k + '">' + s.l + '</button>'; }).join('') +
        '<button class="nc-chip' + (state.highOnly ? ' active' : '') + '" id="nc-high">高優先</button>' +
        '<span class="sp"></span>' +
        '<button class="nc-iconbtn" id="nc-settings" aria-label="設定">' + UI.icon('settings') + '</button>' +
      '</div>' +
      '<div class="nc-bar" style="margin-top:-4px">' +
        '<button class="nc-chip' + (state.showArchived ? ' active' : '') + '" id="nc-arch">' + (state.showArchived ? 'アーカイブ表示中' : 'アーカイブ') + '</button>' +
        '<span class="sp"></span>' +
        (cnt.all ? '<button class="nc-chip" id="nc-readall">すべて既読</button>' : '') +
      '</div>' +
      (list.length ? '<div class="nc-list">' + list.map(card).join('') + '</div>'
                   : UI.empty(state.showArchived ? 'アーカイブはありません' : '通知はありません', '新しい予約・メッセージ・リマインダーがここに表示されます', 'bell'));

    // Wire
    el.querySelectorAll('[data-tab]').forEach(function (t) { t.addEventListener('click', function () { state.tab = t.getAttribute('data-tab'); render(); }); });
    el.querySelectorAll('[data-scope]').forEach(function (t) { t.addEventListener('click', function () { state.scope = t.getAttribute('data-scope'); render(); }); });
    var q = document.getElementById('nc-q'); q.value = state.q;
    q.addEventListener('input', U.debounce(function () { state.q = q.value; render(); }, 200));
    document.getElementById('nc-high').addEventListener('click', function () { state.highOnly = !state.highOnly; render(); });
    document.getElementById('nc-arch').addEventListener('click', function () { state.showArchived = !state.showArchived; render(); });
    document.getElementById('nc-settings').addEventListener('click', openSettings);
    var ra = document.getElementById('nc-readall'); if (ra) ra.addEventListener('click', function () { markAllRead(); UI.toast('すべて既読にしました'); refreshBadges(); render(); });
    el.querySelectorAll('[data-id]').forEach(function (c) { c.addEventListener('click', function () { openDetail(c.getAttribute('data-id')); }); });

    refreshBadges();
  }

  /* ── Detail modal ──────────────────────────────────────────────────────── */
  function kv(k, v) { return v ? '<div class="nc-kv"><span class="k">' + k + '</span><span class="v">' + U.esc(v) + '</span></div>' : ''; }
  function openDetail(id) {
    var n = all().filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    if (!n.read) { setRead(id, true); refreshBadges(); }
    var m = meta(n), b = relatedBooking(n);
    var actions = '';
    if (m.cat === 'booking') {
      if (b) actions += '<a class="ops-btn ghost" href="bookings.html?ref=' + encodeURIComponent(b.ref) + '">' + UI.icon('bookings') + '予約を開く</a>' +
                        '<a class="ops-btn ghost" href="customers.html">' + UI.icon('customers') + '顧客</a>';
      if (m.key === 'reminder' || m.key === 'calendar') actions += '<a class="ops-btn ghost" href="calendar.html">' + UI.icon('calendar') + 'カレンダー</a>';
    } else if (m.cat === 'message') {
      actions += '<a class="ops-btn" href="message.html?' + (b ? 'booking=' + encodeURIComponent(b.dbId) + '&ref=' + encodeURIComponent(b.ref) : 'id=' + encodeURIComponent(dbIdOf(n) || '')) + '">' + UI.icon('chat') + 'チャットを開く</a>';
    } else {
      actions += '<button class="ops-btn ghost" id="nc-log">' + UI.icon('clock') + 'ログを確認</button>';
    }

    var html =
      '<h2>' + U.esc(m.label) + (m.priority === 'high' ? ' <span class="nc-pri">重要</span>' : '') + '</h2>' +
      '<div class="ops-muted" style="margin:0 0 12px;font-size:.84rem">' + U.esc(U.fmtDateFull(new Date(n.ts).toISOString())) + ' · ' + U.relTime(new Date(n.ts).toISOString()) + '</div>' +
      '<div class="ops-card" style="margin:0 0 12px;padding:10px 14px;font-size:.92rem">' + U.esc(n.text || '（詳細なし）') + '</div>' +
      (b ? '<div class="ops-section-title" style="margin:4px 2px 8px">関連予約</div><div class="ops-card" style="margin:0 0 12px;padding:4px 14px">' +
            kv('受付番号', b.ref) + kv('お客様', b.name ? b.name + '様' : '') + kv('サービス', b.service) + kv('引越し日', U.fmtDateFull(b.date)) +
            kv('電話', b.phone) + kv('メール', b.email) + '</div>' : '') +
      (actions ? '<div class="ops-btn-row" style="margin-top:6px">' + actions + '</div>' : '') +
      '<div class="ops-btn-row" style="margin-top:8px">' +
        '<button class="ops-btn ghost" data-act="toggle">' + (n.read ? '未読にする' : '既読にする') + '</button>' +
        '<button class="ops-btn ghost" data-act="archive">' + (n.archived ? 'アーカイブ解除' : 'アーカイブ') + '</button>' +
      '</div>' +
      '<div class="ops-btn-row" style="margin-top:8px">' +
        '<button class="ops-btn ghost nc-danger" data-act="delete">削除</button>' +
      '</div>';

    state.sheet.open(html);
    var el = state.sheet.el;
    var lg = el.querySelector('#nc-log'); if (lg) lg.addEventListener('click', function () { UI.toast('システムログは管理画面で確認できます'); });
    el.querySelector('[data-act="toggle"]').addEventListener('click', function () { setRead(id, !n.read); state.sheet.close(); refreshBadges(); render(); });
    el.querySelector('[data-act="archive"]').addEventListener('click', function () { setArchived(id, !n.archived); state.sheet.close(); UI.toast(n.archived ? 'アーカイブを解除しました' : 'アーカイブしました'); refreshBadges(); render(); });
    el.querySelector('[data-act="delete"]').addEventListener('click', function () { if (confirm('この通知を削除しますか？')) { removeOne(id); state.sheet.close(); refreshBadges(); render(); } });
  }

  /* ── Settings sheet ────────────────────────────────────────────────────── */
  function swRow(key, title, sub) {
    return '<div class="nc-set-row"><div class="l"><b>' + title + '</b><span>' + sub + '</span></div>' +
      '<label class="nc-sw"><input type="checkbox" data-set="' + key + '"' + (S[key] ? ' checked' : '') + ' /><i></i></label></div>';
  }
  function openSettings() {
    var pushLabel = Push.browserGranted() ? 'ブラウザ通知：有効' : (Push.browserReady() ? 'ブラウザ通知を有効にする' : 'ブラウザ通知は非対応');
    var html =
      '<h2>通知設定</h2>' +
      '<div class="ops-card" style="margin:0 0 14px;padding:2px 14px">' +
        swRow('booking', '新しい予約', '新規予約が入ったとき') +
        swRow('changes', '予約の変更', '日付・住所・荷物・キャンセル') +
        swRow('messages', 'メッセージ', 'お客様からの新着メッセージ') +
        swRow('reminders', 'リマインダー・予定', '本日／明日の引越し') +
        swRow('system', 'システム通知', 'デプロイ・障害・警告') +
      '</div>' +
      '<div class="ops-section-title" style="margin:4px 2px 8px">プッシュ通知</div>' +
      '<div class="ops-btn-row"><button class="ops-btn ghost" id="nc-push"' + (Push.browserReady() && !Push.browserGranted() ? '' : ' disabled') + '>' + UI.icon('bell') + pushLabel + '</button></div>' +
      '<p class="ops-muted" style="font-size:.76rem;margin:8px 2px 0">LINE通知・モバイルプッシュは今後対応予定です（アダプター実装済み）。</p>';

    state.setSheet.open(html);
    var el = state.setSheet.el;
    el.querySelectorAll('[data-set]').forEach(function (cb) {
      cb.addEventListener('change', function () { S[cb.getAttribute('data-set')] = cb.checked; saveSet(S); refreshBadges(); render(); });
    });
    var pb = el.querySelector('#nc-push');
    if (pb && !pb.disabled) pb.addEventListener('click', function () { Push.enableBrowser().then(function (ok) { UI.toast(ok ? 'ブラウザ通知を有効にしました' : '通知が許可されませんでした'); openSettings(); }); });
  }

  /* ── Live badges (bell + bottom nav) ───────────────────────────────────── */
  function refreshBadges() {
    var c = unreadByCat();
    UI.setBell(c.all);
    var links = document.querySelectorAll('.ops-nav a');   // [0]home [1]bookings [2]customers [3]chat [4]calendar
    setNavBadge(links[0], c.all);
    setNavBadge(links[1], c.booking);
    setNavBadge(links[3], c.message);
    setNavBadge(links[4], all().filter(function (n) { if (n.read || n.archived || !enabled(n)) return false; var k = typeKey(n); return k === 'reminder' || k === 'calendar'; }).length);
  }
  function setNavBadge(a, n) {
    if (!a) return;
    var old = a.querySelector('.ops-nav-badge'); if (old) old.remove();
    if (n > 0) { var s = document.createElement('span'); s.className = 'ops-nav-badge'; s.textContent = n > 9 ? '9+' : n; a.appendChild(s); }
  }

  /* ── Sync (poll existing reads → derive → render) ──────────────────────── */
  function sync(first) {
    Promise.all([Api.listBookings(), Api.listInbox()]).then(function (r) {
      var bookings = r[0].data || [];
      var inboxRows = r[1].data || [];
      if (r[0].error && !bookings.length && r[1].error && !inboxRows.length) {
        systemNote('sys-conn-' + U.todayStr(), 'システム通知', 'サーバーに接続できませんでした。接続を確認してください。', 'high');
      }
      state.bookings = {}; bookings.forEach(function (b) { state.bookings[b.dbId] = b; });
      state.inbox = {}; inboxRows.forEach(function (m) { state.inbox[m.id] = m; });
      var inbound = inboxRows.filter(function (m) { var l = m.labels || {}; if (typeof l === 'string') { try { l = JSON.parse(l); } catch (_) { l = {}; } } return !l.outbound; });

      // Reuse the app's shared derivation for booking/message/status …
      if (S.booking || S.changes) N.syncBookings(bookings);
      if (S.messages) N.syncMessages(inbound);
      // … then add the types it doesn't cover.
      derive(bookings);
      if (first) systemNote('sys-welcome', 'システム通知', '通知センターが有効になりました。', 'low');

      Push.flush();
      render();
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: '', title: '通知センター', back: true });
    state.sheet = UI.sheet();
    state.setSheet = UI.sheet();
    render();          // instant paint from local store
    sync(true);        // refresh + derive from server
    state.poll = setInterval(function () { sync(false); }, Ops.cfg.POLL_MS);
  });
})();
