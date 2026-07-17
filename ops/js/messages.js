/* ════════════════════════════════════════════════════════════════════════════
   messages.js — M4 Chat / Message Center

   Two pages, one module (dispatched by <body data-ops-page>):
     • list   → messages.html  : conversation list · tabs · search · unread badges
     • thread → message.html   : booking summary · チャット / 予約詳細 tabs ·
                                  bubbles · date separators · composer · furniture

   Reuses the EXISTING messaging store (inbox_messages) via ops-core's
   Api.listInbox / Api.sendChat — the same store chat.php reads/writes, appended
   exactly like the admin Inbox (labels.outbound + labels.chat, thread
   'chat:<bookingId>'). NO backend logic is modified and NO new tables are created.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, Api = Ops.Api;
  var PAGE = document.body.getAttribute('data-ops-page');

  var ATTACH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

  /* ── Shared: model building (mirrors chat.js / admin Inbox) ─────────────── */
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
      name: m.sender_name || m.sender || (out ? 'Hello Moving' : (m.email || 'お客様')),
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
      var msgs = g.rows.map(normMsg).sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)); });
      var bk = bmap[g.bookingId];
      var custEmail = '';
      g.rows.forEach(function (m) { var l = parseLabels(m); if (!l.outbound && m.email && !custEmail) custEmail = m.email; });
      var name = (bk && bk.name) || '';
      if (!name) { for (var i = 0; i < msgs.length; i++) { if (!msgs[i].out) { name = msgs[i].name; break; } } }
      var last = msgs[msgs.length - 1] || { text: '', ts: '' };
      return {
        key: k, bookingId: g.bookingId, ref: g.ref || (bk && bk.ref) || '',
        name: name || custEmail || 'お客様', email: custEmail || (bk && bk.email) || '',
        canSend: !!g.bookingId, booking: bk || null, messages: msgs,
        lastText: last.deleted ? '（削除されたメッセージ）' : last.text, lastTs: last.ts,
        unread: msgs.filter(function (x) { return !x.out && !x.read; }).length,
      };
    });
    convs.sort(function (a, b) { return String(b.lastTs).localeCompare(String(a.lastTs)); });
    return { convs: convs, bookings: bmap };
  }

  function daySep(ts) {
    var d = new Date(String(ts).replace(' ', 'T'));
    if (isNaN(d)) return '';
    var wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + wd + '）';
  }

  /* ════════════════════════════════════════════════════════════════════════
     SCREEN 1 — Conversation list (messages.html)
     ════════════════════════════════════════════════════════════════════════ */
  var L = { convs: [], bookings: {}, tab: 'all', q: '', error: false, poll: null };

  var TABS = [
    { k: 'all', l: 'すべて' },
    { k: 'unread', l: '未読' },
    { k: 'booking', l: '予約関連' },
    { k: 'done', l: '完了' },
  ];

  function tabMatch(c, tab) {
    if (tab === 'unread') return c.unread > 0;
    if (tab === 'booking') return !!(c.bookingId || c.ref);
    if (tab === 'done') return !!(c.booking && c.booking.status === '完了');
    return true;
  }
  function searchMatch(c) {
    var q = L.q.trim().toLowerCase();
    if (!q) return true;
    if ((c.name + ' ' + c.ref).toLowerCase().indexOf(q) >= 0) return true;
    return c.messages.some(function (m) { return (m.text || '').toLowerCase().indexOf(q) >= 0; });
  }
  function visibleConvs() {
    return L.convs.filter(function (c) { return tabMatch(c, L.tab) && searchMatch(c); });
  }
  function totalUnread() { return L.convs.reduce(function (s, c) { return s + c.unread; }, 0); }

  function convCard(c) {
    var preview = c.lastText ? U.esc(c.lastText.slice(0, 50)) : '（添付ファイル）';
    return '<a class="mc-conv' + (c.unread ? ' unread' : '') + '" href="message.html?id=' + encodeURIComponent(c.key) + '">' +
      '<div class="mc-conv-av">' + U.initials(c.name) + (c.unread ? '<span class="mc-dot"></span>' : '') + '</div>' +
      '<div class="mc-conv-main">' +
        '<div class="mc-conv-top"><span class="mc-conv-name">' + U.esc(c.name) + 'さん</span><span class="mc-conv-time">' + U.relTime(c.lastTs) + '</span></div>' +
        (c.ref ? '<div class="mc-conv-ref">予約ID: ' + U.esc(c.ref) + '</div>' : '') +
        '<div class="mc-conv-bottom"><span class="mc-conv-last">' + preview + '</span>' + (c.unread ? '<span class="mc-badge">' + c.unread + '</span>' : '') + '</div>' +
      '</div>' +
    '</a>';
  }

  function tabsHtml() {
    var unread = totalUnread();
    return '<div class="mc-tabs">' + TABS.map(function (t) {
      var badge = (t.k === 'unread' && unread) ? '<span class="mc-tabn">' + unread + '</span>' : '';
      return '<button class="mc-tab' + (L.tab === t.k ? ' active' : '') + '" data-tab="' + t.k + '">' + t.l + badge + '</button>';
    }).join('') + '</div>';
  }

  function listEmpty() {
    var filtered = L.q || L.tab !== 'all';
    return '<div class="ops-empty">' + UI.icon('chat') +
      '<h3>まだメッセージはありません</h3>' +
      '<p>' + (filtered ? '検索・フィルター条件を変えてお試しください' : 'お客様からのメッセージがここに表示されます') + '</p>' +
      (!filtered ? '<a class="ops-btn ghost" href="index.html">ダッシュボードへ戻る</a>' : '') +
    '</div>';
  }
  function listError() {
    return '<div class="ops-empty">' + UI.icon('empty') +
      '<h3>メッセージを取得できません</h3><p>接続を確認して、もう一度お試しください。</p>' +
      '<button class="ops-btn" id="mc-retry" style="margin-top:14px">再試行</button></div>';
  }

  function renderListBody() {
    var host = document.getElementById('mc-listhost');
    if (!host) return;
    var list = visibleConvs();
    host.innerHTML = list.length
      ? '<div class="mc-count">' + list.length + ' 件の会話' + (totalUnread() ? ' · 未読 ' + totalUnread() : '') + '</div><div class="mc-list">' + list.map(convCard).join('') + '</div>'
      : listEmpty();
  }

  function renderListShell() {
    var el = document.getElementById('ops-content');
    el.innerHTML =
      '<div class="mc-search">' + UI.icon('search') +
        '<input id="mc-q" type="search" placeholder="名前・予約ID・本文で検索" autocomplete="off" />' +
      '</div>' +
      tabsHtml() +
      '<div id="mc-listhost"></div>';

    var q = el.querySelector('#mc-q');
    q.value = L.q;
    q.addEventListener('input', U.debounce(function () { L.q = q.value; renderListBody(); }, 200));
    el.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { L.tab = b.getAttribute('data-tab'); renderListShell(); });
    });
    renderListBody();
    UI.setBell(Ops.Notify.unreadCount());
  }

  // Poll-time refresh of the 未読 tab count without recreating tabs/search (keeps focus).
  function refreshTabBadge() {
    var btn = document.querySelector('.mc-tab[data-tab="unread"]');
    if (!btn) return;
    var unread = totalUnread(), n = btn.querySelector('.mc-tabn');
    if (unread) { if (!n) { n = document.createElement('span'); n.className = 'mc-tabn'; btn.appendChild(n); } n.textContent = unread; }
    else if (n) { n.remove(); }
  }

  function loadList(initial) {
    if (initial) document.getElementById('ops-content').innerHTML = UI.skeleton(6);
    return Promise.all([Api.listInbox(), Api.listBookings()]).then(function (r) {
      if ((r[0].error && !(r[0].data && r[0].data.length)) && (r[1].error && !(r[1].data && r[1].data.length))) {
        L.error = true;
        var el = document.getElementById('ops-content');
        el.innerHTML = listError();
        var rt = document.getElementById('mc-retry');
        if (rt) rt.addEventListener('click', function () { loadList(true); });
        return;
      }
      var b = build(r[0].data || [], r[1].data || []);
      L.convs = b.convs; L.bookings = b.bookings;
      var inbound = (r[0].data || []).filter(function (m) { return !parseLabels(m).outbound; });
      Ops.Notify.syncMessages(inbound);
      Ops.Notify.syncBookings(r[1].data || []);
      // On the first paint (or if the shell is gone) build the whole shell; on
      // poll ticks refresh only the list body + tab badge so an in-progress
      // search keeps its input focus.
      if (initial || !document.getElementById('mc-listhost')) renderListShell();
      else { renderListBody(); refreshTabBadge(); UI.setBell(Ops.Notify.unreadCount()); }
    });
  }

  function initList() {
    UI.mountChrome({ active: 'chat', title: 'メッセージ' });
    loadList(true);
    L.poll = setInterval(function () { if (!L.error) loadList(false); }, Ops.cfg.POLL_MS);
  }

  /* ════════════════════════════════════════════════════════════════════════
     SCREEN 2 — Conversation detail (message.html?id=… | ?booking=… | ?ref=…)
     ════════════════════════════════════════════════════════════════════════ */
  var T = { conv: null, bookings: {}, tab: 'chat', poll: null };

  function findConv(convs, bookings) {
    var qp = new URLSearchParams(location.search);
    var id = qp.get('id'), bk = qp.get('booking'), ref = qp.get('ref');
    var c = null;
    if (id) c = convs.filter(function (x) { return String(x.key) === String(id); })[0];
    if (!c && ref) c = convs.filter(function (x) { return x.ref === ref; })[0];
    if (!c && bk) c = convs.filter(function (x) { return String(x.bookingId) === String(bk); })[0];
    if (!c && bk && bookings[bk]) {  // virtual room — booking with no messages yet
      var b = bookings[bk];
      c = { key: bk, bookingId: b.dbId, ref: b.ref, name: b.name, email: b.email, canSend: true, booking: b, messages: [], unread: 0 };
    }
    return c;
  }

  function bubblesHtml(c) {
    if (!c.messages.length) {
      return '<div class="ops-empty" style="padding:48px 20px">' + UI.icon('chat') + '<h3>まだメッセージはありません</h3><p>最初のメッセージを送信しましょう</p></div>';
    }
    var lastDay = '';
    return c.messages.map(function (m) {
      var sep = '';
      var day = daySep(m.ts);
      if (day && day !== lastDay) { sep = '<div class="mc-day"><span>' + day + '</span></div>'; lastDay = day; }
      var av = m.out ? '' : '<div class="mc-row-av">' + U.initials(c.name) + '</div>';
      var inner = m.deleted
        ? '<div class="mc-bubble deleted">削除されたメッセージ</div>'
        : '<div class="mc-bubble">' + U.esc(m.text).replace(/\n/g, '<br>') +
            '<span class="mc-meta">' + U.fmtTime(m.ts) + (m.out ? (m.read ? ' · 既読' : ' · 送信済み') : '') + (m.out && m.channel === 'email' ? ' 📧' : '') + '</span>' +
          '</div>';
      return sep + '<div class="mc-row ' + (m.out ? 'out' : 'in') + '">' + av + inner + '</div>';
    }).join('');
  }

  function kv(k, v) { return v ? '<div class="mc-kv"><span class="k">' + k + '</span><span class="v">' + U.esc(v) + '</span></div>' : ''; }

  function inventoryHtml(items) {
    if (!items || !items.length) return '<p class="mc-none">家具情報はありません</p>';
    return '<div class="mc-chips">' + items.map(function (it) { return '<span class="mc-chip">' + U.esc(it) + '</span>'; }).join('') + '</div>';
  }

  function detailTabHtml(c) {
    var b = c.booking;
    if (!b) return '<div class="mc-scroll"><p class="mc-none">この会話には予約が紐づいていません。</p></div>';
    var addr = (kv('現住所', b.fromAddr) + kv('引越し先', b.toAddr)) || '<p class="mc-none" style="margin:6px 0">住所情報はありません</p>';
    return '<div class="mc-scroll">' +
      '<div class="mc-sec">お客様</div>' +
      '<div class="mc-card">' + kv('お名前', b.name ? b.name + '様' : '') + kv('電話', b.phone) + kv('メール', b.email) + '</div>' +
      '<div class="mc-sec">引越し情報</div>' +
      '<div class="mc-card">' + kv('サービス', b.service) + kv('引越し日', U.fmtDateFull(b.date)) + (b.time ? kv('時間帯', b.time) : '') + kv('ステータス', b.status) + '</div>' +
      '<div class="mc-sec">住所</div>' +
      '<div class="mc-card">' + addr + '</div>' +
      '<div class="mc-sec">搬送家具・荷物一覧</div>' +
      inventoryHtml(b.items) +
    '</div>';
  }

  function summaryHtml(c) {
    var b = c.booking;
    var price = b && (b.price || b.total_price || b.amount);   // bookings carry no price today → row hidden
    return '<div class="mc-summary">' +
      '<span class="mc-s-ref">' + U.esc(c.ref || '予約なし') + '</span>' +
      (b && b.service ? '<span class="mc-s-svc">' + U.esc(b.service) + '</span>' : '') +
      (b ? UI.statusBadge(b.status) : '') +
      (price ? '<span class="mc-s-price">' + U.esc(price) + '</span>' : '') +
    '</div>';
  }

  function bodyHtml(c) {
    if (T.tab === 'detail') return detailTabHtml(c);
    return '<div class="mc-scroll" id="mc-scroll">' + bubblesHtml(c) + '</div>';
  }

  function composerHtml(c) {
    if (T.tab !== 'chat') return '';
    if (!c.canSend) return '<div class="mc-locked">このスレッドはメール受信です。返信は管理画面をご利用ください。</div>';
    return '<div class="mc-composer">' +
      '<button class="mc-attach" id="mc-attach" aria-label="添付">' + ATTACH_SVG + '</button>' +
      '<textarea id="mc-input" rows="1" placeholder="メッセージを入力…"></textarea>' +
      '<button class="mc-send" id="mc-send" aria-label="送信">' + UI.icon('send') + '</button>' +
    '</div>';
  }

  function renderThread() {
    var c = T.conv;
    var root = document.getElementById('mc-root');
    var b = c.booking;
    root.innerHTML =
      '<div class="mc-thd">' +
        '<div class="mc-thd-hd">' +
          '<button class="mc-back" id="mc-back" aria-label="戻る">' + UI.icon('back') + '</button>' +
          '<div class="mc-hd-av">' + U.initials(c.name) + '</div>' +
          '<div class="mc-hd-main"><div class="mc-hd-name">' + U.esc(c.name) + 'さん</div>' +
            '<div class="mc-hd-sub">' + (c.ref ? '予約ID: ' + U.esc(c.ref) : U.esc(c.email || '')) + '</div></div>' +
          (b && b.phone ? '<a class="mc-hd-call" href="tel:' + U.esc(b.phone) + '" aria-label="電話">' + UI.icon('phone') + '</a>' : '') +
        '</div>' +
        summaryHtml(c) +
        '<div class="mc-dtabs">' +
          '<button class="mc-dtab' + (T.tab === 'chat' ? ' active' : '') + '" data-dtab="chat">チャット</button>' +
          '<button class="mc-dtab' + (T.tab === 'detail' ? ' active' : '') + '" data-dtab="detail">予約詳細</button>' +
        '</div>' +
        '<div class="mc-body">' + bodyHtml(c) + '</div>' +
        composerHtml(c) +
      '</div>';

    root.querySelector('#mc-back').addEventListener('click', function () {
      if (history.length > 1) history.back(); else location.href = 'messages.html';
    });
    root.querySelectorAll('[data-dtab]').forEach(function (t) {
      t.addEventListener('click', function () { T.tab = t.getAttribute('data-dtab'); renderThread(); });
    });
    wireComposer(c);
    if (T.tab === 'chat') scrollBottom();
  }

  function wireComposer(c) {
    var input = document.getElementById('mc-input');
    var send = document.getElementById('mc-send');
    var attach = document.getElementById('mc-attach');
    if (attach) attach.addEventListener('click', function () { UI.toast('添付機能は現在ご利用いただけません'); });
    if (input && send) {
      input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 96) + 'px'; });
      send.addEventListener('click', function () { doSend(T.conv || c); });   // T.conv stays fresh across polls
    }
  }

  function scrollBottom() {
    var s = document.getElementById('mc-scroll');
    if (s) s.scrollTop = s.scrollHeight;
  }

  function doSend(c) {
    var input = document.getElementById('mc-input');
    var btn = document.getElementById('mc-send');
    var text = (input && input.value || '').trim();
    if (!text || !c.bookingId) return;
    btn.disabled = true;
    Api.sendChat(c.bookingId, text, c.ref, c.email).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { UI.toast('送信に失敗しました：' + ((res.error && res.error.message) || '')); return; }
      if (input) { input.value = ''; input.style.height = 'auto'; }
      var now = new Date().toISOString();
      c.messages.push({ id: res.row.id, out: true, name: 'Hello Moving', text: text, deleted: false, channel: 'chat', ts: now, read: true });
      c.lastText = text; c.lastTs = now;
      var scr = document.getElementById('mc-scroll');
      if (scr) { scr.innerHTML = bubblesHtml(c); scrollBottom(); }
    });
  }

  function markRead(c) {
    if (!c.unread || !c.bookingId) return;
    Api.rest({
      table: 'inbox_messages', action: 'update', values: { is_read: 1 },
      filters: [{ col: 'booking_id', op: 'eq', val: c.bookingId }, { col: 'is_read', op: 'eq', val: 0 }],
    }).then(function () { c.messages.forEach(function (m) { m.read = true; }); c.unread = 0; });
  }

  function refreshThread() {
    Promise.all([Api.listInbox(), Api.listBookings()]).then(function (r) {
      var b = build(r[0].data || [], r[1].data || []);
      var fresh = b.convs.filter(function (x) { return String(x.key) === String(T.conv.key); })[0];
      if (!fresh) return;
      var scr = document.getElementById('mc-scroll');
      var atBottom = scr ? (scr.scrollHeight - scr.scrollTop - scr.clientHeight < 80) : true;
      fresh.booking = b.bookings[fresh.bookingId] || T.conv.booking;
      T.conv = fresh; T.bookings = b.bookings;
      if (T.tab === 'chat' && scr) { scr.innerHTML = bubblesHtml(fresh); if (atBottom) scrollBottom(); }
      markRead(fresh);
    });
  }

  function loadThread() {
    var root = document.getElementById('mc-root');
    root.innerHTML = '<div class="ops-main" style="padding-top:70px">' + UI.skeleton(6) + '</div>';
    Promise.all([Api.listInbox(), Api.listBookings()]).then(function (r) {
      if ((r[0].error && !(r[0].data && r[0].data.length)) && (r[1].error && !(r[1].data && r[1].data.length))) {
        root.innerHTML = '<div class="ops-main" style="padding-top:70px"><div class="ops-empty">' + UI.icon('empty') +
          '<h3>メッセージを取得できません</h3><p>接続を確認してください。</p>' +
          '<button class="ops-btn" id="mc-retry" style="margin-top:14px">再試行</button>' +
          '<a class="ops-btn ghost" href="messages.html" style="margin-top:8px">メッセージ一覧へ</a></div></div>';
        var rt = document.getElementById('mc-retry'); if (rt) rt.addEventListener('click', loadThread);
        return;
      }
      var b = build(r[0].data || [], r[1].data || []);
      T.bookings = b.bookings;
      var c = findConv(b.convs, b.bookings);
      if (!c) {
        root.innerHTML = '<div class="ops-main" style="padding-top:70px"><div class="ops-empty">' + UI.icon('chat') +
          '<h3>会話が見つかりません</h3><p>一覧からもう一度お選びください。</p>' +
          '<a class="ops-btn ghost" href="messages.html">メッセージ一覧へ</a></div></div>';
        return;
      }
      T.conv = c;
      renderThread();
      markRead(c);
      T.poll = setInterval(refreshThread, Ops.cfg.POLL_MS);
    });
  }

  /* ── Dispatch ───────────────────────────────────────────────────────────── */
  Ops.ready(function () { if (PAGE === 'thread') loadThread(); else initList(); });
})();
