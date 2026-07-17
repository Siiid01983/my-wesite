/* ════════════════════════════════════════════════════════════════════════════
   dashboard.js — M1 Dashboard (/ops/index.html)

   Read-only overview: today's / upcoming / new bookings, unread messages,
   notification count, plus quick-action cards. Reuses rest.php (bookings,
   inbox_messages) through Ops.Api. Modifies no booking/pricing/slot logic.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI;

  function statCard(num, label, icon, accent) {
    return '<div class="ops-stat' + (accent ? ' accent' : '') + '">' +
      '<div class="ops-stat-ico">' + UI.icon(icon) + '</div>' +
      '<div class="ops-stat-num">' + num + '</div>' +
      '<div class="ops-stat-label">' + label + '</div>' +
    '</div>';
  }

  function quick(href, title, sub, icon) {
    return '<a class="ops-quick" href="' + href + '">' +
      '<div class="ops-quick-ico">' + UI.icon(icon) + '</div>' +
      '<div class="ops-quick-title">' + title + '</div>' +
      '<div class="ops-quick-sub">' + sub + '</div>' +
    '</a>';
  }

  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return t('dashboard.greetEvening');
    if (h < 11) return t('dashboard.greetMorning');
    if (h < 18) return t('dashboard.greetDay');
    return t('dashboard.greetEvening');
  }

  function render(data) {
    var el = document.getElementById('ops-content');
    var b = data.bookings, msgUnread = data.msgUnread, notif = Ops.Notify.unreadCount();
    var today = U.todayStr();

    var active = b.filter(function (x) { return x.status !== 'キャンセル' && x.status !== '完了'; });
    var todays = active.filter(function (x) { return x.date === today; });
    var upcoming = active.filter(function (x) { return x.date > today; });
    var isNew = b.filter(function (x) { return x.status === '新規'; });

    var user = Ops.Auth.user() || {};
    var name = user.name || user.email || t('common.staff');

    el.innerHTML =
      '<div style="margin:0 2px 16px">' +
        '<div class="ops-muted" style="font-size:.82rem;font-weight:600">' + greeting() + '</div>' +
        '<div style="font-family:var(--serif);font-size:1.5rem;color:var(--hm-green);line-height:1.2">' + U.esc(name) + ' ' + t('common.san') + '</div>' +
      '</div>' +

      '<div class="ops-stat-grid" style="margin-bottom:12px">' +
        statCard(todays.length, t('calendar.todayBookings'), 'calendar', true) +
        statCard(upcoming.length, t('dashboard.statUpcoming'), 'bookings') +
      '</div>' +
      '<div class="ops-stat-grid">' +
        statCard(isNew.length, t('dashboard.statNew'), 'inbox') +
        statCard(msgUnread, t('dashboard.statUnread'), 'chat') +
      '</div>' +

      '<div class="ops-section-title">' + t('calendar.todayBookings') + '</div>' +
      (todays.length ? todays.slice(0, 5).map(todayRow).join('') + (todays.length > 5 ? tapMore(todays.length - 5) : '')
                     : UI.empty(t('dashboard.todayNone'), t('bookings.emptySub'), 'calendar')) +

      '<div class="ops-section-title">' + t('bookings.quickActions') + '</div>' +
      '<div class="ops-quick-grid">' +
        quick('bookings.html', t('dashboard.qBookings'), t('dashboard.qBookingsSub'), 'bookings') +
        quick('customers.html', t('dashboard.qCustomers'), t('dashboard.qCustomersSub'), 'customers') +
        quick('chat.html', t('dashboard.qChat'), t('dashboard.qChatSub'), 'chat') +
        quick('calendar.html', t('dashboard.qCalendar'), t('dashboard.qCalendarSub'), 'calendar') +
      '</div>' +

      '<div class="ops-section-title">' + t('dashboard.notif') + '</div>' +
      '<a class="ops-row tap" href="notifications.html">' +
        '<div class="ops-avatar" style="background:#eef3e6;color:var(--hm-green)">' + UI.icon('bell') + '</div>' +
        '<div class="ops-row-main"><div class="ops-row-title">' + t('notif.title') + '</div>' +
          '<div class="ops-row-sub">' + (notif ? t('dashboard.notifUnread', { n: notif }) : t('dashboard.notifNone')) + '</div></div>' +
        '<div class="ops-row-end">' + (notif ? '<span class="ops-badge-status st-new">' + notif + '</span>' : UI.icon('chevronR')) + '</div>' +
      '</a>' +
      '<a class="ops-row tap" href="settings.html">' +
        '<div class="ops-avatar" style="background:#eef0ea;color:var(--hm-green)">' + UI.icon('settings') + '</div>' +
        '<div class="ops-row-main"><div class="ops-row-title">' + t('settings.title') + '</div>' +
          '<div class="ops-row-sub">' + t('dashboard.settingsSub') + '</div></div>' +
        '<div class="ops-row-end">' + UI.icon('chevronR') + '</div>' +
      '</a>';
  }

  function todayRow(b) {
    return '<a class="ops-row tap" href="bookings.html?ref=' + encodeURIComponent(b.ref) + '">' +
      '<div class="ops-avatar">' + U.initials(b.name) + '</div>' +
      '<div class="ops-row-main">' +
        '<div class="ops-row-title">' + U.esc(b.name) + t('common.honorific') + '</div>' +
        '<div class="ops-row-sub">' + U.esc(b.service || t('common.booking')) + (b.time ? ' · ' + U.esc(b.time) : '') + '</div>' +
      '</div>' +
      '<div class="ops-row-end">' + UI.statusBadge(b.status) + '</div>' +
    '</a>';
  }
  function tapMore(n) {
    return '<a class="ops-row tap" href="bookings.html" style="justify-content:center;color:var(--hm-green);font-weight:700">' + t('dashboard.showMore', { n: n }) + '</a>';
  }

  function load() {
    var el = document.getElementById('ops-content');
    el.innerHTML = '<div style="height:120px" class="ops-skel"></div><div style="height:14px"></div><div class="ops-stat-grid"><div class="ops-skel" style="height:90px"></div><div class="ops-skel" style="height:90px"></div></div>';

    Promise.all([Ops.Api.listBookings(), Ops.Api.listInbox()]).then(function (r) {
      var bookings = r[0].data || [];
      var inbox = r[1].data || [];
      // Inbound (customer) unread messages = not outbound + is_read == 0.
      var inbound = inbox.filter(function (m) {
        var labels = m.labels || {};
        if (typeof labels === 'string') { try { labels = JSON.parse(labels); } catch (_) { labels = {}; } }
        return !labels.outbound;
      });
      var unread = inbound.filter(function (m) { return !(m.is_read === true || m.is_read === 1); }).length;

      // Feed the local notification store; refresh the bell.
      Ops.Notify.syncBookings(bookings);
      Ops.Notify.syncMessages(inbound);
      UI.setBell(Ops.Notify.unreadCount());

      render({ bookings: bookings, msgUnread: unread });

      if (r[0].error && !bookings.length) {
        el.insertAdjacentHTML('afterbegin', '<div class="ops-card" style="border-color:var(--st-cancel);color:var(--st-cancel);font-size:.85rem">' + t('dashboard.loadError') + '</div>');
      }
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: 'dashboard', title: t('dashboard.title') });
    load();
    // Gentle refresh so counters stay live while the app is open.
    setInterval(load, Ops.cfg.POLL_MS * 2);
  });
})();
