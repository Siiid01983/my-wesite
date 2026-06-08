'use strict';

/* ════════════════════════════════════════════════════════
   MOBILE NAV — Phase 27A
   Sidebar drawer, bottom navigation bar, touch gestures,
   and sticky quick-action bar for mobile screens.

   Injects:
     #sidebarBackdrop  — tap-to-close overlay
     #mobileBottomNav  — 5-item fixed bottom nav
     #mobileQuickBar   — sticky horizontal chip row

   Wraps window.go() to close drawer and sync active state.
   Handles swipe-right to open / swipe-left to close drawer.
   ════════════════════════════════════════════════════════ */

window.MobileNav = (function () {

  var BREAKPOINT = 768;
  var _drawer    = null;
  var _backdrop  = null;
  var _swipeStartX = 0;
  var _swipeStartY = 0;
  var _swiping     = false;

  /* ── Bottom nav config (5 items) ── */
  var NAV_ITEMS = [
    { view: 'dashboard',  label: 'ホーム',   svg: '<path fill="currentColor" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>' },
    { view: 'bookings',   label: '予約',     svg: '<path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>' },
    { view: 'crm',        label: 'CRM',      svg: '<path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>' },
    { view: 'calendar',   label: 'カレンダー', svg: '<path fill="currentColor" d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/>' },
    { view: '_menu',      label: 'メニュー', svg: '<path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>' },
  ];

  /* ── Inject backdrop ── */
  function _injectBackdrop() {
    if (document.getElementById('sidebarBackdrop')) return;
    var bd = document.createElement('div');
    bd.id = 'sidebarBackdrop';
    bd.addEventListener('click', closeDrawer);
    document.body.appendChild(bd);
    _backdrop = bd;
  }

  /* ── Inject bottom nav ── */
  function _injectBottomNav() {
    if (document.getElementById('mobileBottomNav')) return;
    var nav = document.createElement('nav');
    nav.id = 'mobileBottomNav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'モバイルナビゲーション');

    nav.innerHTML = NAV_ITEMS.map(function (item) {
      var click = item.view === '_menu'
        ? 'MobileNav.toggleDrawer()'
        : 'MobileNav._navGo(\'' + item.view + '\')';
      return '<button class="mbn-item" data-mbn="' + item.view + '" onclick="' + click + '" ' +
        'aria-label="' + item.label + '">' +
        '<svg viewBox="0 0 24 24" width="20" height="20">' + item.svg + '</svg>' +
        '<span>' + item.label + '</span>' +
      '</button>';
    }).join('');

    document.body.appendChild(nav);
  }

  /* ── Inject quick bar ── */
  function _injectQuickBar() {
    if (document.getElementById('mobileQuickBar')) return;
    var bar = document.createElement('div');
    bar.id = 'mobileQuickBar';
    bar.setAttribute('aria-label', 'クイックアクション');
    bar.innerHTML =
      '<button class="mqb-chip primary" onclick="openAdd&&openAdd()">' +
        '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>' +
        '予約追加' +
      '</button>' +
      '<button class="mqb-chip" onclick="MobileNav._navGo(\'quotes\')">' +
        '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>' +
        '見積り' +
      '</button>' +
      '<button class="mqb-chip" onclick="MobileNav._navGo(\'customers\')">' +
        '顧客管理' +
      '</button>' +
      '<button class="mqb-chip" onclick="GlobalSearch&&GlobalSearch.open()">' +
        '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>' +
        '検索' +
      '</button>';
    /* Insert after topbar inside .main */
    var main = document.querySelector('.main');
    var topbar = document.querySelector('.topbar');
    if (main && topbar && topbar.nextSibling) {
      main.insertBefore(bar, topbar.nextSibling);
    } else if (main) {
      main.prepend(bar);
    }
  }

  /* ── Swipe gesture support ── */
  function _initSwipe() {
    document.addEventListener('touchstart', function (e) {
      _swipeStartX = e.touches[0].clientX;
      _swipeStartY = e.touches[0].clientY;
      _swiping = true;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!_swiping) return;
      var dx = e.touches[0].clientX - _swipeStartX;
      var dy = e.touches[0].clientY - _swipeStartY;
      if (Math.abs(dy) > Math.abs(dx)) { _swiping = false; return; } /* vertical scroll */

      var drawer = document.getElementById('sidebar');
      if (!drawer) return;
      var isOpen = drawer.classList.contains('open');

      /* Swipe right from left edge to open */
      if (!isOpen && _swipeStartX < 30 && dx > 40) {
        openDrawer();
        _swiping = false;
      }
      /* Swipe left to close */
      if (isOpen && dx < -40) {
        closeDrawer();
        _swiping = false;
      }
    }, { passive: true });

    document.addEventListener('touchend', function () { _swiping = false; }, { passive: true });
  }

  /* ── Wrap go() ── */
  function _wrapGo() {
    var _origGo = window.go;
    if (typeof _origGo !== 'function') return;
    window.go = function (view) {
      _origGo(view);
      closeDrawer();
      _syncBottomNav(view);
    };
  }

  /* ── Sync bottom nav active state ── */
  function _syncBottomNav(view) {
    document.querySelectorAll('.mbn-item').forEach(function (el) {
      var v = el.getAttribute('data-mbn');
      el.classList.toggle('active', v === view);
    });
  }

  /* ── Public: nav go (closes drawer first) ── */
  function _navGo(view) {
    closeDrawer();
    if (typeof go === 'function') go(view);
  }

  /* ── Public: open drawer ── */
  function openDrawer() {
    var drawer = document.getElementById('sidebar');
    var bd = document.getElementById('sidebarBackdrop');
    if (drawer) drawer.classList.add('open');
    if (bd) bd.classList.add('visible');
    /* Menu button active */
    var menuBtn = document.querySelector('.mbn-item[data-mbn="_menu"]');
    if (menuBtn) menuBtn.classList.add('active');
  }

  /* ── Public: close drawer ── */
  function closeDrawer() {
    var drawer = document.getElementById('sidebar');
    var bd = document.getElementById('sidebarBackdrop');
    if (drawer) drawer.classList.remove('open');
    if (bd) bd.classList.remove('visible');
    var menuBtn = document.querySelector('.mbn-item[data-mbn="_menu"]');
    if (menuBtn) menuBtn.classList.remove('active');
  }

  /* ── Public: toggle drawer ── */
  function toggleDrawer() {
    var drawer = document.getElementById('sidebar');
    if (drawer && drawer.classList.contains('open')) closeDrawer();
    else openDrawer();
  }

  /* ── Update bottom nav badge (e.g. pending bookings) ── */
  function setBadge(view, count) {
    var item = document.querySelector('.mbn-item[data-mbn="' + view + '"]');
    if (!item) return;
    var existing = item.querySelector('.mbn-badge');
    if (!count) { if (existing) existing.remove(); return; }
    if (!existing) {
      existing = document.createElement('span');
      existing.className = 'mbn-badge';
      item.appendChild(existing);
    }
    existing.textContent = count > 99 ? '99+' : count;
  }

  /* ── Is mobile breakpoint? ── */
  function isMobile() { return window.innerWidth <= BREAKPOINT; }

  /* ── Init ── */
  function init() {
    _drawer = document.getElementById('sidebar');
    _injectBackdrop();
    _injectBottomNav();
    _injectQuickBar();
    _initSwipe();
    _wrapGo();

    /* Set initial active state */
    var active = document.querySelector('.sb-link.active');
    if (active) _syncBottomNav(active.getAttribute('data-view'));

    /* Close drawer when sidebar link clicked (belt-and-suspenders) */
    document.querySelectorAll('.sb-link').forEach(function (el) {
      el.addEventListener('click', function () {
        if (isMobile()) setTimeout(closeDrawer, 50);
      });
    });

    /* Listen for EventBus booking:created to badge */
    if (window.EventBus) {
      EventBus.on('booking:created', function () {
        if (!window.Adapter) return;
        var pending = Adapter.getBookings().filter(function (b) { return b.status === '新規'; }).length;
        setBadge('bookings', pending);
      });
    }
  }

  return {
    init:        init,
    openDrawer:  openDrawer,
    closeDrawer: closeDrawer,
    toggleDrawer: toggleDrawer,
    setBadge:    setBadge,
    isMobile:    isMobile,
    _navGo:      _navGo,
  };

})();
