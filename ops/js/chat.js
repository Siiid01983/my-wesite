/* ════════════════════════════════════════════════════════════════════════════
   chat.js — M4 Chat (/ops/chat.html)

   Conversation list · unread badges · open conversation · send · realtime refresh.
   Reuses the EXISTING backend messaging store (inbox_messages) exactly like the
   admin Inbox: reads via rest.php, and a company reply is appended as an
   inbox_messages row (labels.outbound + labels.chat) into thread 'chat:<bookingId>'
   — identical to inbox.js _directChatSend. No new messaging system is created.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, Api = Ops.Api;

  var state = { convs: [], byKey: {}, bookings: {}, openKey: null, screen: null, poll: null };

  /* Numeric (epoch-ms) sort key for a timestamp. NEVER sort messages lexically:
     raw ts values mix MySQL 'YYYY-MM-DD HH:MM:SS' with ISO '…T…Z', and space<'T'
     so a string sort orders by format, not time (root cause of out-of-order
     messages). Delegates to the shared JST-aware parser (HMFmt.tsMs). */
  function tsMs(v) {
    if (window.HMFmt && HMFmt.tsMs) return HMFmt.tsMs(v);
    var d = new Date(String(v || '').replace(' ', 'T'));
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  function parseLabels(m) {
    var l = m.labels || {};
    if (typeof l === 'string') { try { l = JSON.parse(l); } catch (_) { l = {}; } }
    return l || {};
  }

  function normMsg(m) {
    var l = parseLabels(m);
    var out = !!l.outbound;
    return {
      id: m.id, out: out,
      name: m.sender_name || m.sender || (out ? 'Hello Moving' : (m.email || t('common.customer'))),
      text: l.deleted ? '' : (m.body_text || m.body || ''),
      deleted: !!l.deleted,
      channel: out ? (l.chat ? 'chat' : 'email') : 'chat',
      ts: m.received_at || m.created_at || '',
      read: (m.is_read === true || m.is_read === 1),
    };
  }

  function build(inboxRows, bookings) {
    var bmap = {};
    bookings.forEach(function (b) { bmap[b.dbId] = b; });
    state.bookings = bmap;

    var groups = {};
    inboxRows.forEach(function (m) {
      var l = parseLabels(m);
      var key = m.booking_id || m.thread_id || m.message_id || m.id;
      if (!groups[key]) groups[key] = { key: key, bookingId: m.booking_id || '', ref: l.ref || '', rows: [] };
      groups[key].rows.push(m);
      if (!groups[key].ref && l.ref) groups[key].ref = l.ref;
      if (!groups[key].bookingId && m.booking_id) groups[key].bookingId = m.booking_id;
    });

    var convs = Object.keys(groups).map(function (k) {
      var g = groups[k];
      var msgs = g.rows.map(normMsg).sort(function (a, b) { return tsMs(a.ts) - tsMs(b.ts); });
      var bk = state.bookings[g.bookingId];
      var custEmail = '';
      g.rows.forEach(function (m) { var l = parseLabels(m); if (!l.outbound && m.email && !custEmail) custEmail = m.email; });
      var name = (bk && bk.name) || '';
      if (!name) { for (var i = 0; i < msgs.length; i++) { if (!msgs[i].out) { name = msgs[i].name; break; } } }
      var last = msgs[msgs.length - 1] || { text: '', ts: '' };
      return {
        key: k, bookingId: g.bookingId, ref: g.ref || (bk && bk.ref) || '',
        name: name || custEmail || t('common.customer'), email: custEmail || (bk && bk.email) || '',
        canSend: !!g.bookingId,
        messages: msgs,
        lastText: last.deleted ? '（削除されたメッセージ）' : last.text,
        lastTs: last.ts,
        unread: msgs.filter(function (x) { return !x.out && !x.read; }).length,
      };
    });
    convs.sort(function (a, b) { return tsMs(b.lastTs) - tsMs(a.lastTs); });
    state.convs = convs;
    state.byKey = {};
    convs.forEach(function (c) { state.byKey[c.key] = c; });
  }

  function totalUnread() { return state.convs.reduce(function (s, c) { return s + c.unread; }, 0); }

  /* ── Conversation list ─────────────────────────────────────────────────── */
  function convRow(c) {
    var preview = c.lastText ? U.esc(c.lastText.slice(0, 46)) : '（添付ファイル）';
    return '<div class="ops-row tap" data-open="' + U.esc(c.key) + '">' +
      '<div class="ops-avatar">' + U.initials(c.name) + '</div>' +
      '<div class="ops-row-main">' +
        '<div class="ops-row-title">' + U.esc(c.name) + (c.ref ? '<span class="ops-muted" style="font-weight:500;font-size:.78rem"> · ' + U.esc(c.ref) + '</span>' : '') + '</div>' +
        '<div class="ops-row-sub">' + preview + '</div>' +
      '</div>' +
      '<div class="ops-row-end"><span class="ops-row-meta">' + U.relTime(c.lastTs) + '</span>' +
        (c.unread ? '<span class="ops-badge-status st-cancel">' + c.unread + '</span>' : '') + '</div>' +
    '</div>';
  }

  function renderList() {
    var el = document.getElementById('ops-content');
    var chats = state.convs;
    el.innerHTML =
      '<div class="ops-muted" style="font-size:.78rem;font-weight:600;margin:0 2px 10px">' +
        chats.length + ' 件の会話' + (totalUnread() ? ' · 未読 ' + totalUnread() : '') + '</div>' +
      (chats.length ? '<div id="ops-list">' + chats.map(convRow).join('') + '</div>'
                    : UI.empty(t('chat.empty'), t('chat.emptySub'), 'chat'));
    el.querySelectorAll('[data-open]').forEach(function (r) {
      r.addEventListener('click', function () { openThread(r.getAttribute('data-open')); });
    });
    UI.setBell(Ops.Notify.unreadCount());
    updateNavBadge();
  }

  function updateNavBadge() {
    // Refresh the chat nav badge in place.
    var a = document.querySelectorAll('.ops-nav a')[3];
    if (!a) return;
    var old = a.querySelector('.ops-nav-badge'); if (old) old.remove();
    var n = totalUnread();
    if (n) { var s = document.createElement('span'); s.className = 'ops-nav-badge'; s.textContent = n > 9 ? '9+' : n; a.appendChild(s); }
  }

  /* ── Thread view (full-screen) ─────────────────────────────────────────── */
  function threadHtml(c) {
    var lastDay = '';
    var body = c.messages.map(function (m) {
      var day = U.fmtDate(m.ts);
      var sep = '';
      if (day !== lastDay) { sep = '<div class="ops-chat-day">' + day + '</div>'; lastDay = day; }
      if (m.deleted) return sep + '<div class="ops-msg ' + (m.out ? 'out' : 'in') + '" style="opacity:.6;font-style:italic">' + t('chat.deletedMsg') + '</div>';
      return sep + '<div class="ops-msg ' + (m.out ? 'out' : 'in') + (m.channel === 'email' ? ' email' : '') + '">' +
        U.esc(m.text).replace(/\n/g, '<br>') +
        '<span class="ops-msg-time">' + (m.out ? (m.channel === 'email' ? '📧 ' : '') : '') + U.fmtTime(m.ts) + '</span>' +
      '</div>';
    }).join('');
    if (!c.messages.length) body = '<div class="ops-empty" style="padding:60px 20px">' + UI.icon('chat') + '<h3>' + t('chat.empty') + '</h3><p>' + t('chat.startFirst') + '</p></div>';

    var composer = c.canSend
      ? '<div class="ops-composer">' +
          '<textarea id="ops-msg-input" rows="1" placeholder="' + t('chat.composerPh') + '"></textarea>' +
          '<button id="ops-msg-send" aria-label="送信">' + UI.icon('send') + '</button>' +
        '</div>'
      : '<div class="ops-chat-locked">' + t('chat.locked') + '</div>';

    return '<div class="ops-chat-inner">' +
      '<div class="ops-chat-hd">' +
        '<button class="ops-back" id="ops-chat-back" aria-label="戻る">' + UI.icon('back') + '</button>' +
        '<div class="ops-avatar">' + U.initials(c.name) + '</div>' +
        '<div class="ops-chat-hd-main">' +
          '<div class="ops-chat-hd-name">' + U.esc(c.name) + t('common.honorific') + '</div>' +
          '<div class="ops-chat-hd-sub">' + (c.ref ? t('chat.refPrefix') + U.esc(c.ref) : U.esc(c.email || '')) + '</div>' +
        '</div>' +
        (c.email && state.bookings[c.bookingId] && state.bookings[c.bookingId].phone
          ? '<button class="ops-chat-call" onclick="location.href=\'tel:' + U.esc(state.bookings[c.bookingId].phone) + '\'">' + UI.icon('phone') + '</button>' : '') +
      '</div>' +
      '<div class="ops-chat-scroll" id="ops-chat-scroll">' + body + '</div>' +
      composer +
    '</div>';
  }

  function openThread(key) {
    var c = state.byKey[key];
    if (!c) {
      // Virtual room: open a booking's chat even before any message exists.
      var bk = state.bookings[key];
      if (!bk) return;
      c = { key: key, bookingId: bk.dbId, ref: bk.ref, name: bk.name, email: bk.email, canSend: true, messages: [], unread: 0 };
      state.byKey[key] = c;
    }
    state.openKey = key;

    var scr = document.createElement('div');
    scr.className = 'ops-chat-screen';
    scr.innerHTML = threadHtml(c);
    document.body.appendChild(scr);
    state.screen = scr;
    document.querySelector('.ops-nav').classList.add('ops-hide');

    scr.querySelector('#ops-chat-back').addEventListener('click', closeThread);
    var input = scr.querySelector('#ops-msg-input');
    var send = scr.querySelector('#ops-msg-send');
    if (input && send) {
      input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 96) + 'px'; });
      send.addEventListener('click', function () { doSend(c); });
    }
    scrollBottom();
    markRead(c);
  }

  function closeThread() {
    if (state.screen) { state.screen.remove(); state.screen = null; }
    state.openKey = null;
    document.querySelector('.ops-nav').classList.remove('ops-hide');
    renderList();
  }

  function scrollBottom() {
    var s = document.getElementById('ops-chat-scroll');
    if (s) s.scrollTop = s.scrollHeight;
  }

  function rerenderOpen() {
    if (!state.openKey || !state.screen) return;
    var c = state.byKey[state.openKey];
    if (!c) return;
    var scroll = document.getElementById('ops-chat-scroll');
    var atBottom = scroll ? (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80) : true;
    var val = (document.getElementById('ops-msg-input') || {}).value || '';
    state.screen.innerHTML = threadHtml(c);
    state.screen.querySelector('#ops-chat-back').addEventListener('click', closeThread);
    var input = state.screen.querySelector('#ops-msg-input');
    var send = state.screen.querySelector('#ops-msg-send');
    if (input && send) {
      input.value = val;
      input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 96) + 'px'; });
      send.addEventListener('click', function () { doSend(c); });
    }
    if (atBottom) scrollBottom();
  }

  function doSend(c) {
    var input = document.getElementById('ops-msg-input');
    var btn = document.getElementById('ops-msg-send');
    var text = (input && input.value || '').trim();
    if (!text || !c.bookingId) return;
    btn.disabled = true;
    Api.sendChat(c.bookingId, text, c.ref, c.email).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { UI.toast('送信に失敗しました：' + ((res.error && res.error.message) || '')); return; }
      if (input) { input.value = ''; input.style.height = 'auto'; }
      // Optimistic append (poll reconciles with the server copy).
      var now = new Date().toISOString();
      c.messages.push({ id: res.row.id, out: true, name: 'Hello Moving', text: text, deleted: false, channel: 'chat', ts: now, read: true });
      c.lastText = text; c.lastTs = now;
      rerenderOpen();
    });
  }

  /* Mark this room's inbound messages as read (mirrors admin Inbox). Best-effort;
     inbound customer rows start is_read=0, outbound are already 1, so filtering on
     is_read=0 targets exactly the unread inbound. */
  function markRead(c) {
    if (!c.unread || !c.bookingId) return;
    Api.rest({
      table: 'inbox_messages', action: 'update', values: { is_read: 1 },
      filters: [{ col: 'booking_id', op: 'eq', val: c.bookingId }, { col: 'is_read', op: 'eq', val: 0 }],
    }).then(function () {
      c.messages.forEach(function (m) { m.read = true; });
      c.unread = 0;
    });
  }

  function load(initial) {
    if (initial) document.getElementById('ops-content').innerHTML = UI.skeleton(6);
    return Promise.all([Api.listInbox(), Api.listBookings()]).then(function (r) {
      build(r[0].data || [], r[1].data || []);
      var inbound = (r[0].data || []).filter(function (m) { return !parseLabels(m).outbound; });
      Ops.Notify.syncMessages(inbound);
      Ops.Notify.syncBookings(r[1].data || []);
      if (state.openKey) rerenderOpen(); else renderList();
      UI.setBell(Ops.Notify.unreadCount());
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: 'chat', title: t('chat.title') });
    load(true).then(function () {
      // Deep-link: ?booking=<dbId> opens (or starts) that room.
      var qp = new URLSearchParams(location.search);
      var bk = qp.get('booking');
      if (bk) openThread(bk);
    });
    state.poll = setInterval(function () { load(false); }, Ops.cfg.POLL_MS);
  });
})();
