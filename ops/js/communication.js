/* ════════════════════════════════════════════════════════════════════════════
   communication.js — OPS Communication Center  (/ops/communication.html)

   The central full-control interface for the EXISTING messaging infrastructure.
   It does NOT create a new chat system, table, or backend. It unifies every
   existing inbox_messages conversation (thread_id namespaces the type):
     • contact:<CODE>   → お問い合わせ (Contact Chat)   — reply via contact-chat.php
     • chat:<bookingId> → 予約 / 見積もり チャット        — reply via chat.php (Api.sendChat)
     • email threads     → inbound email (read-only here; admin.html Inbox replies)

   Adds the operational control plane on TOP of that store, all via EXISTING
   endpoints + EXISTING columns (assignee/status/archived/is_read) + the EXISTING
   labels JSON (priority, internal notes). Sender identity is always server-derived
   (labels.outbound) — never trusted from the client. Internal notes are enforced
   staff-only on the SERVER (chat.php / contact-chat.php skip labels.internal).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, Api = Ops.Api;
  var T = window.t || function (k) { return k; };

  var state = {
    convs: [], byKey: {}, bookings: {}, staff: [],
    tab: 'all', q: '', me: '',
    openKey: null, screen: null, detailTab: 'chat', pending: [], poll: null, error: false,
  };

  var ATTACH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

  /* ── Timestamp / label helpers (JST-aware; never sort lexically) ─────────── */
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
  function rowTs(r) { return r.received_at || r.created_at || ''; }
  function isAttPlaceholder(s) { return /^\[\d+件の添付ファイルを送信しました\]\s*$/.test(String(s || '').trim()); }

  function normMsg(m) {
    var l = parseLabels(m);
    var internal = !!l.internal;
    var out = !!l.outbound;
    var atts = (!l.deleted && !internal && Array.isArray(l.attachments))
      ? l.attachments.map(function (a) { return (a && a.deleted) ? { deleted: true, name: a.name || 'file' } : { path: a.path, name: a.name || 'file', mime: a.mime || '' }; }).filter(function (a) { return a.deleted || a.path; })
      : [];
    var text = l.deleted ? '' : (m.body_text || m.body || '');
    if (atts.length && isAttPlaceholder(text)) text = '';
    return {
      id: m.id, internal: internal, out: out,
      name: m.sender_name || m.sender || (out ? 'Hello Moving' : (m.email || T('comm.customer'))),
      text: text, attachments: atts,
      deleted: !!l.deleted,
      channel: out ? (l.chat ? 'chat' : 'email') : 'chat',
      ts: rowTs(m),
      read: (m.is_read === true || m.is_read === 1),
    };
  }

  /* ── Build the unified conversation list ─────────────────────────────────── */
  function build(rows, bookings) {
    var bmap = {}; bookings.forEach(function (b) { bmap[b.dbId] = b; });
    state.bookings = bmap;

    var groups = {};
    rows.forEach(function (m) {
      var key = m.thread_id || m.booking_id || m.message_id || m.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });

    var convs = Object.keys(groups).map(function (key) {
      var grp = groups[key].slice().sort(function (a, b) { return tsMs(rowTs(a)) - tsMs(rowTs(b)); });
      var msgs = grp.map(normMsg);

      var isContact = String(key).indexOf('contact:') === 0;
      var cid = '', bookingId = '', ref = '', hasQuote = false, custEmail = '';
      grp.forEach(function (m) {
        var l = parseLabels(m);
        if (l.contact) isContact = true;
        if (!cid && l.cid) cid = l.cid;
        if (!ref && l.ref) ref = l.ref;
        if (l.quote) hasQuote = true;
        if (!bookingId && m.booking_id) bookingId = m.booking_id;
        if (!custEmail && !l.outbound && !l.internal && m.email) custEmail = m.email;
      });
      if (isContact && !cid) cid = String(key).indexOf('contact:') === 0 ? String(key).slice(8) : '';

      var bk = state.bookings[bookingId] || null;

      // Conversation-level operational state = the latest NON-internal row (so an
      // internal note never flips status/archive; a new CUSTOMER message reopens).
      var assignee = '', convStatus = 'open', archived = false;
      for (var i = grp.length - 1; i >= 0; i--) {
        if (parseLabels(grp[i]).internal) continue;
        assignee   = String(grp[i].assignee || '');
        convStatus = String(grp[i].status || 'open');
        archived   = (grp[i].archived === 1 || grp[i].archived === true);
        break;
      }

      var name = (bk && bk.name) || '';
      if (!name) { for (var j = 0; j < msgs.length; j++) { if (!msgs[j].out && !msgs[j].internal) { name = msgs[j].name; break; } } }

      // Type: contact → お問い合わせ; booking + (quote or pre-confirm) → 見積もり;
      // booking otherwise → 予約; no booking + not contact → email.
      var type;
      if (isContact) type = 'contact';
      else if (bookingId) {
        var st = bk ? bk.statusRaw : '';
        type = (hasQuote || st === 'pending' || st === 'checking') ? 'estimate' : 'booking';
      } else type = 'email';

      var visible = msgs.filter(function (m) { return !m.internal; });
      var last = visible[visible.length - 1] || msgs[msgs.length - 1] || { text: '', ts: '' };
      var anchor = grp[0] || {};

      return {
        key: key, threadId: (String(key).indexOf(':') > 0 ? key : (grp[0] && grp[0].thread_id) || ''),
        type: type, isContact: isContact, cid: cid, bookingId: bookingId,
        ref: ref || (bk && bk.ref) || '',
        name: name || custEmail || T('comm.customer'),
        email: custEmail || (bk && bk.email) || '',
        booking: bk, hasQuote: hasQuote,
        messages: msgs,
        anchorId: anchor.id || '', anchorLabels: parseLabels(anchor),
        assignee: assignee, convStatus: convStatus, archived: archived,
        priority: (parseLabels(anchor).priority) || 'normal',
        lastText: last.deleted ? '（削除されたメッセージ）' : (last.text || ''),
        lastTs: last.ts,
        unread: visible.filter(function (m) { return !m.out && !m.read; }).length,
        canReply: isContact ? !!cid : !!bookingId,   // email-only threads: read-only in OPS
        canAttach: !!bookingId && !isContact,
      };
    });

    convs.sort(function (a, b) { return tsMs(b.lastTs) - tsMs(a.lastTs); });
    state.convs = convs;
    state.byKey = {};
    convs.forEach(function (c) { state.byKey[c.key] = c; });
  }

  /* ── Filtering / search ──────────────────────────────────────────────────── */
  var FILTERS = ['all', 'unread', 'contact', 'estimate', 'booking', 'mine', 'unassigned', 'active', 'waiting', 'resolved', 'archived'];

  function filterMatch(c, f) {
    switch (f) {
      case 'unread':     return c.unread > 0;
      case 'contact':    return c.type === 'contact';
      case 'estimate':   return c.type === 'estimate';
      case 'booking':    return c.type === 'booking';
      case 'mine':       return !!c.assignee && c.assignee.toLowerCase() === state.me;
      case 'unassigned': return !c.assignee;
      case 'active':     return !c.archived && (c.convStatus === 'open' || c.convStatus === 'pending' || !c.convStatus);
      case 'waiting':    return c.convStatus === 'waiting';
      case 'resolved':   return c.convStatus === 'resolved' || c.convStatus === 'closed';
      case 'archived':   return c.archived;
      default:           return true;   // all
    }
  }
  function searchMatch(c) {
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    if ((c.name + ' ' + c.ref + ' ' + c.cid + ' ' + c.email).toLowerCase().indexOf(q) >= 0) return true;
    return c.messages.some(function (m) { return !m.internal && (m.text || '').toLowerCase().indexOf(q) >= 0; });
  }
  function visibleConvs() { return state.convs.filter(function (c) { return filterMatch(c, state.tab) && searchMatch(c); }); }
  function totalUnread() { return state.convs.reduce(function (s, c) { return s + c.unread; }, 0); }

  /* ── List rendering ──────────────────────────────────────────────────────── */
  function typeBadge(type) {
    var cls = { contact: 'cc-t-contact', estimate: 'cc-t-estimate', booking: 'cc-t-booking', email: 'cc-t-email' }[type] || 'cc-t-email';
    return '<span class="cc-type ' + cls + '">' + U.esc(T('comm.type.' + type)) + '</span>';
  }
  function convRow(c) {
    var preview = c.lastText ? U.esc(c.lastText.slice(0, 48)) : '（添付ファイル）';
    var prio = c.priority === 'high' ? '<span class="cc-prio-dot" title="' + U.esc(T('comm.prio.high')) + '">●</span>' : '';
    var idLabel = c.cid ? c.cid : (c.ref || '');
    return '<div class="ops-row tap' + (c.unread ? ' cc-unread' : '') + '" data-open="' + U.esc(c.key) + '">' +
      '<div class="ops-avatar">' + U.initials(c.name) + '</div>' +
      '<div class="ops-row-main">' +
        '<div class="ops-row-title">' + prio + U.esc(c.name) +
          (idLabel ? '<span class="ops-muted" style="font-weight:500;font-size:.76rem"> · ' + U.esc(idLabel) + '</span>' : '') + '</div>' +
        '<div class="cc-row-meta2">' + typeBadge(c.type) +
          (c.assignee ? '<span class="cc-assignee">@' + U.esc((c.assignee.split('@')[0]) || c.assignee) + '</span>' : '') +
          (c.archived ? '<span class="cc-archived">' + U.esc(T('comm.f.archived')) + '</span>' : '') + '</div>' +
        '<div class="ops-row-sub">' + preview + '</div>' +
      '</div>' +
      '<div class="ops-row-end"><span class="ops-row-meta">' + U.relTime(c.lastTs) + '</span>' +
        (c.unread ? '<span class="ops-badge-status st-cancel">' + c.unread + '</span>' : '') + '</div>' +
    '</div>';
  }

  function filtersHtml() {
    var un = totalUnread();
    return '<div class="cc-filters">' + FILTERS.map(function (f) {
      var badge = (f === 'unread' && un) ? '<span class="cc-fbadge">' + un + '</span>' : '';
      return '<button class="cc-fbtn' + (state.tab === f ? ' active' : '') + '" data-f="' + f + '">' + U.esc(T('comm.f.' + f)) + badge + '</button>';
    }).join('') + '</div>';
  }

  function renderListBody() {
    var host = document.getElementById('cc-listhost');
    if (!host) return;
    var list = visibleConvs();
    host.innerHTML = list.length
      ? '<div class="mc-count">' + T('comm.count', { n: list.length }) + (totalUnread() ? ' · ' + T('comm.unread', { n: totalUnread() }) : '') + '</div>' +
        '<div id="cc-list">' + list.map(convRow).join('') + '</div>'
      : UI.empty(T('comm.empty'), (state.q || state.tab !== 'all') ? T('bookings.emptyFilteredSub') : T('comm.emptySub'), 'chat');
    host.querySelectorAll('[data-open]').forEach(function (r) {
      r.addEventListener('click', function () { openThread(r.getAttribute('data-open')); });
    });
  }

  function renderShell() {
    var el = document.getElementById('ops-content');
    el.innerHTML =
      '<div class="mc-search">' + UI.icon('search') +
        '<input id="cc-q" type="search" placeholder="' + U.esc(T('comm.searchPh')) + '" autocomplete="off" />' +
      '</div>' +
      filtersHtml() +
      '<div id="cc-listhost"></div>';
    var q = el.querySelector('#cc-q');
    q.value = state.q;
    q.addEventListener('input', U.debounce(function () { state.q = q.value; renderListBody(); }, 200));
    el.querySelectorAll('[data-f]').forEach(function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-f'); renderShell(); });
    });
    renderListBody();
    UI.setBell(Ops.Notify.unreadCount());
  }

  /* ── Attachments (private `chat` bucket; short-lived signed URLs) ─────────── */
  function attsHtml(atts) {
    if (!atts || !atts.length) return '';
    return '<div class="mc-atts">' + atts.map(function (a) {
      if (a && a.deleted) return '<span class="cc-att-gone">🗑 添付ファイルは削除されました</span>';
      if (/^image\//.test(a.mime || '')) return '<a class="mc-att-img" data-att="' + U.esc(a.path) + '" target="_blank" rel="noopener" title="' + U.esc(a.name) + '"><img alt="' + U.esc(a.name) + '" /></a>';
      return '<a class="mc-att-file" data-att="' + U.esc(a.path) + '" target="_blank" rel="noopener" download>' + UI.icon('inbox') + '<span>' + U.esc(a.name) + '</span></a>';
    }).join('') + '</div>';
  }
  function hydrateAtts(root) {
    if (!root) return;
    root.querySelectorAll('[data-att]').forEach(function (el) {
      if (el.__hy) return; el.__hy = 1;
      var path = el.getAttribute('data-att');
      Api.signChatFile(path, 3600).then(function (url) {
        if (!url) return;
        el.setAttribute('href', url);
        var img = el.querySelector('img');
        if (img) { img.onerror = function () { img.onerror = null; Api.signChatFile(path, 3600).then(function (u2) { if (u2) { el.setAttribute('href', u2); img.src = u2; } }); }; img.src = url; }
      });
    });
  }

  /* ── Thread (full-screen overlay) ────────────────────────────────────────── */
  function bubbles(c) {
    if (!c.messages.length) return '<div class="ops-empty" style="padding:48px 20px">' + UI.icon('chat') + '<h3>' + T('chat.empty') + '</h3><p>' + T('chat.startFirst') + '</p></div>';
    var lastDay = '';
    return c.messages.map(function (m) {
      if (m.internal) {
        return '<div class="cc-note"><span class="cc-note-badge">' + U.esc(T('comm.note.badge')) + '</span>' +
          U.esc(m.text).replace(/\n/g, '<br>') +
          '<span class="cc-note-time">' + U.esc(m.name) + ' · ' + U.fmtTime(m.ts) + '</span></div>';
      }
      var sep = '';
      var day = U.fmtDate(m.ts);
      if (day && day !== lastDay) { sep = '<div class="ops-chat-day">' + day + '</div>'; lastDay = day; }
      if (m.deleted) return sep + '<div class="ops-msg ' + (m.out ? 'out' : 'in') + '" style="opacity:.6;font-style:italic">' + T('chat.deletedMsg') + '</div>';
      var mts = (window.HMFmt ? HMFmt.msgTime(m.ts) : U.fmtTime(m.ts));
      var meta = '<span class="ops-msg-time">' + (m.out && m.channel === 'email' ? '📧 ' : '') + mts + (m.out ? (m.read ? ' · ' + T('chat.read') : ' · ' + T('chat.sent')) : '') + '</span>';
      var textHtml = m.text ? U.esc(m.text).replace(/\n/g, '<br>') : '';
      return sep + '<div class="ops-msg ' + (m.out ? 'out' : 'in') + (m.channel === 'email' ? ' email' : '') + '">' + attsHtml(m.attachments) + textHtml + meta + '</div>';
    }).join('');
  }

  function statusChip(c) {
    var map = { open: 'comm.st.open', pending: 'comm.st.open', waiting: 'comm.st.waiting', resolved: 'comm.st.resolved', closed: 'comm.st.resolved' };
    return T(map[c.convStatus] || 'comm.st.open');
  }

  function detailHtml(c) {
    var b = c.booking;
    var rows = '';
    if (b) {
      var addr = (b.fromAddr || b.toAddr)
        ? ('<div class="mc-kv"><span class="k">' + T('customers.currentAddr') + '</span><span class="v">' + (Ops.addrHtml(b, 'from') || '—') + '</span></div>' +
           (b.toAddr ? '<div class="mc-kv"><span class="k">' + T('customers.destAddr') + '</span><span class="v">' + (Ops.addrHtml(b, 'to') || '—') + '</span></div>' : ''))
        : '';
      rows =
        '<div class="mc-sec">' + T('customers.customerInfo') + '</div>' +
        '<div class="mc-card">' +
          kvA(T('customers.name'), b.name ? b.name + T('common.honorific') : '') +
          kvA(T('bookings.phone'), b.phone) + kvA(T('bookings.email'), b.email) + '</div>' +
        '<div class="mc-sec">' + T('chat.moving') + '</div>' +
        '<div class="mc-card">' + kv(T('bookings.service'), b.service) + kv(T('bookings.moveDate'), U.fmtDateFull(b.date)) +
          (b.time ? kv(T('bookings.timeSlot'), b.time) : '') + kv(T('common.status'), T('status.' + Ops.toDbStatus(b.status))) + '</div>' +
        (addr ? '<div class="mc-sec">' + T('customers.addresses') + '</div><div class="mc-card">' + addr + '</div>' : '') +
        (b.items && b.items.length ? '<div class="mc-sec">' + T('furniture.title') + '</div>' + (window.HMFmt ? HMFmt.furnitureGrid(b.items) : '') : '');
    } else if (c.isContact) {
      rows = '<div class="mc-sec">' + T('comm.type.contact') + '</div><div class="mc-card">' +
        kv('ID', c.cid) + kvA(T('customers.name'), c.name) + kvA(T('bookings.email'), c.email) +
        '<div class="mc-kv"><span class="k">' + T('comm.status') + '</span><span class="v" id="cc-ccmeta">…</span></div></div>';
    } else {
      rows = '<div class="mc-card"><p class="mc-none">' + T('calendar.noBookingLinked') + '</p></div>';
    }

    // ── Management controls (assignment / status / priority / archive / note) ──
    var assignedLabel = c.assignee ? ('@' + (c.assignee.split('@')[0] || c.assignee)) : T('comm.unassigned');
    var staffOpts = state.staff.filter(function (s) { return s && s.email; }).map(function (s) {
      return '<option value="' + U.esc(s.email) + '"' + (c.assignee && c.assignee.toLowerCase() === s.email.toLowerCase() ? ' selected' : '') + '>@' + U.esc(s.name || s.email.split('@')[0]) + '</option>';
    }).join('');
    var mgmt =
      '<div class="mc-sec">' + T('comm.context') + '</div>' +
      '<div class="mc-card cc-mgmt">' +
        '<div class="cc-ctl"><span class="cc-ctl-k">' + T('comm.assignee') + '</span>' +
          '<span class="cc-ctl-v">' + U.esc(assignedLabel) + '</span></div>' +
        (staffOpts ? '<select class="cc-select" id="cc-assign"><option value="">' + T('comm.unassign') + '</option>' + staffOpts + '</select>'
                   : '<div class="cc-ctl-btns"><button class="ops-btn ghost cc-mini" id="cc-assign-me">' + T('comm.assignMe') + '</button>' +
                     (c.assignee ? '<button class="ops-btn ghost cc-mini" id="cc-unassign">' + T('comm.unassign') + '</button>' : '') + '</div>') +
        '<div class="cc-ctl"><span class="cc-ctl-k">' + T('comm.status') + '</span></div>' +
        '<div class="cc-seg" id="cc-status">' +
          '<button data-st="open"'     + (c.convStatus === 'open' || c.convStatus === 'pending' ? ' class="on"' : '') + '>' + T('comm.st.open') + '</button>' +
          '<button data-st="waiting"'  + (c.convStatus === 'waiting' ? ' class="on"' : '') + '>' + T('comm.st.waiting') + '</button>' +
          '<button data-st="resolved"' + (c.convStatus === 'resolved' || c.convStatus === 'closed' ? ' class="on"' : '') + '>' + T('comm.st.resolved') + '</button>' +
        '</div>' +
        '<div class="cc-ctl"><span class="cc-ctl-k">' + T('comm.priority') + '</span></div>' +
        '<div class="cc-seg" id="cc-prio">' +
          '<button data-p="normal"' + (c.priority !== 'high' ? ' class="on"' : '') + '>' + T('comm.prio.normal') + '</button>' +
          '<button data-p="high"'   + (c.priority === 'high' ? ' class="on"' : '') + '>' + T('comm.prio.high') + '</button>' +
        '</div>' +
        '<div class="cc-ctl-btns" style="margin-top:10px">' +
          '<button class="ops-btn ghost cc-mini" id="cc-archive">' + (c.archived ? T('comm.unarchive') : T('comm.archive')) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="mc-sec">' + T('comm.note.add') + '</div>' +
      '<div class="mc-card">' +
        '<textarea id="cc-note" class="cc-note-input" rows="2" placeholder="' + U.esc(T('comm.note.ph')) + '"></textarea>' +
        '<div class="cc-note-row"><span class="cc-note-hint">' + T('comm.note.hint') + '</span>' +
          '<button class="ops-btn cc-mini" id="cc-note-add">' + T('comm.note.add') + '</button></div>' +
      '</div>';

    return '<div class="mc-scroll">' + mgmt + rows + '</div>';
  }
  function kv(k, v) { return v ? '<div class="mc-kv"><span class="k">' + k + '</span><span class="v">' + U.esc(v) + '</span></div>' : ''; }
  function kvA(k, v) { return '<div class="mc-kv"><span class="k">' + k + '</span><span class="v">' + (v ? U.esc(v) : '—') + '</span></div>'; }

  function composerHtml(c) {
    if (state.detailTab !== 'chat') return '';
    if (!c.canReply) return '<div class="ops-chat-locked">' + T('comm.locked') + '</div>';
    return '<div class="ops-composer cc-composer">' +
      (c.canAttach ? '<button class="cc-attach" id="cc-attach" aria-label="' + U.esc(T('chat.attachAria')) + '">' + ATTACH_SVG + '</button>' +
        '<input type="file" id="cc-file" accept="image/*,application/pdf,.doc,.docx" multiple hidden />' : '') +
      '<div class="cc-cmid"><div class="cc-pending" id="cc-pending" style="display:none"></div>' +
        '<textarea id="cc-input" rows="1" placeholder="' + U.esc(T('comm.replyPh')) + '"></textarea></div>' +
      '<button id="cc-send" aria-label="' + U.esc(T('chat.sendAria')) + '">' + UI.icon('send') + '</button>' +
    '</div>';
  }

  function threadHtml(c) {
    var body = state.detailTab === 'detail' ? detailHtml(c)
      : '<div class="ops-chat-scroll" id="cc-scroll">' + bubbles(c) + '</div>';
    return '<div class="ops-chat-inner">' +
      '<div class="ops-chat-hd">' +
        '<button class="ops-back" id="cc-back" aria-label="' + U.esc(T('common.back')) + '">' + UI.icon('back') + '</button>' +
        '<div class="ops-avatar">' + U.initials(c.name) + '</div>' +
        '<div class="ops-chat-hd-main">' +
          '<div class="ops-chat-hd-name">' + U.esc(c.name) + T('common.honorific') + '</div>' +
          '<div class="ops-chat-hd-sub">' + typeBadge(c.type) + '<span class="cc-hd-status">' + U.esc(statusChip(c)) + '</span>' +
            (c.cid ? ' · ' + U.esc(c.cid) : (c.ref ? ' · ' + U.esc(c.ref) : '')) + '</div>' +
        '</div>' +
        (c.booking && c.booking.phone ? '<a class="ops-chat-call" href="tel:' + U.esc(c.booking.phone) + '">' + UI.icon('phone') + '</a>' : '') +
      '</div>' +
      '<div class="cc-dtabs">' +
        '<button class="cc-dtab' + (state.detailTab === 'chat' ? ' active' : '') + '" data-dt="chat">' + T('comm.tab.chat') + '</button>' +
        '<button class="cc-dtab' + (state.detailTab === 'detail' ? ' active' : '') + '" data-dt="detail">' + T('comm.tab.detail') + '</button>' +
      '</div>' +
      '<div class="cc-thd-body">' + body + '</div>' +
      composerHtml(c) +
    '</div>';
  }

  function openThread(key) {
    var c = state.byKey[key];
    if (!c) { var bk = state.bookings[key]; if (!bk) return; c = virtualBooking(bk); state.byKey[key] = c; }
    state.openKey = key; state.detailTab = 'chat'; state.pending = [];

    var scr = document.createElement('div');
    scr.className = 'ops-chat-screen';
    scr.innerHTML = threadHtml(c);
    document.body.appendChild(scr);
    state.screen = scr;
    var nav = document.querySelector('.ops-nav'); if (nav) nav.classList.add('ops-hide');
    wireThread(c);
    scrollBottom();
    markRead(c);
  }
  function virtualBooking(bk) {
    return { key: bk.dbId, threadId: 'chat:' + bk.dbId, type: (bk.statusRaw === 'pending' || bk.statusRaw === 'checking') ? 'estimate' : 'booking',
      isContact: false, cid: '', bookingId: bk.dbId, ref: bk.ref, name: bk.name, email: bk.email, booking: bk,
      messages: [], anchorId: '', anchorLabels: {}, assignee: '', convStatus: 'open', archived: false, priority: 'normal',
      unread: 0, canReply: true, canAttach: true };
  }
  function closeThread() {
    if (state.screen) { state.screen.remove(); state.screen = null; }
    state.openKey = null;
    var nav = document.querySelector('.ops-nav'); if (nav) nav.classList.remove('ops-hide');
    renderShell();
  }
  function scrollBottom() { var s = document.getElementById('cc-scroll'); if (s) s.scrollTop = s.scrollHeight; }

  function wireThread(c) {
    var scr = state.screen; if (!scr) return;
    scr.querySelector('#cc-back').addEventListener('click', closeThread);
    scr.querySelectorAll('[data-dt]').forEach(function (b) {
      b.addEventListener('click', function () { state.detailTab = b.getAttribute('data-dt'); rerenderOpen(); });
    });
    if (state.detailTab === 'chat') {
      var input = scr.querySelector('#cc-input'), send = scr.querySelector('#cc-send');
      if (input && send) {
        input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 96) + 'px'; });
        send.addEventListener('click', function () { doSend(c); });
      }
      var attach = scr.querySelector('#cc-attach'), file = scr.querySelector('#cc-file');
      if (attach && file) { attach.addEventListener('click', function () { file.click(); }); file.addEventListener('change', function () { handleFiles(c, file.files); file.value = ''; }); }
      renderPending();
      hydrateAtts(document.getElementById('cc-scroll'));
    } else {
      wireDetail(c);
    }
  }

  function wireDetail(c) {
    var scr = state.screen; if (!scr) return;
    // Lazy Contact Chat meta (status/last activity) for contact conversations.
    if (c.isContact && c.cid) {
      var el = scr.querySelector('#cc-ccmeta');
      if (el) Api.contactMeta(c.cid).then(function (d) { if (el && d) el.textContent = (d.status || 'open') + (d.last_customer_activity ? ' · 最終 ' + U.fmtDate(d.last_customer_activity) : ''); });
    }
    var assign = scr.querySelector('#cc-assign');
    if (assign) assign.addEventListener('change', function () { doAssign(c, assign.value); });
    var me = scr.querySelector('#cc-assign-me'); if (me) me.addEventListener('click', function () { doAssign(c, state.me); });
    var un = scr.querySelector('#cc-unassign'); if (un) un.addEventListener('click', function () { doAssign(c, ''); });
    var st = scr.querySelector('#cc-status'); if (st) st.querySelectorAll('[data-st]').forEach(function (b) { b.addEventListener('click', function () { doStatus(c, b.getAttribute('data-st')); }); });
    var pr = scr.querySelector('#cc-prio'); if (pr) pr.querySelectorAll('[data-p]').forEach(function (b) { b.addEventListener('click', function () { doPriority(c, b.getAttribute('data-p')); }); });
    var ar = scr.querySelector('#cc-archive'); if (ar) ar.addEventListener('click', function () { doArchive(c, !c.archived); });
    var nb = scr.querySelector('#cc-note-add'); if (nb) nb.addEventListener('click', function () { doNote(c); });
  }

  function rerenderOpen() {
    if (!state.openKey || !state.screen) return;
    var c = state.byKey[state.openKey]; if (!c) return;
    var scroll = document.getElementById('cc-scroll');
    var atBottom = scroll ? (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80) : true;
    var val = (document.getElementById('cc-input') || {}).value || '';
    state.screen.innerHTML = threadHtml(c);
    wireThread(c);
    var input = document.getElementById('cc-input'); if (input) input.value = val;
    if (state.detailTab === 'chat' && atBottom) scrollBottom();
  }

  /* ── Reply (contact-chat.php admin-reply OR chat.php via Api.sendChat) ────── */
  function doSend(c) {
    var input = document.getElementById('cc-input'), btn = document.getElementById('cc-send');
    var text = (input && input.value || '').trim();
    var atts = state.pending.filter(function (a) { return a.path && !a.uploading; });
    if ((!text && !atts.length) || !c.canReply) return;
    if (state.pending.some(function (a) { return a.uploading; })) { UI.toast(T('common.saving')); return; }
    if (btn) btn.disabled = true;

    var done = function (ok, errMsg) {
      if (btn) btn.disabled = false;
      if (!ok) { UI.toast(T('comm.replyFailed') + (errMsg ? '：' + errMsg : '')); return; }
      if (input) { input.value = ''; input.style.height = 'auto'; }
      state.pending = []; renderPending();
      var now = new Date().toISOString();
      c.messages.push({ id: 'tmp-' + now, internal: false, out: true, name: 'Hello Moving', text: text, attachments: atts, deleted: false, channel: 'chat', ts: now, read: true });
      c.lastText = text || '（添付ファイル）'; c.lastTs = now; c.convStatus = 'open';
      var scr = document.getElementById('cc-scroll'); if (scr) { scr.innerHTML = bubbles(c); scrollBottom(); hydrateAtts(scr); }
      Api.auditAction('reply', c.key, { type: c.type, ref: c.ref, cid: c.cid }, state.me);
      UI.toast(T('comm.replySent'));
    };

    if (c.isContact) {
      Api.contactReply(c.cid, text).then(function (res) { done(res.ok, res.error); });
    } else {
      Api.sendChat(c.bookingId, text, c.ref, c.email, atts).then(function (res) { done(res.ok, res.error && (res.error.message || res.error)); });
    }
  }

  function handleFiles(c, files) {
    if (!files || !c.canAttach) return;
    Array.prototype.slice.call(files).forEach(function (f0) {
      if (state.pending.length >= 10) { UI.toast(T('chat.sendFailed')); return; }
      var tok = { name: f0.name, uploading: true };
      state.pending.push(tok); renderPending();
      Promise.resolve(window.HMImageCompress ? HMImageCompress.process(f0) : f0).then(function (f) {
        tok.name = f.name; renderPending();
        Api.uploadChatFile(c.bookingId, f).then(function (res) {
          var i = state.pending.indexOf(tok);
          if (!res.ok) { if (i >= 0) state.pending.splice(i, 1); renderPending(); UI.toast(T('chat.sendFailed') + '：' + (res.error || '')); return; }
          if (i >= 0) state.pending[i] = { path: res.path, name: res.name, mime: res.mime, size: res.size };
          renderPending();
        });
      });
    });
  }
  function renderPending() {
    var host = document.getElementById('cc-pending'); if (!host) return;
    host.innerHTML = state.pending.map(function (a, i) {
      return '<span class="mc-pchip' + (a.uploading ? ' up' : '') + '">' + (a.uploading ? '<span class="ops-spin"></span>' : '') + U.esc(a.name) + (a.uploading ? '' : '<button type="button" data-rm="' + i + '">×</button>') + '</span>';
    }).join('');
    host.style.display = state.pending.length ? 'flex' : 'none';
    host.querySelectorAll('[data-rm]').forEach(function (b) { b.addEventListener('click', function () { state.pending.splice(+b.getAttribute('data-rm'), 1); renderPending(); }); });
  }

  /* ── Management actions (existing columns / labels; each audited) ─────────── */
  function doAssign(c, who) {
    Api.setAssignee(c, who).then(function (res) {
      if (res.error) { UI.toast(T('common.saveFailed')); return; }
      c.assignee = who || '';
      Api.auditAction(who ? 'assign' : 'unassign', c.key, { assignee: who }, state.me);
      UI.toast(T('common.saved')); rerenderOpen();
    });
  }
  function doStatus(c, st) {
    Api.setConvStatus(c, st).then(function (res) {
      if (res.error) { UI.toast(T('common.saveFailed')); return; }
      c.convStatus = st;
      Api.auditAction('status', c.key, { status: st }, state.me);
      UI.toast(T('common.saved')); rerenderOpen();
    });
  }
  function doPriority(c, p) {
    Api.setPriority(c, p, c.anchorLabels).then(function (res) {
      if (res.error) { UI.toast(T('common.saveFailed')); return; }
      c.priority = p; c.anchorLabels = Object.assign({}, c.anchorLabels, p === 'high' ? { priority: 'high' } : {});
      if (p !== 'high') delete c.anchorLabels.priority;
      Api.auditAction('priority', c.key, { priority: p }, state.me);
      UI.toast(T('common.saved')); rerenderOpen();
    });
  }
  function doArchive(c, on) {
    Api.setArchived(c, on).then(function (res) {
      if (res.error) { UI.toast(T('common.saveFailed')); return; }
      c.archived = !!on;
      Api.auditAction(on ? 'archive' : 'unarchive', c.key, {}, state.me);
      UI.toast(T('common.saved')); rerenderOpen();
    });
  }
  function doNote(c) {
    var ta = document.getElementById('cc-note'); var text = (ta && ta.value || '').trim();
    if (!text) return;
    var btn = document.getElementById('cc-note-add'); if (btn) btn.disabled = true;
    Api.addInternalNote(c, text, state.me).then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.ok) { UI.toast(T('common.saveFailed')); return; }
      if (ta) ta.value = '';
      c.messages.push({ id: res.row.id, internal: true, out: false, name: state.me || T('comm.staff'), text: text, attachments: [], deleted: false, channel: 'chat', ts: new Date().toISOString(), read: true });
      Api.auditAction('internal_note', c.key, { len: text.length }, state.me);
      UI.toast(T('comm.note.saved'));
    });
  }

  function markRead(c) {
    if (!c.unread) return;
    Api.markThreadRead(c).then(function () { c.messages.forEach(function (m) { m.read = true; }); c.unread = 0; });
  }

  /* ── Load / poll ─────────────────────────────────────────────────────────── */
  function load(initial) {
    if (initial) document.getElementById('ops-content').innerHTML = UI.skeleton(6);
    return Promise.all([Api.listInbox(), Api.listBookings()]).then(function (r) {
      if ((r[0].error && !(r[0].data && r[0].data.length)) && (r[1].error && !(r[1].data && r[1].data.length))) {
        state.error = true;
        document.getElementById('ops-content').innerHTML = UI.empty(T('comm.errorTitle'), T('bookings.errorSub'), 'empty');
        return;
      }
      state.error = false;
      build(r[0].data || [], r[1].data || []);
      var inbound = (r[0].data || []).filter(function (m) { var l = parseLabels(m); return !l.outbound && !l.internal; });
      Ops.Notify.syncMessages(inbound);
      Ops.Notify.syncBookings(r[1].data || []);
      if (state.openKey) {
        var fresh = state.byKey[state.openKey];
        if (fresh) { rerenderOpen(); markRead(fresh); }
      } else {
        renderShell();
      }
      UI.setBell(Ops.Notify.unreadCount());
    });
  }

  Ops.ready(function () {
    state.me = String(((Ops.Auth.user() || {}).email) || '').toLowerCase();
    UI.mountChrome({ active: 'chat', title: T('comm.title') });
    Api.listStaff().then(function (s) { state.staff = s || []; });
    load(true).then(function () {
      // Deep-link support: ?cid= / ?booking= / ?thread= opens that conversation.
      var qp = new URLSearchParams(location.search);
      var cid = qp.get('cid'), bk = qp.get('booking'), th = qp.get('thread');
      if (cid) openThread('contact:' + cid);
      else if (th && state.byKey[th]) openThread(th);
      else if (bk) openThread(state.byKey['chat:' + bk] ? 'chat:' + bk : bk);
    });
    state.poll = setInterval(function () { if (!state.error) load(false); }, Ops.cfg.POLL_MS);
  });
})();
