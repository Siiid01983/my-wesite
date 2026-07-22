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

  /* Numeric (epoch-ms) sort key — never sort messages lexically (space<'T' makes a
     string sort order by timestamp FORMAT, not by time). Uses the shared JST-aware
     parser. */
  function tsMs(v) {
    if (window.HMFmt && HMFmt.tsMs) return HMFmt.tsMs(v);
    var d = new Date(String(v || '').replace(' ', 'T'));
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  var ATTACH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
  var CAM_SVG    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

  /* ── Shared: model building (mirrors chat.js / admin Inbox) ─────────────── */
  function parseLabels(m) {
    var l = m.labels || {};
    if (typeof l === 'string') { try { l = JSON.parse(l); } catch (_) { l = {}; } }
    return l || {};
  }
  function isAttPlaceholder(s) { return /^\[\d+件の添付ファイルを送信しました\]\s*$/.test(String(s || '').trim()); }
  function normMsg(m) {
    var l = parseLabels(m);
    var out = !!l.outbound;
    var atts = (!l.deleted && Array.isArray(l.attachments))
      ? l.attachments.map(function (a) { return a && a.deleted ? { deleted: true, name: a.name || 'file' } : { path: a.path, name: a.name || 'file', mime: a.mime || '' }; }).filter(function (a) { return a.deleted || a.path; })
      : [];
    var text = l.deleted ? '' : (m.body_text || m.body || '');
    if (atts.length && isAttPlaceholder(text)) text = '';   // media-only → hide the placeholder
    return {
      id: m.id, out: out,
      name: m.sender_name || m.sender || (out ? 'Hello Moving' : (m.email || t('common.customer'))),
      text: text,
      attachments: atts,
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
      var msgs = g.rows.map(normMsg).sort(function (a, b) { return tsMs(a.ts) - tsMs(b.ts); });
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
        lastText: last.deleted ? t('chat.deleted') : last.text, lastTs: last.ts,
        unread: msgs.filter(function (x) { return !x.out && !x.read; }).length,
      };
    });
    convs.sort(function (a, b) { return tsMs(b.lastTs) - tsMs(a.lastTs); });
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
    { k: 'all', l: 'chat.t.all' },
    { k: 'unread', l: 'chat.t.unread' },
    { k: 'booking', l: 'chat.t.booking' },
    { k: 'done', l: 'chat.t.done' },
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
    var preview = c.lastText ? U.esc(c.lastText.slice(0, 50)) : t('chat.attachment');
    return '<a class="mc-conv' + (c.unread ? ' unread' : '') + '" href="message.html?id=' + encodeURIComponent(c.key) + '">' +
      '<div class="mc-conv-av">' + U.initials(c.name) + (c.unread ? '<span class="mc-dot"></span>' : '') + '</div>' +
      '<div class="mc-conv-main">' +
        '<div class="mc-conv-top"><span class="mc-conv-name">' + U.esc(c.name) + t('common.san') + '</span><span class="mc-conv-time">' + U.relTime(c.lastTs) + '</span></div>' +
        (c.ref ? '<div class="mc-conv-ref">' + t('chat.refPrefix') + U.esc(c.ref) + '</div>' : '') +
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
      '<h3>' + t('chat.empty') + '</h3>' +
      '<p>' + (filtered ? t('bookings.emptyFilteredSub') : t('chat.emptySub')) + '</p>' +
      (!filtered ? '<a class="ops-btn ghost" href="index.html">' + t('dashboard.backToDashboard') + '</a>' : '') +
    '</div>';
  }
  function listError() {
    return '<div class="ops-empty">' + UI.icon('empty') +
      '<h3>' + t('chat.errorTitle') + '</h3><p>' + t('bookings.errorSub') + '</p>' +
      '<button class="ops-btn" id="mc-retry" style="margin-top:14px">' + t('common.retry') + '</button></div>';
  }

  function renderListBody() {
    var host = document.getElementById('mc-listhost');
    if (!host) return;
    var list = visibleConvs();
    host.innerHTML = list.length
      ? '<div class="mc-count">' + t('chat.convCount', { n: list.length }) + (totalUnread() ? ' · ' + t('chat.unreadSuffix', { n: totalUnread() }) : '') + '</div><div class="mc-list">' + list.map(convCard).join('') + '</div>'
      : listEmpty();
  }

  function renderListShell() {
    var el = document.getElementById('ops-content');
    el.innerHTML =
      '<div class="mc-search">' + UI.icon('search') +
        '<input id="mc-q" type="search" placeholder="' + t('chat.searchPh') + '" autocomplete="off" />' +
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
    UI.mountChrome({ active: 'chat', title: t('chat.title') });
    loadList(true);
    L.poll = setInterval(function () { if (!L.error) loadList(false); }, Ops.cfg.POLL_MS);
  }

  /* ════════════════════════════════════════════════════════════════════════
     SCREEN 2 — Conversation detail (message.html?id=… | ?booking=… | ?ref=…)
     ════════════════════════════════════════════════════════════════════════ */
  var T = { conv: null, bookings: {}, tab: 'chat', poll: null, pending: [] };

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
      return '<div class="ops-empty" style="padding:48px 20px">' + UI.icon('chat') + '<h3>' + t('chat.empty') + '</h3><p>' + t('chat.startFirst') + '</p></div>';
    }
    var lastDay = '';
    return c.messages.map(function (m) {
      var sep = '';
      var day = daySep(m.ts);
      if (day && day !== lastDay) { sep = '<div class="mc-day"><span>' + day + '</span></div>'; lastDay = day; }
      var av = m.out ? '' : '<div class="mc-row-av">' + U.initials(c.name) + '</div>';
      var mts = (window.HMFmt ? HMFmt.msgTime(m.ts) : U.fmtTime(m.ts));   // T3 — full consistent timestamp
      var meta = '<span class="mc-meta">' + mts + (m.out ? (m.read ? ' · ' + t('chat.read') : ' · ' + t('chat.sent')) : '') + (m.out && m.channel === 'email' ? ' 📧' : '') + '</span>';
      var textHtml = m.text ? U.esc(m.text).replace(/\n/g, '<br>') : '';
      var inner = m.deleted
        ? '<div class="mc-bubble deleted">' + t('chat.deletedMsg') + '</div>'
        : '<div class="mc-bubble">' + attsHtml(m.attachments) + textHtml + meta + '</div>';
      return sep + '<div class="mc-row ' + (m.out ? 'out' : 'in') + '">' + av + inner + '</div>';
    }).join('');
  }

  // Attachment markup — image thumbnail or file chip. The signed URL is resolved
  // after render by hydrateAtts() (data-att holds the storage path).
  function attsHtml(atts) {
    if (!atts || !atts.length) return '';
    return '<div class="mc-atts">' + atts.map(function (a) {
      if (a && a.deleted) return '<span class="mc-att-gone" style="display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border:1px dashed var(--ops-line,#e6e7e2);border-radius:8px;font-size:12px;color:var(--ops-muted,#8a8f86);font-style:italic">🗑 添付ファイルは削除されました</span>';
      if (/^image\//.test(a.mime || '')) {
        return '<a class="mc-att-img" data-att="' + U.esc(a.path) + '" target="_blank" rel="noopener" title="' + U.esc(a.name) + '"><img alt="' + U.esc(a.name) + '" /></a>';
      }
      return '<a class="mc-att-file" data-att="' + U.esc(a.path) + '" target="_blank" rel="noopener" download>' + UI.icon('inbox') + '<span>' + U.esc(a.name) + '</span></a>';
    }).join('') + '</div>';
  }
  // Private `chat` bucket → resolve a fresh HMAC-signed URL per attachment (same as
  // the customer portal). 1-hour TTL + img.onerror RE-SIGN-ONCE so an expired/stale
  // thumbnail self-heals instead of showing a broken image (Issue 5).
  function hydrateAtts(root) {
    if (!root) return;
    root.querySelectorAll('[data-att]').forEach(function (el) {
      if (el.__hy) return; el.__hy = 1;
      var path = el.getAttribute('data-att');
      var apply = function (url) {
        if (!url) return;
        el.setAttribute('href', url);
        var img = el.querySelector('img');
        if (img) {
          img.onerror = function () { img.onerror = null; Api.signChatFile(path, 3600).then(function (u2) { if (u2) { el.setAttribute('href', u2); img.src = u2; } }); };
          img.src = url;
        }
      };
      Api.signChatFile(path, 3600).then(apply);
    });
  }

  function kv(k, v) { return v ? '<div class="mc-kv"><span class="k">' + k + '</span><span class="v">' + U.esc(v) + '</span></div>' : ''; }
  // Always-render variant — shows a "—" placeholder when empty, so critical
  // customer fields (phone, address) stay visible regardless of booking status.
  function kvA(k, v) { return '<div class="mc-kv"><span class="k">' + k + '</span><span class="v">' + (v ? U.esc(v) : '—') + '</span></div>'; }
  // Raw variants — value is TRUSTED pre-built HTML (e.g. Ops.addrHtml, which
  // escapes its own text). Used for the clickable-address cells (Issue 4).
  function kvRaw(k, v) { return v ? '<div class="mc-kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>' : ''; }
  function kvARaw(k, v) { return '<div class="mc-kv"><span class="k">' + k + '</span><span class="v">' + (v || '—') + '</span></div>'; }

  function inventoryHtml(items) {
    if (!items || !items.length) return '<p class="mc-none">' + t('furniture.none') + '</p>';
    if (window.HMFmt) return HMFmt.furnitureGrid(items);   // T4 — icon + name + ×qty cards
    return '<div class="mc-chips">' + items.map(function (it) { return '<span class="mc-chip">' + U.esc(it) + '</span>'; }).join('') + '</div>';
  }

  function detailTabHtml(c) {
    var b = c.booking;
    if (!b) return '<div class="mc-scroll"><p class="mc-none">' + t('calendar.noBookingLinked') + '</p></div>';
    // Address always renders as its own card; empty → an explicit "no address" note.
    // Once confirmed the address text itself is a Google Maps link (Ops.addrHtml).
    var addr = (b.fromAddr || b.toAddr)
      ? (kvARaw(t('customers.currentAddr'), Ops.addrHtml(b, 'from')) + kvRaw(t('customers.destAddr'), Ops.addrHtml(b, 'to')))
      : '<p class="mc-none" style="margin:6px 0">' + t('customers.noAddr') + '</p>';
    // Zip: only when the full address is exposed (post-確定) — the pre-確定 mask
    // hides the postal code (address-privacy rule). Completed/cancelled hide it too.
    var zipRow = (Ops.addrReveal(b) && b.postal) ? kv(t('customers.postal'), b.postal) : '';
    // Cancelled/rejected → privacy: only identity (ref/name/city/service/status).
    // Contact, full address, Maps, furniture and preferred times are withheld.
    if (Ops.bookingCancelled(b)) {
      return '<div class="mc-scroll">' +
        '<div class="mc-sec">' + t('customers.customerInfo') + '</div>' +
        '<div class="mc-card">' +
          kvA(t('customers.name'), b.name ? b.name + t('common.honorific') : '') +
          kv(t('bookings.service'), b.service) +
          kv(t('customers.currentAddr'), Ops.addrText(b, 'from')) +   // masked → city/ward only
          kv(t('common.status'), t('status.' + Ops.toDbStatus(b.status))) +
        '</div>' +
      '</div>';
    }
    return '<div class="mc-scroll">' +
      '<div class="mc-sec">' + t('customers.customerInfo') + '</div>' +
      // Name / Phone / Email always visible (kvA), regardless of booking status.
      '<div class="mc-card">' + kvA(t('customers.name'), b.name ? b.name + t('common.honorific') : '') + kvA(t('bookings.phone'), b.phone) + kvA(t('bookings.email'), b.email) + '</div>' +
      '<div class="mc-sec">' + t('chat.moving') + '</div>' +
      '<div class="mc-card">' + kv(t('bookings.service'), b.service) + kv(t('bookings.moveDate'), U.fmtDateFull(b.date)) + (b.time ? kv(t('bookings.timeSlot'), b.time) : '') + kv(t('common.status'), t('status.' + Ops.toDbStatus(b.status))) + '</div>' +
      ((window.HMFmt && HMFmt.preferredOptions(b)) ? '<div class="mc-card">' + HMFmt.preferredOptions(b) + '</div>' : '') +   // T5
      '<div class="mc-sec">' + t('customers.addresses') + '</div>' +
      '<div class="mc-card">' + addr + zipRow + '</div>' + Ops.addrExtraHtml(b) +
      '<div class="mc-sec">' + t('furniture.title') + '</div>' +
      inventoryHtml(b.items) +
    '</div>';
  }

  function summaryHtml(c) {
    var b = c.booking;
    var price = b && (b.price || b.total_price || b.amount);   // bookings carry no price today → row hidden
    return '<div class="mc-summary">' +
      '<span class="mc-s-ref">' + U.esc(c.ref || t('chat.noBookingId')) + '</span>' +
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
    if (!c.canSend) return '<div class="mc-locked">' + t('chat.locked') + '</div>';
    return '<div class="mc-composer">' +
      '<button class="mc-attach" id="mc-cam" aria-label="' + t('chat.cameraAria') + '">' + CAM_SVG + '</button>' +
      '<input type="file" id="mc-cam-file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden />' +
      '<button class="mc-attach" id="mc-attach" aria-label="' + t('chat.attachAria') + '">' + ATTACH_SVG + '</button>' +
      '<input type="file" id="mc-file" accept="image/*,application/pdf,.doc,.docx" multiple hidden />' +
      '<div class="mc-cmid">' +
        '<div class="mc-pending" id="mc-pending" style="display:none"></div>' +
        '<textarea id="mc-input" rows="1" placeholder="' + t('chat.composerPh') + '"></textarea>' +
      '</div>' +
      '<button class="mc-send" id="mc-send" aria-label="' + t('chat.sendAria') + '">' + UI.icon('send') + '</button>' +
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
          '<div class="mc-hd-main"><div class="mc-hd-name">' + U.esc(c.name) + t('common.san') + '</div>' +
            '<div class="mc-hd-sub">' + (c.ref ? t('chat.refPrefix') + U.esc(c.ref) : U.esc(c.email || '')) + '</div></div>' +
          (b && b.phone ? '<a class="mc-hd-call" href="tel:' + U.esc(b.phone) + '" aria-label="電話">' + UI.icon('phone') + '</a>' : '') +
        '</div>' +
        summaryHtml(c) +
        '<div class="mc-dtabs">' +
          '<button class="mc-dtab' + (T.tab === 'chat' ? ' active' : '') + '" data-dtab="chat">' + t('chat.tab.chat') + '</button>' +
          '<button class="mc-dtab' + (T.tab === 'detail' ? ' active' : '') + '" data-dtab="detail">' + t('chat.tab.detail') + '</button>' +
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
    if (T.tab === 'chat') { scrollBottom(); hydrateAtts(document.getElementById('mc-scroll')); }
  }

  function wireComposer(c) {
    var input = document.getElementById('mc-input');
    var send = document.getElementById('mc-send');
    var attach = document.getElementById('mc-attach');
    var file = document.getElementById('mc-file');
    if (attach && file) attach.addEventListener('click', function () { file.click(); });
    if (file) file.addEventListener('change', function () { handleFiles(T.conv || c, file.files); file.value = ''; });
    // T2 — camera capture (mobile) / file picker (desktop); same upload pipeline.
    var cam = document.getElementById('mc-cam');
    var camFile = document.getElementById('mc-cam-file');
    if (cam && camFile) cam.addEventListener('click', function () { camFile.click(); });
    if (camFile) camFile.addEventListener('change', function () { handleFiles(T.conv || c, camFile.files); camFile.value = ''; });
    renderPending();
    if (input && send) {
      input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 96) + 'px'; });
      send.addEventListener('click', function () { doSend(T.conv || c); });   // T.conv stays fresh across polls
    }
  }

  // Upload picked files to the private 'chat' bucket; keep validated metadata in
  // T.pending until send. storage.php enforces MIME/size; chat rejects out-of-scope.
  function handleFiles(c, files) {
    if (!files || !c || !c.bookingId) return;
    Array.prototype.slice.call(files).forEach(function (f0) {
      if (T.pending.length >= 10) { UI.toast(t('chat.sendFailed')); return; }
      var tok = { name: f0.name, uploading: true };
      T.pending.push(tok); renderPending();
      // Downscale/recompress large photos client-side before upload (mobile perf).
      Promise.resolve(window.HMImageCompress ? HMImageCompress.process(f0) : f0).then(function (f) {
      tok.name = f.name; renderPending();
      Api.uploadChatFile(c.bookingId, f).then(function (res) {
        var i = T.pending.indexOf(tok);
        if (!res.ok) { if (i >= 0) T.pending.splice(i, 1); renderPending(); UI.toast(t('chat.sendFailed') + '：' + (res.error || '')); return; }
        if (i >= 0) T.pending[i] = { path: res.path, name: res.name, mime: res.mime, size: res.size };
        renderPending();
      });
      });
    });
  }
  function renderPending() {
    var host = document.getElementById('mc-pending');
    if (!host) return;
    host.innerHTML = T.pending.map(function (a, i) {
      return '<span class="mc-pchip' + (a.uploading ? ' up' : '') + '">' + (a.uploading ? '<span class="ops-spin"></span>' : '') + U.esc(a.name) + (a.uploading ? '' : '<button type="button" data-rm="' + i + '" aria-label="remove">×</button>') + '</span>';
    }).join('');
    host.style.display = T.pending.length ? 'flex' : 'none';
    host.querySelectorAll('[data-rm]').forEach(function (b) {
      b.addEventListener('click', function () { T.pending.splice(+b.getAttribute('data-rm'), 1); renderPending(); });
    });
  }

  function scrollBottom() {
    var s = document.getElementById('mc-scroll');
    if (s) s.scrollTop = s.scrollHeight;
  }

  function doSend(c) {
    var input = document.getElementById('mc-input');
    var btn = document.getElementById('mc-send');
    var text = (input && input.value || '').trim();
    // Only ready (uploaded) attachments; skip any still uploading.
    var atts = T.pending.filter(function (a) { return a.path && !a.uploading; });
    if ((!text && !atts.length) || !c.bookingId) return;
    if (T.pending.some(function (a) { return a.uploading; })) { UI.toast(t('common.saving')); return; }
    btn.disabled = true;
    Api.sendChat(c.bookingId, text, c.ref, c.email, atts).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { UI.toast(t('chat.sendFailed') + '：' + ((res.error && res.error.message) || '')); return; }
      if (input) { input.value = ''; input.style.height = 'auto'; }
      T.pending = []; renderPending();
      var now = new Date().toISOString();
      c.messages.push({ id: res.row.id, out: true, name: 'Hello Moving', text: text, attachments: atts, deleted: false, channel: 'chat', ts: now, read: true });
      c.lastText = text || t('chat.attachment'); c.lastTs = now;
      var scr = document.getElementById('mc-scroll');
      if (scr) { scr.innerHTML = bubblesHtml(c); scrollBottom(); hydrateAtts(scr); }
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
      if (T.tab === 'chat' && scr) { scr.innerHTML = bubblesHtml(fresh); hydrateAtts(scr); if (atBottom) scrollBottom(); }
      markRead(fresh);
    });
  }

  function loadThread() {
    var root = document.getElementById('mc-root');
    root.innerHTML = '<div class="ops-main" style="padding-top:70px">' + UI.skeleton(6) + '</div>';
    Promise.all([Api.listInbox(), Api.listBookings()]).then(function (r) {
      if ((r[0].error && !(r[0].data && r[0].data.length)) && (r[1].error && !(r[1].data && r[1].data.length))) {
        root.innerHTML = '<div class="ops-main" style="padding-top:70px"><div class="ops-empty">' + UI.icon('empty') +
          '<h3>' + t('chat.errorTitle') + '</h3><p>' + t('bookings.errorSub') + '</p>' +
          '<button class="ops-btn" id="mc-retry" style="margin-top:14px">' + t('common.retry') + '</button>' +
          '<a class="ops-btn ghost" href="messages.html" style="margin-top:8px">' + t('chat.toList') + '</a></div></div>';
        var rt = document.getElementById('mc-retry'); if (rt) rt.addEventListener('click', loadThread);
        return;
      }
      var b = build(r[0].data || [], r[1].data || []);
      T.bookings = b.bookings;
      var c = findConv(b.convs, b.bookings);
      if (!c) {
        root.innerHTML = '<div class="ops-main" style="padding-top:70px"><div class="ops-empty">' + UI.icon('chat') +
          '<h3>' + t('chat.notFound') + '</h3><p>' + t('chat.notFoundSub') + '</p>' +
          '<a class="ops-btn ghost" href="messages.html">' + t('chat.toList') + '</a></div></div>';
        return;
      }
      T.conv = c; T.pending = [];
      renderThread();
      markRead(c);
      T.poll = setInterval(refreshThread, Ops.cfg.POLL_MS);
    });
  }

  /* ── Dispatch ───────────────────────────────────────────────────────────── */
  Ops.ready(function () { if (PAGE === 'thread') loadThread(); else initList(); });
})();
