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
    if (h < 5) return 'お疲れさまです';
    if (h < 11) return 'おはようございます';
    if (h < 18) return 'こんにちは';
    return 'お疲れさまです';
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
    var name = user.name || user.email || 'スタッフ';

    el.innerHTML =
      '<div style="margin:0 2px 16px">' +
        '<div class="ops-muted" style="font-size:.82rem;font-weight:600">' + greeting() + '</div>' +
        '<div style="font-family:var(--serif);font-size:1.5rem;color:var(--hm-green);line-height:1.2">' + U.esc(name) + ' さん</div>' +
      '</div>' +

      '<div class="ops-stat-grid" style="margin-bottom:12px">' +
        statCard(todays.length, '本日の予約', 'calendar', true) +
        statCard(upcoming.length, '今後の予約', 'bookings') +
      '</div>' +
      '<div class="ops-stat-grid">' +
        statCard(isNew.length, '新規予約', 'inbox') +
        statCard(msgUnread, '未読メッセージ', 'chat') +
      '</div>' +

      '<div class="ops-section-title">本日の予約</div>' +
      (todays.length ? todays.slice(0, 5).map(todayRow).join('') + (todays.length > 5 ? tapMore(todays.length - 5) : '')
                     : UI.empty('本日の予約はありません', '新しい予約が入るとここに表示されます', 'calendar')) +

      '<div class="ops-section-title">クイックアクション</div>' +
      '<div class="ops-quick-grid">' +
        quick('bookings.html', '予約管理', '一覧・検索・状態変更', 'bookings') +
        quick('customers.html', '顧客', 'プロフィール・履歴', 'customers') +
        quick('chat.html', 'チャット', 'お客様と会話', 'chat') +
        quick('calendar.html', 'カレンダー', '空き状況を確認', 'calendar') +
      '</div>' +

      '<div class="ops-section-title">通知</div>' +
      '<a class="ops-row tap" href="notifications.html">' +
        '<div class="ops-avatar" style="background:#eef3e6;color:var(--hm-green)">' + UI.icon('bell') + '</div>' +
        '<div class="ops-row-main"><div class="ops-row-title">通知センター</div>' +
          '<div class="ops-row-sub">' + (notif ? notif + '件の未読通知' : '未読はありません') + '</div></div>' +
        '<div class="ops-row-end">' + (notif ? '<span class="ops-badge-status st-new">' + notif + '</span>' : UI.icon('chevronR')) + '</div>' +
      '</a>' +

      '<div class="ops-section-title">アカウント</div>' +
      '<div class="ops-card" style="padding:12px 14px">' +
        '<div class="ops-row-title" style="font-size:.92rem">' + U.esc(name) + '</div>' +
        (user.email ? '<div class="ops-row-sub" style="margin-bottom:12px">' + U.esc(user.email) + '</div>' : '<div style="height:12px"></div>') +
        '<button class="ops-btn ghost" id="ops-logout">' + UI.icon('logout') + 'ログアウト</button>' +
      '</div>';

    var lo = document.getElementById('ops-logout');
    if (lo) lo.addEventListener('click', function () {
      if (confirm('ログアウトしますか？')) { lo.disabled = true; lo.innerHTML = '<span class="ops-spin"></span>'; Ops.Auth.logout(); }
    });
  }

  function todayRow(b) {
    return '<a class="ops-row tap" href="bookings.html?ref=' + encodeURIComponent(b.ref) + '">' +
      '<div class="ops-avatar">' + U.initials(b.name) + '</div>' +
      '<div class="ops-row-main">' +
        '<div class="ops-row-title">' + U.esc(b.name) + '様</div>' +
        '<div class="ops-row-sub">' + U.esc(b.service || 'ご予約') + (b.time ? ' · ' + U.esc(b.time) : '') + '</div>' +
      '</div>' +
      '<div class="ops-row-end">' + UI.statusBadge(b.status) + '</div>' +
    '</a>';
  }
  function tapMore(n) {
    return '<a class="ops-row tap" href="bookings.html" style="justify-content:center;color:var(--hm-green);font-weight:700">他 ' + n + ' 件を表示 →</a>';
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
        el.insertAdjacentHTML('afterbegin', '<div class="ops-card" style="border-color:var(--st-cancel);color:var(--st-cancel);font-size:.85rem">データの取得に失敗しました。接続を確認してください。</div>');
      }
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: 'dashboard', title: 'ダッシュボード' });
    load();
    // Gentle refresh so counters stay live while the app is open.
    setInterval(load, Ops.cfg.POLL_MS * 2);
  });
})();
