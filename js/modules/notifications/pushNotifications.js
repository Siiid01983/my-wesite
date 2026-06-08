'use strict';

/* ════════════════════════════════════════════════════════
   PUSH NOTIFICATIONS — Phase 27C
   Web Notification API integration using the existing PWA
   service worker and EventBus.

   Notification triggers:
     booking:created  → 新着予約
     quote:created    → 新着見積り
     booking:updated  → 予約ステータス変更
     automation:ran   → 自動化完了
     calendar:updated → カレンダー更新

   Permission: Notification API. Settings stored in
   hm_push_settings { version, enabled, events:{} }.
   Unread badge count stored in hm_push_unread.

   Settings view rendered in #view-mobile-notifications.
   ════════════════════════════════════════════════════════ */

window.PushNotifications = (function () {

  var KEY         = 'hm_push_settings';
  var UNREAD_KEY  = 'hm_push_unread';
  var _unread     = 0;

  var EVENT_CONFIG = [
    { id: 'booking_created',  label: '新着予約',           bus: 'booking:created'  },
    { id: 'quote_created',    label: '新着見積り',         bus: 'quote:created'    },
    { id: 'booking_updated',  label: '予約ステータス変更', bus: 'booking:updated'  },
    { id: 'automation_ran',   label: '自動化エンジン完了', bus: 'automation:ran'   },
    { id: 'calendar_updated', label: 'カレンダー更新',     bus: 'calendar:updated' },
  ];

  /* ── Storage ── */
  function _load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.version === 1) return d;
    } catch (_) {}
    var defaults = { version: 1, enabled: true, events: {} };
    EVENT_CONFIG.forEach(function (e) { defaults.events[e.id] = true; });
    return defaults;
  }

  function _save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) {}
  }

  /* ── Unread badge ── */
  function _incUnread() {
    _unread++;
    try { localStorage.setItem(UNREAD_KEY, _unread); } catch (_) {}
    _updateBottomNavBadge();
  }

  function clearUnread() {
    _unread = 0;
    try { localStorage.setItem(UNREAD_KEY, '0'); } catch (_) {}
    _updateBottomNavBadge();
  }

  function _updateBottomNavBadge() {
    if (window.MobileNav) MobileNav.setBadge('mobile-notifications', _unread || 0);
  }

  /* ── Show a Web Notification ── */
  function show(title, body, data) {
    var settings = _load();
    if (!settings.enabled) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;

    var opts = { body: body || '', icon: '/icons/icon.svg', badge: '/icons/icon.svg', tag: title, data: data || {} };
    try {
      /* Use service worker notification when available */
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(function (reg) {
          reg.showNotification(title, opts).catch(function () { new Notification(title, opts); });
        });
      } else {
        new Notification(title, opts);
      }
    } catch (_) {}

    _incUnread();

    /* AuditLog */
    if (window.AuditLog) {
      AuditLog.record('other', 'notifications', 'push_notification', title + ': ' + body);
    }
  }

  /* ── Request permission ── */
  function requestPermission() {
    if (typeof Notification === 'undefined') {
      if (window.toast) toast('このブラウザはプッシュ通知に対応していません');
      return Promise.resolve('unsupported');
    }
    if (Notification.permission === 'granted') {
      if (window.toast) toast('プッシュ通知はすでに有効です');
      return Promise.resolve('granted');
    }
    return Notification.requestPermission().then(function (result) {
      if (result === 'granted') {
        if (window.toast) toast('プッシュ通知を有効にしました ✓');
        /* Dismiss the permission banner */
        var banner = document.getElementById('pushPermBanner');
        if (banner) banner.classList.remove('show');
        try { localStorage.setItem('hm_push_banner_dismissed', '1'); } catch (_) {}
        renderSettings();
      } else {
        if (window.toast) toast('プッシュ通知が拒否されました');
      }
      return result;
    });
  }

  /* ── EventBus wiring ── */
  function _wire() {
    if (!window.EventBus) return;

    EventBus.on('booking:created', function (e) {
      var s = _load();
      if (!s.enabled || !s.events.booking_created) return;
      var b = (e && e.detail && e.detail.booking) || {};
      var name = b.customer_name || b.name || 'お客様';
      show('新着予約', name + ' 様から予約が入りました', { view: 'bookings', id: b.id });
    });

    EventBus.on('quote:created', function (e) {
      var s = _load();
      if (!s.enabled || !s.events.quote_created) return;
      var q = (e && e.detail && e.detail.quote) || {};
      var name = q.name || q.customer_name || 'お客様';
      show('新着見積り依頼', name + ' 様から見積りが届きました', { view: 'quotes', id: q.id });
    });

    EventBus.on('booking:updated', function (e) {
      var s = _load();
      if (!s.enabled || !s.events.booking_updated) return;
      var b = (e && e.detail && e.detail.booking) || {};
      var name = b.customer_name || b.name || '予約';
      show('予約更新', name + ' (' + (b.status || '') + ')', { view: 'bookings', id: b.id });
    });

    EventBus.on('automation:ran', function (e) {
      var s = _load();
      if (!s.enabled || !s.events.automation_ran) return;
      var count = (e && e.detail && e.detail.count) || 0;
      if (count > 0) show('自動化完了', count + '件のアクションを実行しました', { view: 'automation' });
    });

    EventBus.on('calendar:updated', function () {
      var s = _load();
      if (!s.enabled || !s.events.calendar_updated) return;
      show('カレンダー更新', 'カレンダーが更新されました', { view: 'calendar' });
    });
  }

  /* ── Service worker notification click handler ── */
  function _initSwClick() {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'NOTIFICATION_CLICK') {
        var view = e.data.view;
        if (view && typeof go === 'function') go(view);
        clearUnread();
      }
    });
  }

  /* ── Render settings view ── */
  function renderSettings() {
    var el = document.getElementById('view-mobile-notifications');
    if (!el) return;

    var settings    = _load();
    var permission  = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
    var permColor   = permission === 'granted' ? 'var(--green)' : permission === 'denied' ? 'var(--red)' : 'var(--yellow)';
    var permLabel   = { granted: '許可済み', denied: '拒否済み', default: '未設定', unsupported: '非対応' }[permission] || permission;

    var evRows = EVENT_CONFIG.map(function (ec) {
      var checked = settings.events[ec.id] !== false;
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line-2)">' +
        '<span style="font-size:13px;color:var(--ink)">' + ec.label + '</span>' +
        '<input type="checkbox" ' + (checked ? 'checked' : '') +
          ' onchange="PushNotifications._toggleEvent(\'' + ec.id + '\',this.checked)" ' +
          'style="width:18px;height:18px;accent-color:var(--blue);cursor:pointer" />' +
      '</div>';
    }).join('');

    el.innerHTML =
      '<div class="panel" style="max-width:560px">' +
        '<div class="panel-head">' +
          '<span class="panel-title">プッシュ通知設定</span>' +
          '<span style="font-size:11px;color:' + permColor + ';font-weight:600">' + permLabel + '</span>' +
        '</div>' +
        '<div class="panel-body">' +
          /* Master toggle */
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding:12px 14px;background:var(--bg-soft-2);border-radius:10px">' +
            '<div>' +
              '<div style="font-size:13px;font-weight:600;color:var(--ink)">プッシュ通知</div>' +
              '<div style="font-size:11px;color:var(--gray-2);margin-top:2px">すべての通知を一括で ON / OFF</div>' +
            '</div>' +
            '<input type="checkbox" ' + (settings.enabled ? 'checked' : '') +
              ' onchange="PushNotifications._toggleMaster(this.checked)" ' +
              'style="width:20px;height:20px;accent-color:var(--blue);cursor:pointer" />' +
          '</div>' +
          /* Permission button */
          (permission !== 'granted' ? (
            '<button class="btn btn-primary" style="width:100%;margin-bottom:16px;min-height:44px" ' +
              'onclick="PushNotifications.requestPermission()">' +
              (permission === 'denied' ? '⚠️ ブラウザ設定から通知を許可してください' : '🔔 通知を許可する') +
            '</button>'
          ) : '') +
          /* Per-event toggles */
          '<div style="font-size:11px;font-weight:600;color:var(--gray-2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">通知イベント</div>' +
          evRows +
          /* Unread / clear */
          '<div style="margin-top:16px;display:flex;align-items:center;justify-content:space-between">' +
            '<span style="font-size:12px;color:var(--gray-1)">未読通知: <strong>' + _unread + '件</strong></span>' +
            '<button class="btn btn-ghost btn-sm" onclick="PushNotifications.clearUnread();PushNotifications.renderSettings()">クリア</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      /* Test button */
      '<div style="margin-top:12px">' +
        '<button class="btn btn-ghost btn-sm" onclick="PushNotifications._test()">テスト通知を送信</button>' +
      '</div>';
  }

  /* ── Settings toggles ── */
  function _toggleMaster(on) {
    var s = _load();
    s.enabled = on;
    _save(s);
  }

  function _toggleEvent(id, on) {
    var s = _load();
    s.events[id] = on;
    _save(s);
  }

  function _test() {
    if (Notification.permission !== 'granted') {
      requestPermission().then(function (r) { if (r === 'granted') show('テスト通知', 'Hello Moving Admin からのテストです 📱'); });
    } else {
      show('テスト通知', 'Hello Moving Admin からのテストです 📱');
    }
  }

  /* ── Wrap go() to render settings view and clear badge ── */
  var _origGo = window.go;
  if (typeof _origGo === 'function') {
    window.go = function (view) {
      _origGo(view);
      if (view === 'mobile-notifications') { clearUnread(); renderSettings(); }
    };
  }

  /* ── Init ── */
  function init() {
    try { _unread = parseInt(localStorage.getItem(UNREAD_KEY) || '0', 10) || 0; } catch (_) {}
    _wire();
    _initSwClick();
    _updateBottomNavBadge();
  }

  return {
    init:             init,
    show:             show,
    requestPermission: requestPermission,
    clearUnread:      clearUnread,
    renderSettings:   renderSettings,
    _toggleMaster:    _toggleMaster,
    _toggleEvent:     _toggleEvent,
    _test:            _test,
  };

})();
