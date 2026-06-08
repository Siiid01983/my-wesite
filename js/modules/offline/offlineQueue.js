'use strict';

/* ════════════════════════════════════════════════════════
   OFFLINE QUEUE — Phase 27D
   Queues write actions while offline; drains them via
   Adapter when the connection is restored.

   Queue stored in localStorage (hm_offline_queue) so it
   survives page reloads.

   Supported actions: addBooking, updateBooking,
     deleteBooking, setDate (calendar), addNote.

   Offline mode:
     - Banner shown (#offlineBanner)
     - Queue badge updated (#offlineQueueBadge)
     - OfflineDB serves read requests from IDB cache
     - Queued writes executed on reconnect

   Auto-syncs IDB cache after every successful Supabase
   login (via EventBus 'auth:login') and after drain.
   ════════════════════════════════════════════════════════ */

window.OfflineQueue = (function () {

  var QUEUE_KEY   = 'hm_offline_queue';
  var _isOnline   = navigator.onLine;
  var _draining   = false;

  /* ── Load / save queue ── */
  function _loadQ() {
    try {
      var d = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(d) ? d : [];
    } catch (_) { return []; }
  }

  function _saveQ(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (_) {}
  }

  function queueSize() { return _loadQ().length; }

  /* ── Enqueue a write action ── */
  function enqueue(action, payload) {
    var q = _loadQ();
    q.push({ id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
             action: action, payload: payload, ts: new Date().toISOString() });
    _saveQ(q);
    _updateBadge();
    if (window.toast) toast('[オフライン] 操作をキューに追加しました（' + q.length + '件）');
  }

  /* ── Drain queue when online ── */
  async function drain() {
    if (_draining || !_isOnline || !window.Adapter) return;
    var q = _loadQ();
    if (!q.length) return;
    _draining = true;

    var remaining = [];
    for (var i = 0; i < q.length; i++) {
      var item = q[i];
      try {
        await _execute(item);
        if (window.AuditLog) {
          AuditLog.record('other', 'offline_queue', item.action, 'オフライン操作を同期: ' + item.action);
        }
      } catch (e) {
        console.warn('[OfflineQueue] drain error for', item.action, e);
        remaining.push(item);
      }
    }

    _saveQ(remaining);
    _draining = false;
    _updateBadge();

    var synced = q.length - remaining.length;
    if (synced > 0) {
      if (window.toast) toast('オンライン復帰 — ' + synced + '件の操作を同期しました ✓');
      if (window.EventBus) EventBus.emit('offline:synced', { count: synced });
    }

    /* Refresh current view after sync */
    var active = document.querySelector('.view.active');
    var view = active ? active.id.replace('view-', '') : null;
    if (view && typeof renderDash === 'function' && view === 'dashboard') renderDash();
    if (view === 'bookings' && typeof renderBookings === 'function') renderBookings();
  }

  /* ── Execute a queued action ── */
  async function _execute(item) {
    var p = item.payload || {};
    switch (item.action) {
      case 'addBooking':    await Adapter.addBooking(p); break;
      case 'updateBooking': await Adapter.updateBooking(p.id, p.patch); break;
      case 'deleteBooking': await Adapter.deleteBooking(p.id); break;
      case 'setDate':       await Adapter.setDate(p.date, p.status); break;
      case 'addNote':
        if (window.CRMNotes) CRMNotes.add(p.customerId, p.text);
        break;
      default:
        console.warn('[OfflineQueue] unknown action:', item.action);
    }
  }

  /* ── Banner ── */
  function _showBanner() {
    var el = document.getElementById('offlineBanner');
    if (el) el.classList.add('show');
  }

  function _hideBanner() {
    var el = document.getElementById('offlineBanner');
    if (el) el.classList.remove('show');
  }

  /* ── Badge ── */
  function _updateBadge() {
    var n = queueSize();
    var badge = document.getElementById('offlineQueueBadge');
    if (badge) {
      badge.textContent = n > 0 ? n + '件待機中' : '';
      badge.classList.toggle('show', n > 0);
    }
    if (window.MobileNav) MobileNav.setBadge('bookings', n > 0 ? n : 0);
  }

  /* ── Online / offline detection ── */
  function _onOnline() {
    _isOnline = true;
    _hideBanner();
    /* Sync IDB and drain queue */
    if (window.OfflineDB) OfflineDB.syncFromAdapter().catch(function () {});
    drain();
  }

  function _onOffline() {
    _isOnline = false;
    _showBanner();
    /* Snapshot current data into IDB */
    if (window.OfflineDB) OfflineDB.syncFromAdapter().catch(function () {});
  }

  /* ── Serve cached bookings when offline ── */
  function getBookingsOffline() {
    if (_isOnline || !window.OfflineDB) return null;
    return OfflineDB.getAll('bookings');
  }

  function getCalendarOffline() {
    if (_isOnline || !window.OfflineDB) return null;
    return OfflineDB.getAll('calendar').then(function (rows) {
      var avail = {};
      rows.forEach(function (r) { avail[r.date] = r.status; });
      return avail;
    });
  }

  /* ── Status indicator in page ── */
  function isOnline() { return _isOnline; }

  /* ── Init ── */
  function init() {
    window.addEventListener('online',  _onOnline);
    window.addEventListener('offline', _onOffline);

    /* Set initial state */
    if (!_isOnline) _showBanner();

    /* Update badge from persisted queue */
    _updateBadge();

    /* Sync to IDB on login */
    if (window.EventBus) {
      EventBus.on('auth:login', function () {
        if (window.OfflineDB) OfflineDB.syncFromAdapter().catch(function () {});
      });
    }

    /* Periodic drain attempt every 60s while online */
    setInterval(function () {
      if (_isOnline && !_draining && queueSize() > 0) drain();
    }, 60000);
  }

  return {
    init:                init,
    enqueue:             enqueue,
    drain:               drain,
    queueSize:           queueSize,
    isOnline:            isOnline,
    getBookingsOffline:  getBookingsOffline,
    getCalendarOffline:  getCalendarOffline,
  };

})();
