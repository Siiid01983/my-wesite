/* ════════════════════════════════════════════════════════════════════════════
   notifications.js — M6 Notifications (/ops/notifications.html)

   Renders the lightweight local notification store (Ops.Notify) — new bookings,
   new messages, status changes — derived by polling the existing rest.php data.
   No push service yet; the store shape ({id,type,title,text,ts,read,link}) and the
   Ops.Notify.registerPush() stub below are ready to be wired to Web Push / LINE
   later without changing any page code.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, Api = Ops.Api;

  var TYPE = {
    booking: { cls: 'booking', icon: 'bookings' },
    message: { cls: 'message', icon: 'chat' },
    status:  { cls: 'status',  icon: 'clock' },
  };

  function notifRow(n) {
    var t = TYPE[n.type] || TYPE.status;
    return '<a class="ops-notif' + (n.read ? '' : ' unread') + '" href="' + (n.link || '#') + '" data-id="' + U.esc(n.id) + '">' +
      '<div class="ops-notif-ico ' + t.cls + '">' + UI.icon(t.icon) + '</div>' +
      '<div class="ops-notif-body">' +
        '<div class="ops-notif-title">' + U.esc(n.title) + '</div>' +
        '<div class="ops-notif-text">' + U.esc(n.text || '') + '</div>' +
        '<div class="ops-notif-time">' + U.relTime(new Date(n.ts).toISOString()) + '</div>' +
      '</div>' +
    '</a>';
  }

  function render() {
    var el = document.getElementById('ops-content');
    var list = Ops.Notify.list();
    var unread = Ops.Notify.unreadCount();

    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin:0 2px 12px">' +
        '<div class="ops-muted" style="font-size:.8rem;font-weight:600;flex:1">' + (unread ? '未読 ' + unread + ' 件' : 'すべて既読') + '</div>' +
        (list.length ? '<button class="ops-btn sm ghost" id="ops-read">すべて既読</button>' +
                       '<button class="ops-btn sm ghost" id="ops-clear">クリア</button>' : '') +
      '</div>' +
      (list.length ? '<div id="ops-list">' + list.map(notifRow).join('') + '</div>'
                   : UI.empty('通知はありません', '新しい予約やメッセージが届くとここに表示されます', 'bell'));

    var read = document.getElementById('ops-read');
    var clear = document.getElementById('ops-clear');
    if (read) read.addEventListener('click', function () { Ops.Notify.markAllRead(); UI.setBell(0); render(); });
    if (clear) clear.addEventListener('click', function () { Ops.Notify.clear(); UI.setBell(0); render(); UI.toast('通知をクリアしました'); });

    // Tapping a notification marks just that one read before following the link.
    el.querySelectorAll('[data-id]').forEach(function (a) {
      a.addEventListener('click', function () {
        var arr = Ops.Notify.list();
        var n = arr.filter(function (x) { return x.id === a.getAttribute('data-id'); })[0];
        if (n && !n.read) { n.read = true; try { localStorage.setItem(Ops.Notify.STORE, JSON.stringify(arr)); } catch (_) {} }
      });
    });

    UI.setBell(unread);
  }

  function sync() {
    // Poll the same data the other modules use so this page also generates fresh
    // notifications while it is open.
    Promise.all([Api.listBookings(), Api.listInbox()]).then(function (r) {
      var bookings = r[0].data || [];
      var inbound = (r[1].data || []).filter(function (m) {
        var l = m.labels || {}; if (typeof l === 'string') { try { l = JSON.parse(l); } catch (_) { l = {}; } }
        return !l.outbound;
      });
      Ops.Notify.syncBookings(bookings);
      Ops.Notify.syncMessages(inbound);
      render();
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: '', title: '通知', back: true });
    render();     // instant paint from the local store
    sync();       // then refresh from the server
    setInterval(sync, Ops.cfg.POLL_MS);
  });
})();
