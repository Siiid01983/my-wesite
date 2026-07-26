'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   opsCalendar.js — the Ops dispatcher calendar, powered by the SHARED timeline

   Ops and Admin now run ONE calendar component: js/modules/calendar/
   timelineCalendar.js (+ timelineGestures.js). Same API (availability-windows.php),
   same availability-window engine, same drag / resize / create / delete, same
   conflict detection (hm_iv_reserve), same rendering. This shim just mounts that
   component into the Ops SPA content area and feeds it the Ops environment. It
   REPLACES the old bespoke ops/js/calendar.js (deleted).

   Auth/API are already shared: ops-core.js loads ../js/config/env.js
   (window.API_BASE / API_KEY) and sets window.__HM_ADMIN_TOKEN on login — exactly
   what the timeline component reads. Permissions differ only server-side (the
   admin token gates writes); the interaction model is identical to Admin.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  var UI = Ops.UI;
  var tr = (typeof window.t === 'function') ? window.t : function (k) { return k; };

  Ops.ready(function () {
    UI.mountChrome({ active: 'calendar', title: tr('calendar.title') });

    // Host the shared timeline in the Ops content area (its default mount id).
    var content = document.getElementById('ops-content');
    if (content) content.innerHTML = '<div id="view-calendar" class="ops-tl-host"></div>';

    // Feed the component the Ops environment: force-enable (the timeline IS the Ops
    // calendar — not gated by the admin preview flag) + route toasts to Ops.UI.
    TimelineCalendar.configure({
      force: true,
      toast: function (m) { try { UI.toast(m); } catch (_) {} }
    });
    if (!TimelineCalendar.onShow()) return;

    // Deep-link ?date=YYYY-MM-DD → open that day (parity with the old Ops calendar).
    var dl = '';
    try { dl = new URLSearchParams(location.search || '').get('date') || ''; } catch (_) {}
    if (/^\d{4}-\d{2}-\d{2}$/.test(dl)) {
      try { TimelineCalendar._debug.setAnchor(dl); TimelineCalendar._debug.setView('day'); TimelineCalendar.reload(); } catch (_) {}
    }

    // Live refresh on the Ops poll cadence.
    setInterval(function () { try { TimelineCalendar.reload(); } catch (_) {} }, (Ops.cfg && Ops.cfg.POLL_MS) || 15000);
  });
})();
