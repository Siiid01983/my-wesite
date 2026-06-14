'use strict';

/* ════════════════════════════════════════════════════════
   MOBILE DASHBOARD — Phase 27B
   Injects mobile-optimised quick-stat cards into the
   dashboard view on screens ≤ 768 px.

   Cards (single-col phone / two-col tablet):
     1. 本日の予約  (today's bookings)
     2. 未処理見積り (pending quotes)
     3. 本日の売上  (revenue today)
     4. カレンダー  (available slots this week)
     5. 通知        (unread push notifications)

   Wraps renderDash() — adds #mobileDashCards grid before the
   main dashboard content, re-renders on every go('dashboard').
   ════════════════════════════════════════════════════════ */

window.MobileDash = (function () {

  var CONTAINER_ID = 'mobileDashCards';

  /* ── Build card data from cached Adapter / calcStats ── */
  function _gather() {
    var bk     = window.Adapter ? (Adapter.getBookings() || []) : [];
    var qt     = window.Adapter && Adapter.getQuotes ? (Adapter.getQuotes() || []) : [];
    var prices = window.Adapter ? (Adapter.getPrices() || {}) : {};
    var avail  = window.Adapter ? (Adapter.getAvail()  || {}) : {};
    var today  = new Date().toISOString().slice(0, 10);

    var todayBk  = bk.filter(function (b) { return b.date === today || b.move_date === today; }).length;
    var pendingQt = qt.filter(function (q) { var s = q.status || ''; return !s || s === 'pending' || s === '保留'; }).length;
    var newBk    = bk.filter(function (b) { return b.status === '新規'; }).length;

    /* Revenue: sum price for non-cancelled bookings today */
    var revToday = 0;
    bk.filter(function (b) {
      return (b.date === today || b.move_date === today) && b.status !== 'キャンセル';
    }).forEach(function (b) {
      var p = prices[b.service] || 0;
      revToday += typeof p === 'number' ? p : ((p && p.base) || 0);
    });

    /* Available slots this week */
    var weekSlots = 0;
    var now = new Date();
    for (var i = 0; i < 7; i++) {
      var d = new Date(now); d.setDate(now.getDate() + i);
      var ds = d.toISOString().slice(0, 10);
      if (!avail[ds] || avail[ds] === 'available') weekSlots++;
    }

    /* Push notification badge count */
    var notifCount = 0;
    try {
      var nb = JSON.parse(localStorage.getItem('hm_push_unread') || '0');
      notifCount = parseInt(nb, 10) || 0;
    } catch (_) {}

    return {
      todayBk:   todayBk,
      pendingQt: pendingQt,
      newBk:     newBk,
      revToday:  revToday,
      weekSlots: weekSlots,
      notifCount: notifCount,
    };
  }

  /* ── Format yen ── */
  function _yen(n) {
    if (!n) return '¥0';
    return '¥' + Math.round(n).toLocaleString('ja-JP');
  }

  /* ── Render one card ── */
  function _card(opts) {
    /* opts: { label, value, sub, iconSvg, iconBg, iconColor, accentColor, onclick } */
    return '<div class="mdc-card" onclick="' + (opts.onclick || '') + '">' +
      '<div class="mdc-card-icon" style="background:' + opts.iconBg + ';color:' + opts.iconColor + '">' +
        '<svg viewBox="0 0 24 24" width="16" height="16">' + opts.iconSvg + '</svg>' +
      '</div>' +
      '<div class="mdc-card-label">' + opts.label + '</div>' +
      '<div class="mdc-card-value">' + opts.value + '</div>' +
      (opts.sub ? '<div class="mdc-card-sub">' + opts.sub + '</div>' : '') +
      '<div class="mdc-card-accent" style="background:' + opts.accentColor + '"></div>' +
    '</div>';
  }

  /* ── Render the cards grid ── */
  function _render() {
    var el = document.getElementById(CONTAINER_ID);
    if (!el) return;

    var d = _gather();

    el.innerHTML =
      _card({
        label:       '本日の予約',
        value:       d.todayBk,
        sub:         d.newBk > 0 ? '新規 ' + d.newBk + '件' : '新規なし',
        iconSvg:     '<path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>',
        iconBg:      'rgba(37,99,235,.1)',
        iconColor:   'var(--blue)',
        accentColor: 'var(--blue)',
        onclick:     'go(\'bookings\')',
      }) +
      _card({
        label:       '未処理見積り',
        value:       d.pendingQt,
        sub:         '対応待ち',
        iconSvg:     '<path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>',
        iconBg:      'rgba(245,158,11,.12)',
        iconColor:   'var(--yellow)',
        accentColor: 'var(--yellow)',
        onclick:     'go(\'quotes\')',
      }) +
      _card({
        label:       '本日の売上',
        value:       _yen(d.revToday),
        sub:         '本日確定分',
        iconSvg:     '<path fill="currentColor" d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>',
        iconBg:      'rgba(16,185,129,.1)',
        iconColor:   'var(--green)',
        accentColor: 'var(--green)',
        onclick:     'go(\'analytics\')',
      }) +
      _card({
        label:       '今週の空き',
        value:       d.weekSlots + '日',
        sub:         '7日間',
        iconSvg:     '<path fill="currentColor" d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/>',
        iconBg:      'rgba(139,92,246,.1)',
        iconColor:   '#8b5cf6',
        accentColor: '#8b5cf6',
        onclick:     'go(\'calendar\')',
      }) +
      _card({
        label:       '通知',
        value:       d.notifCount || '—',
        sub:         d.notifCount > 0 ? '未読あり' : '未読なし',
        iconSvg:     '<path fill="currentColor" d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>',
        iconBg:      'rgba(239,68,68,.08)',
        iconColor:   'var(--red)',
        accentColor: 'var(--red)',
        onclick:     'go(\'mobile-notifications\')',
      });
  }

  /* ── Inject container into dashboard view ── */
  function _inject() {
    var view = document.getElementById('view-dashboard');
    if (!view || document.getElementById(CONTAINER_ID)) return;
    var grid = document.createElement('div');
    grid.id = CONTAINER_ID;
    /* Push permission banner before the cards */
    var banner = document.createElement('div');
    banner.id = 'pushPermBanner';
    banner.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>' +
      '<span class="perm-text">プッシュ通知を有効にして、新着予約をリアルタイムで受け取りましょう</span>' +
      '<button class="btn btn-primary btn-sm" onclick="PushNotifications&&PushNotifications.requestPermission()" style="flex-shrink:0;min-height:36px">有効にする</button>' +
      '<button class="perm-dismiss" onclick="MobileDash.dismissPermBanner()" title="閉じる">×</button>';
    view.insertBefore(banner, view.firstChild);
    view.insertBefore(grid, banner.nextSibling);
  }

  /* ── Dismiss permission banner ── */
  function dismissPermBanner() {
    var el = document.getElementById('pushPermBanner');
    if (el) el.classList.remove('show');
    try { localStorage.setItem('hm_push_banner_dismissed', '1'); } catch (_) {}
  }

  /* ── Check whether to show permission banner ── */
  function _maybeShowPermBanner() {
    var dismissed = false;
    try { dismissed = !!localStorage.getItem('hm_push_banner_dismissed'); } catch (_) {}
    var granted = (typeof Notification !== 'undefined' && Notification.permission === 'granted');
    var el = document.getElementById('pushPermBanner');
    if (!el) return;
    if (!dismissed && !granted && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      el.classList.add('show');
    } else {
      el.classList.remove('show');
    }
  }

  /* ── Public: render cards (called by renderDash wrapper) ── */
  function render() {
    _inject();
    _render();
    _maybeShowPermBanner();
  }

  /* ── Wrap renderDash ── */
  var _origRenderDash = null;
  function _wrapRenderDash() {
    _origRenderDash = window.renderDash;
    if (typeof _origRenderDash !== 'function') return;
    window.renderDash = function () {
      _origRenderDash.apply(this, arguments);
      render();
    };
  }

  /* ── Patch go('dashboard') ── */
  var _origGo = window.go;
  if (typeof _origGo === 'function') {
    window.go = function (view) {
      _origGo(view);
      if (view === 'dashboard') render();
    };
  }

  /* Add VIEW_TITLES entry for mobile-notifications */
  try { VIEW_TITLES['mobile-notifications'] = 'プッシュ通知設定'; } catch (_) {}

  /* Init: wrap renderDash once page is ready */
  (function _init() {
    if (typeof window.renderDash === 'function') {
      _wrapRenderDash();
    } else {
      /* Wait for renderDash to be defined */
      var timer = setInterval(function () {
        if (typeof window.renderDash === 'function') {
          clearInterval(timer);
          _wrapRenderDash();
        }
      }, 50);
      setTimeout(function () { clearInterval(timer); }, 5000);
    }
  })();

  window.MobileDash = { render: render, dismissPermBanner: dismissPermBanner };
  return window.MobileDash;

})();
