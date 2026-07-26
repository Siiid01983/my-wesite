'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   timelineCalendar.js — admin hourly TIMELINE (Google-Calendar-style)

   The allow-list availability manager: the admin draws AVAILABLE working periods
   on an hourly timeline. Day / Week / Month views; press-&-hold to create, drag
   to move, resize from top/bottom, delete; snap to 15/30/60 min; auto-scroll
   while dragging; pointer-events → mouse + touch (mobile-friendly).

   Single source of truth = availability_windows via hm-api/availability-windows.php
   (the SAME table the booking engine reads once timeline_enabled is ON). This
   module manages availability_windows ONLY — never the legacy band/capacity engine.

   ── Gating ──────────────────────────────────────────────────────────────────
   CLIENT preview flag localStorage 'hm_timeline_ui' (default OFF) shows this UI
   in place of the band/slot calendar for staging QA. It is INDEPENDENT of the
   SERVER 'timeline_enabled' flag (which gates the booking engine): the admin can
   lay out + preview windows before the engine goes live. Production is untouched
   while both are off.

   Globals used: API_BASE, API_KEY, __HM_ADMIN_TOKEN, (opt) toast, todayStr,
   TimelineGestures.
   ════════════════════════════════════════════════════════════════════════════ */

window.TimelineCalendar = (function () {

  var DOW  = ['日', '月', '火', '水', '木', '金', '土'];
  var MN   = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  var _chipDragTs = 0;   // timestamp of the last month-chip drag (suppress post-drop click)

  // Host config so ONE component serves both Admin (admin.html #view-calendar) and
  // Ops (ops/calendar.html) — same engine, API, windows, drag/resize, conflict
  // detection, rendering. Only the mount target / env hooks differ; permissions are
  // enforced server-side (both send the admin token). Defaults = admin.
  var host = {
    mountId: 'view-calendar',   // container the timeline mounts into
    force: false,               // Ops sets true (the timeline IS the Ops calendar)
    toast: null,                // optional toast(msg) override (Ops.UI)
    today: null                 // optional today()→'YYYY-MM-DD' override
  };
  function configure(o) { if (o) { Object.keys(o).forEach(function (k) { if (o[k] != null) host[k] = o[k]; }); } return host; }

  var state = {
    view: 'week',           // 'day' | 'week' | 'month'
    anchor: null,           // Date (any day within the shown range)
    snap: 30,               // minutes: 15 | 30 | 60
    windows: {},            // date → [{id,start_at,end_at}]
    bookings: {},           // date → [{id,customer_name,status,start_at,end_at}]
    closed: {},             // date → {day,reason,closed_by,closed_at} (whole-day closure)
    cfg: { day_start: '07:00', day_end: '22:00', step: 30, durations: [30,60,90,120,180], default_duration: 120 },
    pxPerMin: 0.8,          // vertical scale (48px / hour)
    built: false
  };

  /* ── env helpers (mirror slotCalendar.js) ── */
  function _base()   { return (window.API_BASE || '').replace(/\/+$/, ''); }
  function _toast(m) { if (typeof host.toast === 'function') host.toast(m); else if (typeof window.toast === 'function') window.toast(m); else console.log('[Timeline]', m); }
  function _headers(json) {
    var h = json ? { 'Content-Type': 'application/json' } : {};
    h['X-API-KEY'] = window.API_KEY || '';
    if (window.__HM_ADMIN_TOKEN) h['X-ADMIN-TOKEN'] = window.__HM_ADMIN_TOKEN;
    return h;
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  // Band removal: the timeline is now the ADMIN calendar by default. Escape hatch —
  // set hm_timeline_ui='0' to fall back to the legacy ○△× grid (calendar.js).
  function _enabled() { if (host.force) return true; try { return localStorage.getItem('hm_timeline_ui') !== '0'; } catch (_) { return true; } }

  /* ── pure date/time helpers (exposed for unit tests) ── */
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate()+n); return x; }
  function today() {
    if (typeof host.today === 'function') { var h = host.today(); if (/^\d{4}-\d{2}-\d{2}$/.test(h)) return h; }
    if (typeof window.todayStr === 'function') { var t = window.todayStr(); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; }
    return ymd(new Date());
  }
  function hmToMin(hm) { var p = String(hm).split(':'); return (+p[0])*60 + (+p[1] || 0); }
  function minToHm(m) { m = Math.max(0, Math.min(1440, Math.round(m))); return pad(Math.floor(m/60)) + ':' + pad(m%60); }
  function dtMin(dt) { var m = String(dt).match(/(\d{2}):(\d{2})/); return m ? (+m[1])*60 + (+m[2]) : 0; }

  function dayStartMin() { return hmToMin(state.cfg.day_start || '07:00'); }
  function dayEndMin()   { return hmToMin(state.cfg.day_end   || '22:00'); }
  function minToY(min)   { return (min - dayStartMin()) * state.pxPerMin; }
  function yToMin(y)     { return dayStartMin() + y / state.pxPerMin; }
  function snapMin(m)    { return Math.round(m / state.snap) * state.snap; }

  function weekDates(dateStr) {
    var d = parse(dateStr), start = addDays(d, -d.getDay()), out = [];
    for (var i = 0; i < 7; i++) out.push(ymd(addDays(start, i)));
    return out;
  }
  function monthGrid(dateStr) {
    var d = parse(dateStr), first = new Date(d.getFullYear(), d.getMonth(), 1);
    var start = addDays(first, -first.getDay()), out = [];
    for (var i = 0; i < 42; i++) out.push(ymd(addDays(start, i)));
    return out;
  }
  function rangeOf() {
    if (state.view === 'day')  return { from: ymd(state.anchor), to: ymd(state.anchor) };
    if (state.view === 'week') { var w = weekDates(ymd(state.anchor)); return { from: w[0], to: w[6] }; }
    var g = monthGrid(ymd(state.anchor)); return { from: g[0], to: g[41] };
  }

  /* ── styles (clean, modern; not the legacy admin look) ── */
  function _injectStyles() {
    if (document.getElementById('hmTlStyle')) return;
    var s = document.createElement('style'); s.id = 'hmTlStyle';
    s.textContent = [
      '#hmTl{--tl-line:#e8eaed;--tl-ink:#3c4043;--tl-accent:#1a73e8;--tl-win:#0b8043;--tl-win-bg:rgba(11,128,67,.14);--tl-bg:#fff;font-family:"DM Sans",system-ui,-apple-system,sans-serif;color:var(--tl-ink)}',
      '.hm-dark #hmTl,#hmTl.dark{--tl-line:#3c4043;--tl-ink:#e8eaed;--tl-bg:#202124;--tl-win-bg:rgba(11,128,67,.28)}',
      '#hmTl *{box-sizing:border-box}',
      '.tl-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}',
      '.tl-title{font-size:18px;font-weight:700;min-width:150px;letter-spacing:.01em}',
      '.tl-nav{width:34px;height:34px;border:1px solid var(--tl-line);border-radius:9px;background:var(--tl-bg);cursor:pointer;font-size:16px;color:inherit;display:inline-flex;align-items:center;justify-content:center;transition:background .12s}',
      '.tl-nav:hover{background:rgba(26,115,232,.08)}',
      '.tl-seg{display:inline-flex;border:1px solid var(--tl-line);border-radius:9px;overflow:hidden}',
      '.tl-seg button{border:0;background:var(--tl-bg);color:inherit;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;transition:background .12s}',
      '.tl-seg button.on{background:var(--tl-accent);color:#fff}',
      '.tl-spacer{margin-left:auto}',
      '.tl-snap{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:inherit;opacity:.85}',
      '.tl-snap select{border:1px solid var(--tl-line);border-radius:8px;padding:6px 8px;background:var(--tl-bg);color:inherit;font-size:12px}',
      '.tl-scroll{position:relative;overflow:auto;max-height:min(72vh,720px);border:1px solid var(--tl-line);border-radius:14px;background:var(--tl-bg);-webkit-overflow-scrolling:touch}',
      '.tl-grid{position:relative;display:grid}',                  // grid-template-columns set inline
      '.tl-axis{position:relative}',
      '.tl-axis .tl-hr{position:absolute;left:0;right:0;font-size:11px;color:inherit;opacity:.55;padding-right:6px;text-align:right;transform:translateY(-6px)}',
      '.tl-col{position:relative;border-left:1px solid var(--tl-line);touch-action:none;user-select:none}',
      '.tl-col.tl-today{background:rgba(26,115,232,.04)}',
      '.tl-colhead{position:sticky;top:0;z-index:3;background:var(--tl-bg);border-bottom:1px solid var(--tl-line);text-align:center;padding:8px 2px;font-size:12px;font-weight:600}',
      '.tl-colhead .d{font-size:17px;font-weight:800}',
      '.tl-colhead .dow-sun{color:#d93025}.tl-colhead .dow-sat{color:#1a73e8}',
      '.tl-hrline{position:absolute;left:0;right:0;border-top:1px solid var(--tl-line);pointer-events:none}',
      '.tl-hrline.half{border-top-style:dotted;opacity:.5}',
      '.tl-win{position:absolute;left:5px;right:5px;background:var(--tl-win-bg);border:1px solid var(--tl-win);border-left:3px solid var(--tl-win);border-radius:7px;padding:3px 6px;font-size:11px;color:var(--tl-win);font-weight:700;overflow:hidden;cursor:grab;transition:box-shadow .12s,transform .06s;touch-action:none}',
      '.tl-win:hover{box-shadow:0 2px 8px rgba(0,0,0,.14)}',
      '.tl-win.dragging{cursor:grabbing;box-shadow:0 6px 18px rgba(0,0,0,.22);z-index:5;opacity:.96}',
      '.tl-win .tl-h{position:absolute;left:0;right:0;height:9px;cursor:ns-resize}',
      '.tl-win .tl-h.top{top:-1px}.tl-win .tl-h.bot{bottom:-1px}',
      '.tl-win .tl-del{position:absolute;top:2px;right:3px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.28);color:#fff;border:0;font-size:11px;line-height:16px;cursor:pointer;padding:0;opacity:0;transition:opacity .12s}',
      '.tl-win:hover .tl-del,.tl-win.sel .tl-del{opacity:1}',
      '.tl-win .tl-t{pointer-events:none}',
      '.tl-ghost{position:absolute;left:5px;right:5px;background:rgba(26,115,232,.18);border:1px dashed var(--tl-accent);border-radius:7px;pointer-events:none;z-index:6;font-size:11px;color:var(--tl-accent);font-weight:700;padding:2px 6px}',
      // Booking blocks (draggable to reschedule) — distinct blue, inset right so
      // the green availability window stays visible behind them.
      '.tl-bk{position:absolute;left:34%;right:5px;background:var(--tl-accent);border:1px solid #1557b0;border-radius:7px;padding:3px 6px;font-size:11px;color:#fff;font-weight:700;overflow:hidden;cursor:grab;z-index:3;box-shadow:0 1px 4px rgba(0,0,0,.18);transition:box-shadow .12s;touch-action:none}',
      '.tl-bk.dragging{cursor:grabbing;box-shadow:0 8px 20px rgba(0,0,0,.3);opacity:.95;z-index:7}',
      '.tl-bk .tl-h{position:absolute;left:0;right:0;height:9px;cursor:ns-resize}.tl-bk .tl-h.bot{bottom:-1px}',
      '.tl-bk .nm{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;pointer-events:none}',
      '.tl-bk.pending{background:#f9ab00;border-color:#e37400}',
      '.tl-now{position:absolute;left:0;right:0;height:0;border-top:2px solid #ea4335;z-index:4;pointer-events:none}',
      '.tl-now::before{content:"";position:absolute;left:-4px;top:-4px;width:8px;height:8px;border-radius:50%;background:#ea4335}',
      // Month view
      '.tl-month{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}',
      '.tl-mdow{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px}',
      '.tl-mdow>div{text-align:center;font-size:11px;font-weight:700;opacity:.6}',
      '.tl-mcell{border:1px solid var(--tl-line);border-radius:10px;min-height:88px;padding:6px;cursor:pointer;background:var(--tl-bg);display:flex;flex-direction:column;gap:4px;transition:border-color .12s,box-shadow .12s}',
      '.tl-mcell:hover{border-color:var(--tl-accent);box-shadow:0 2px 8px rgba(0,0,0,.08)}',
      '.tl-mcell.dim{opacity:.4}.tl-mcell.tl-today{border-color:var(--tl-accent)}',
      '.tl-mcell .n{font-size:13px;font-weight:700}',
      '.tl-mcell .bar{height:5px;border-radius:3px;background:var(--tl-win)}',
      '.tl-mcell .sum{font-size:10px;color:var(--tl-win);font-weight:700}',
      '.tl-mcell.droptarget{border-color:var(--tl-accent);box-shadow:0 0 0 2px var(--tl-accent) inset;background:rgba(26,115,232,.08)}',
      '.tl-mchip{display:block;font-size:10px;font-weight:700;color:#fff;background:var(--tl-accent);border-radius:5px;padding:2px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:grab;touch-action:none;transition:box-shadow .1s}',
      '.tl-mchip.pending{background:#f9ab00}',
      '.tl-mchip.dragging{cursor:grabbing;box-shadow:0 6px 16px rgba(0,0,0,.3);opacity:.95}',
      '.tl-empty{padding:26px;text-align:center;font-size:13px;opacity:.6}',
      '.tl-hint{font-size:12px;opacity:.6;margin:8px 2px 0}',
      // Whole-day close: header toggle, column overlay, month-cell tag
      '.tl-closebtn{margin-left:5px;border:0;background:transparent;cursor:pointer;font-size:12px;line-height:1;padding:1px 3px;border-radius:6px;opacity:.55;transition:opacity .12s,background .12s}',
      '.tl-closebtn:hover{opacity:1;background:rgba(217,48,37,.12)}',
      '.tl-col-closed .tl-canvas{background:repeating-linear-gradient(45deg,rgba(217,48,37,.06),rgba(217,48,37,.06) 8px,transparent 8px,transparent 16px)}',
      '.tl-closed{position:absolute;left:5px;right:5px;top:6px;z-index:8;background:rgba(217,48,37,.95);color:#fff;border-radius:8px;padding:6px 8px;box-shadow:0 2px 8px rgba(0,0,0,.18);pointer-events:none}',
      '.tl-closed-tag{display:inline-block;font-size:10px;font-weight:800;background:rgba(255,255,255,.25);border-radius:4px;padding:1px 5px;margin-right:4px}',
      '.tl-closed-rsn{font-size:12px;font-weight:700}',
      '.tl-closed-by{display:block;font-size:10px;opacity:.85;margin-top:2px}',
      '.tl-mcell.tl-mcell-closed{border-color:#d93025;background:rgba(217,48,37,.06)}',
      '.tl-mcell .closed-tag{font-size:9px;font-weight:800;color:#fff;background:#d93025;border-radius:4px;padding:1px 4px;align-self:flex-start}',
      // Close-day reason dialog
      '.tl-dlg-ov{position:fixed;inset:0;background:rgba(15,23,20,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px}',
      '.tl-dlg{background:var(--tl-bg);color:var(--tl-ink);border-radius:16px;padding:20px;width:min(420px,100%);box-shadow:0 20px 60px rgba(0,0,0,.35)}',
      '.tl-dlg-h{font-size:16px;font-weight:800;margin-bottom:4px}',
      '.tl-dlg-sub{font-size:12px;opacity:.7;margin-bottom:12px}',
      '.tl-dlg-reasons{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}',
      '.tl-rsn{border:1px solid var(--tl-line);background:var(--tl-bg);color:inherit;border-radius:20px;padding:8px 13px;font-size:13px;font-weight:600;cursor:pointer;transition:all .12s}',
      '.tl-rsn:hover{border-color:var(--tl-accent)}.tl-rsn.on{background:#d93025;border-color:#d93025;color:#fff}',
      '.tl-dlg-input{width:100%;border:1px solid var(--tl-line);border-radius:10px;padding:10px 12px;font-size:14px;background:var(--tl-bg);color:inherit;margin-bottom:14px}',
      '.tl-dlg-actions{display:flex;justify-content:flex-end;gap:8px}',
      '.tl-dlg-cancel,.tl-dlg-ok{border-radius:10px;padding:9px 16px;font-size:14px;font-weight:700;cursor:pointer;border:1px solid var(--tl-line);background:var(--tl-bg);color:inherit}',
      '.tl-dlg-ok{background:#d93025;border-color:#d93025;color:#fff}.tl-dlg-ok:disabled{opacity:.45;cursor:not-allowed}',
      '@media(max-width:640px){.tl-title{font-size:15px;min-width:0}.tl-seg button{padding:6px 9px}.tl-colhead .d{font-size:14px}}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ── mount into #view-calendar (idempotent) ── */
  function mount() {
    if (!_enabled()) return false;
    var view = document.getElementById(host.mountId);
    if (!view) return false;
    if (document.getElementById('hmTl')) return true;
    _injectStyles();

    // Hide the legacy band/slot screens while the timeline preview is on.
    ['#slotAvailScreen', '.cal-wrap'].forEach(function (sel) {
      var el = view.querySelector(sel); if (el) el.style.display = 'none';
    });

    try { state.snap = parseInt(localStorage.getItem('hm_timeline_snap') || '30', 10) || 30; } catch (_) {}
    try { var z = parseFloat(localStorage.getItem('hm_timeline_zoom')); if (z >= 0.4 && z <= 2.4) state.pxPerMin = z; } catch (_) {}

    var root = document.createElement('div');
    root.id = 'hmTl';
    root.innerHTML =
      '<div class="tl-bar">' +
        '<button class="tl-nav" id="tlPrev" type="button" aria-label="前">&#8249;</button>' +
        '<button class="tl-nav" id="tlNext" type="button" aria-label="次">&#8250;</button>' +
        '<button class="tl-nav" id="tlToday" type="button" title="今日" style="width:auto;padding:0 12px;font-size:13px;font-weight:600">今日</button>' +
        '<span class="tl-title" id="tlTitle"></span>' +
        '<span class="tl-spacer"></span>' +
        '<span class="tl-snap">スナップ<select id="tlSnap">' +
          '<option value="15">15分</option><option value="30">30分</option><option value="60">60分</option>' +
        '</select></span>' +
        '<span class="tl-seg" id="tlZoom" title="拡大 / 縮小（モバイルはピンチ操作）">' +
          '<button data-z="out" type="button" aria-label="縮小">－</button>' +
          '<button data-z="in" type="button" aria-label="拡大">＋</button>' +
        '</span>' +
        '<span class="tl-seg" id="tlSeg">' +
          '<button data-v="day" type="button">日</button>' +
          '<button data-v="week" type="button">週</button>' +
          '<button data-v="month" type="button">月</button>' +
        '</span>' +
      '</div>' +
      '<div id="tlBody"></div>' +
      '<div class="tl-hint" id="tlHint"></div>';
    view.insertBefore(root, view.firstChild);

    root.querySelector('#tlPrev').onclick  = function () { _shift(-1); };
    root.querySelector('#tlNext').onclick  = function () { _shift(1); };
    root.querySelector('#tlToday').onclick = function () { state.anchor = parse(today()); render(); };
    root.querySelector('#tlSnap').value    = String(state.snap);
    root.querySelector('#tlSnap').onchange = function (e) {
      state.snap = parseInt(e.target.value, 10) || 30;
      try { localStorage.setItem('hm_timeline_snap', String(state.snap)); } catch (_) {}
    };
    root.querySelector('#tlSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]'); if (!b) return;
      state.view = b.getAttribute('data-v'); render();
    });
    root.querySelector('#tlZoom').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-z]'); if (!b) return;
      _setZoom(b.getAttribute('data-z') === 'in' ? 1.25 : 0.8);
    });

    state.built = true;
    return true;
  }

  // Zoom = change vertical scale (px/min). Keeps the scroll centred roughly.
  function _setZoom(factor) {
    var prev = state.pxPerMin;
    var next = Math.max(0.4, Math.min(2.4, prev * factor));
    if (Math.abs(next - prev) < 0.001) return;
    var scroll = document.getElementById('tlScroll');
    var anchorMin = scroll ? yToMin((scroll.scrollTop + scroll.clientHeight / 2)) : null;
    state.pxPerMin = next;
    try { localStorage.setItem('hm_timeline_zoom', String(next)); } catch (_) {}
    render();
    if (anchorMin != null) { var s2 = document.getElementById('tlScroll'); if (s2) s2.scrollTop = Math.max(0, minToY(anchorMin) - s2.clientHeight / 2); }
  }

  // Two-finger pinch on the timeline surface → live zoom (mobile). Best-effort:
  // tracks pointers on the scroll container; while two are down, scales px/min by
  // the distance ratio and suppresses single-pointer create/drag.
  function _bindPinch(scroll) {
    var pts = {}, base = 0, baseScale = 0;
    function dist() { var k = Object.keys(pts); if (k.length < 2) return 0; var a = pts[k[0]], b = pts[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
    scroll.addEventListener('pointerdown', function (e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pts).length === 2) { base = dist(); baseScale = state.pxPerMin; scroll.dataset.pinch = '1'; }
    });
    scroll.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (scroll.dataset.pinch === '1' && base > 0) {
        e.preventDefault();
        var ratio = dist() / base;
        var next = Math.max(0.4, Math.min(2.4, baseScale * ratio));
        if (Math.abs(next - state.pxPerMin) > 0.03) { state.pxPerMin = next; try { localStorage.setItem('hm_timeline_zoom', String(next)); } catch (_) {} render(); }
      }
    });
    function endPt(e) { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) scroll.dataset.pinch = ''; }
    scroll.addEventListener('pointerup', endPt);
    scroll.addEventListener('pointercancel', endPt);
  }

  // Is a two-finger pinch currently in progress? Create/drag bail out if so.
  function _pinching() { var s = document.getElementById('tlScroll'); return !!(s && s.dataset.pinch === '1'); }

  function _shift(dir) {
    if (state.view === 'day')  state.anchor = addDays(state.anchor, dir);
    else if (state.view === 'week') state.anchor = addDays(state.anchor, dir * 7);
    else state.anchor.setMonth(state.anchor.getMonth() + dir);
    render();
  }

  /* ── load windows for the visible range, then render ── */
  function load() {
    var r = rangeOf();
    fetch(_base() + '/availability-windows.php?action=range&from=' + r.from + '&to=' + r.to, { headers: _headers() })
      .then(function (res) { return res.json(); })
      .then(function (out) {
        state.windows = {}; state.bookings = {}; state.closed = {};
        if (out && out.ok && Array.isArray(out.windows)) {
          out.windows.forEach(function (w) {
            var d = (w.window_date || String(w.start_at).slice(0, 10));
            (state.windows[d] = state.windows[d] || []).push(w);
          });
        }
        if (out && out.ok && Array.isArray(out.bookings)) {
          out.bookings.forEach(function (b) {
            var d = String(b.start_at).slice(0, 10);
            (state.bookings[d] = state.bookings[d] || []).push(b);
          });
        }
        if (out && out.ok && Array.isArray(out.closed)) {
          out.closed.forEach(function (c) { if (c && c.day) state.closed[c.day] = c; });
        }
        render();
      })
      .catch(function () { state.windows = {}; state.closed = {}; render(); });
  }

  function _loadConfig(then) {
    fetch(_base() + '/availability-windows.php?action=get&date=' + today(), { headers: _headers() })
      .then(function (r) { return r.json(); })
      .then(function (o) { if (o && o.ok && o.config) state.cfg = Object.assign(state.cfg, o.config); })
      .catch(function () {})
      .then(function () { if (then) then(); });
  }

  /* ── render dispatch ── */
  function render() {
    if (!document.getElementById('hmTl')) return;
    _renderTitle();
    document.getElementById('tlSeg').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-v') === state.view);
    });
    var hint = document.getElementById('tlHint');
    if (state.view === 'month') hint.textContent = '日付をクリックして日ビューへ。空き時間帯を作成できます。';
    else hint.textContent = '長押しで空き時間帯を作成 · ドラッグで移動 · 上下でサイズ変更 · ✕で削除';
    if (state.view === 'month') _renderMonth();
    else _renderTime();
  }

  function _renderTitle() {
    var a = state.anchor, t = '';
    if (state.view === 'day')  t = a.getFullYear() + '年' + MN[a.getMonth()] + a.getDate() + '日（' + DOW[a.getDay()] + '）';
    else if (state.view === 'week') { var w = weekDates(ymd(a)); var s = parse(w[0]), e = parse(w[6]); t = (s.getMonth()+1)+'/'+s.getDate()+' – '+(e.getMonth()+1)+'/'+e.getDate(); }
    else t = a.getFullYear() + '年' + MN[a.getMonth()];
    document.getElementById('tlTitle').textContent = t;
  }

  /* ── DAY / WEEK time-grid ── */
  function _renderTime() {
    var dates = state.view === 'day' ? [ymd(state.anchor)] : weekDates(ymd(state.anchor));
    var s = dayStartMin(), e = dayEndMin(), totalMin = e - s, h = totalMin * state.pxPerMin;
    var body = document.getElementById('tlBody');

    var axis = '<div class="tl-axis" style="height:' + h + 'px">';
    for (var m = s; m <= e; m += 60) axis += '<div class="tl-hr" style="top:' + minToY(m) + 'px">' + minToHm(m) + '</div>';
    axis += '</div>';

    var cols = dates.map(function (ds) {
      var isT = ds === today();
      var lines = '';
      for (var mm = s; mm <= e; mm += 30) lines += '<div class="tl-hrline' + (mm % 60 ? ' half' : '') + '" style="top:' + minToY(mm) + 'px"></div>';
      var wins = (state.windows[ds] || []).map(function (w) { return _winHtml(w); }).join('');
      var bks = (state.bookings[ds] || []).map(function (b) { return _bkHtml(b); }).join('');
      var now = isT ? _nowLine() : '';
      var dd = parse(ds), dowCls = dd.getDay() === 0 ? 'dow-sun' : dd.getDay() === 6 ? 'dow-sat' : '';
      var cls = state.closed[ds];
      var head = '<div class="tl-colhead"><span class="' + dowCls + '">' + DOW[dd.getDay()] + '</span> <span class="d">' + dd.getDate() + '</span>' +
        '<button class="tl-closebtn" type="button" data-close-date="' + ds + '" data-closed="' + (cls ? '1' : '') + '" title="' + (cls ? '休業を解除' : 'この日を休業にする') + '">' + (cls ? '↺' : '🚫') + '</button></div>';
      var closedOv = cls ? '<div class="tl-closed"><span class="tl-closed-tag">休業</span>' +
        '<span class="tl-closed-rsn">' + _esc(cls.reason || '') + '</span>' +
        (cls.closed_by ? '<span class="tl-closed-by">' + _esc(cls.closed_by) + '</span>' : '') + '</div>' : '';
      return '<div class="tl-col' + (isT ? ' tl-today' : '') + (cls ? ' tl-col-closed' : '') + '" data-date="' + ds + '" style="height:' + (h + 40) + 'px">' +
               head + '<div class="tl-canvas" data-date="' + ds + '" style="position:absolute;left:0;right:0;top:40px;height:' + h + 'px">' +
               lines + wins + bks + now + closedOv + '</div></div>';
    }).join('');

    var colW = state.view === 'day' ? '1fr' : 'repeat(7,1fr)';
    body.innerHTML = '<div class="tl-scroll" id="tlScroll"><div class="tl-grid" style="grid-template-columns:56px ' + colW + '">' +
                     '<div style="position:relative;padding-top:40px">' + axis + '</div>' + cols + '</div></div>';

    // Scroll to ~1h before the first window (or day start).
    var scroll = document.getElementById('tlScroll');
    var firstMin = _firstWindowMin(dates); if (firstMin != null) scroll.scrollTop = Math.max(0, minToY(firstMin - 60) - 8);

    _bindPinch(scroll);
    _bindTimeInteractions(scroll);
    _bindCloseButtons(body);
  }

  /* ── whole-day close / reopen (reason required) ── */
  function _bindCloseButtons(root) {
    if (!root) return;
    root.querySelectorAll('[data-close-date]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation(); e.preventDefault();
        var ds = btn.getAttribute('data-close-date');
        if (btn.getAttribute('data-closed')) _reopenDay(ds); else _openCloseDialog(ds);
      });
    });
  }

  function _closePost(payload) {
    return fetch(_base() + '/close-day.php', { method: 'POST', headers: _headers(true), body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }, function () { return { ok: false, j: null }; }); })
      .then(function (res) {
        if (res.ok && res.j && res.j.ok) return true;
        _toast((res.j && res.j.error) || '休業設定を保存できませんでした');
        return false;
      })
      .catch(function () { _toast('通信エラー：休業設定を保存できませんでした'); return false; });
  }

  function _reopenDay(ds) {
    _closePost({ action: 'reopen', date: ds }).then(function (ok) {
      if (ok) { _toast(ds + ' の休業を解除しました'); load(); }
    });
  }

  // Preset reasons (never shown to customers — internal only).
  var CLOSE_REASONS = ['祝日・休日', 'スタッフ休暇', 'トラック整備', '手動予約', '緊急停止'];

  function _openCloseDialog(ds) {
    var prev = document.getElementById('tlCloseDlg'); if (prev) prev.remove();
    var ov = document.createElement('div'); ov.id = 'tlCloseDlg'; ov.className = 'tl-dlg-ov';
    ov.innerHTML =
      '<div class="tl-dlg" role="dialog" aria-modal="true">' +
        '<div class="tl-dlg-h">' + _esc(ds) + ' を休業にする</div>' +
        '<div class="tl-dlg-sub">理由を選択（お客様には表示されません）</div>' +
        '<div class="tl-dlg-reasons">' +
          CLOSE_REASONS.map(function (r) { return '<button type="button" class="tl-rsn" data-r="' + _esc(r) + '">' + _esc(r) + '</button>'; }).join('') +
        '</div>' +
        '<input type="text" id="tlCloseCustom" class="tl-dlg-input" placeholder="またはカスタム理由を入力" maxlength="120">' +
        '<div class="tl-dlg-actions">' +
          '<button type="button" class="tl-dlg-cancel">キャンセル</button>' +
          '<button type="button" class="tl-dlg-ok" disabled>休業にする</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var custom = ov.querySelector('#tlCloseCustom');
    var okBtn  = ov.querySelector('.tl-dlg-ok');
    var chosen = '';
    function sync() { var v = (chosen || custom.value).trim(); okBtn.disabled = !v; }
    ov.querySelectorAll('.tl-rsn').forEach(function (b) {
      b.addEventListener('click', function () {
        ov.querySelectorAll('.tl-rsn').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); chosen = b.getAttribute('data-r'); custom.value = ''; sync();
      });
    });
    custom.addEventListener('input', function () {
      if (custom.value) { ov.querySelectorAll('.tl-rsn').forEach(function (x) { x.classList.remove('on'); }); chosen = ''; }
      sync();
    });
    function close() { ov.remove(); }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.tl-dlg-cancel').addEventListener('click', close);
    okBtn.addEventListener('click', function () {
      var reason = (chosen || custom.value).trim();
      if (!reason) return;
      okBtn.disabled = true; okBtn.textContent = '保存中…';
      _closePost({ action: 'close', date: ds, reason: reason }).then(function (ok) {
        close(); if (ok) { _toast(ds + ' を休業にしました'); load(); }
      });
    });
    setTimeout(function () { custom.focus(); }, 30);
  }

  function _winHtml(w) {
    var a = dtMin(w.start_at), b = dtMin(w.end_at);
    var top = minToY(a), ht = Math.max(16, (b - a) * state.pxPerMin);
    return '<div class="tl-win" data-id="' + _esc(w.id) + '" data-s="' + a + '" data-e="' + b + '" ' +
           'style="top:' + top + 'px;height:' + ht + 'px">' +
             '<button class="tl-del" type="button" title="削除">&times;</button>' +
             '<span class="tl-h top"></span>' +
             '<span class="tl-t">' + minToHm(a) + '–' + minToHm(b) + '</span>' +
             '<span class="tl-h bot"></span>' +
           '</div>';
  }
  function _bkHtml(b) {
    var a = dtMin(b.start_at), z = dtMin(b.end_at);
    var top = minToY(a), ht = Math.max(16, (z - a) * state.pxPerMin);
    var pend = (b.status && b.status !== 'confirmed' && b.status !== 'completed') ? ' pending' : '';
    return '<div class="tl-bk' + pend + '" data-id="' + _esc(b.id) + '" data-s="' + a + '" data-e="' + z + '" data-date="' + String(b.start_at).slice(0,10) + '" ' +
           'style="top:' + top + 'px;height:' + ht + 'px" title="' + _esc(b.customer_name || '') + ' ' + minToHm(a) + '–' + minToHm(z) + '">' +
             '<span class="nm">' + _esc(b.customer_name || '予約') + '</span>' +
             '<span class="tl-t" style="font-size:10px;opacity:.9">' + minToHm(a) + '–' + minToHm(z) + '</span>' +
             '<span class="tl-h bot"></span>' +
           '</div>';
  }
  function _nowLine() {
    var now = new Date(), m = now.getHours()*60 + now.getMinutes();
    if (m < dayStartMin() || m > dayEndMin()) return '';
    return '<div class="tl-now" style="top:' + minToY(m) + 'px"></div>';
  }
  function _firstWindowMin(dates) {
    var min = null;
    dates.forEach(function (ds) { (state.windows[ds] || []).forEach(function (w) { var a = dtMin(w.start_at); if (min == null || a < min) min = a; }); });
    return min;
  }

  /* ── create / move / resize / delete on the time grid ── */
  function _bindTimeInteractions(scroll) {
    scroll.querySelectorAll('.tl-canvas').forEach(function (canvas) {
      var ds = canvas.getAttribute('data-date');

      // CREATE: press-hold on empty canvas → drag to size a new window.
      TimelineGestures.pressHold(canvas, {
        ms: 220,
        onHold: function (ev) {
          if (ev.target.closest('.tl-win') || ev.target.closest('.tl-bk')) return;   // not on an existing block
          if (_pinching()) return;                     // two-finger pinch owns the gesture
          _createDrag(ev, canvas, ds, scroll);
        }
      });

      // MOVE / RESIZE / DELETE on existing availability windows.
      canvas.querySelectorAll('.tl-win').forEach(function (win) {
        win.querySelector('.tl-del').addEventListener('click', function (e) { e.stopPropagation(); _delete(win.getAttribute('data-id')); });
        win.querySelector('.tl-h.top').addEventListener('pointerdown', function (e) { e.stopPropagation(); _resizeDrag(e, win, ds, 'top', scroll); });
        win.querySelector('.tl-h.bot').addEventListener('pointerdown', function (e) { e.stopPropagation(); _resizeDrag(e, win, ds, 'bot', scroll); });
        win.addEventListener('pointerdown', function (e) {
          if (e.target.closest('.tl-h') || e.target.closest('.tl-del')) return;
          _moveDrag(e, win, ds, scroll);
        });
      });

      // MOVE / RESIZE bookings (drag-to-reschedule; move supports cross-day in week view).
      canvas.querySelectorAll('.tl-bk').forEach(function (bk) {
        bk.querySelector('.tl-h.bot').addEventListener('pointerdown', function (e) { e.stopPropagation(); _bkResizeDrag(e, bk, scroll); });
        bk.addEventListener('pointerdown', function (e) {
          if (e.target.closest('.tl-h')) return;
          _bkMoveDrag(e, bk, scroll);
        });
      });
    });
  }

  // Resolve which day column the pointer is over (week view cross-day drag).
  function _dateUnderPointer(clientX, clientY, fallback) {
    var el = document.elementFromPoint(clientX, clientY);
    var canvas = el && el.closest ? el.closest('.tl-canvas') : null;
    return canvas ? canvas.getAttribute('data-date') : fallback;
  }

  function _bkMoveDrag(ev, bk, scroll) {
    var a0 = +bk.getAttribute('data-s'), b0 = +bk.getAttribute('data-e'), dur = b0 - a0;
    var date0 = bk.getAttribute('data-date');
    var canvas0 = bk.parentNode, startCanvasY = _canvasY(canvas0, ev.clientY);
    bk.classList.add('dragging');
    var na = a0, nd = date0;
    TimelineGestures.pointerDrag(ev, {
      threshold: 3,
      autoScroll: { el: scroll, edge: 52, maxSpeed: 16 },
      onMove: function (info) {
        var y = _canvasY(canvas0, info.clientY);
        na = snapMin(yToMin(y - (startCanvasY - minToY(a0))));
        na = Math.max(dayStartMin(), Math.min(dayEndMin() - dur, na));
        nd = _dateUnderPointer(info.clientX, info.clientY, date0);
        bk.style.top = minToY(na) + 'px';
        bk.querySelector('.tl-t').textContent = minToHm(na) + '–' + minToHm(na + dur) + (nd !== date0 ? ' →' + nd.slice(5) : '');
      },
      onEnd: function () {
        bk.classList.remove('dragging');
        if (na === a0 && nd === date0) return;
        _reschedule(bk.getAttribute('data-id'), nd, na, na + dur);
      },
      onCancel: function () { bk.classList.remove('dragging'); bk.style.top = minToY(a0) + 'px'; }
    });
  }

  function _bkResizeDrag(ev, bk, scroll) {
    var a0 = +bk.getAttribute('data-s'), b0 = +bk.getAttribute('data-e'), date0 = bk.getAttribute('data-date');
    bk.classList.add('dragging');
    var nb = b0;
    TimelineGestures.pointerDrag(ev, {
      autoScroll: { el: scroll, edge: 52, maxSpeed: 16 },
      onMove: function (info) {
        var y = _canvasY(bk.parentNode, info.clientY);
        nb = Math.max(a0 + state.snap, Math.min(dayEndMin(), snapMin(yToMin(y))));
        bk.style.height = Math.max(16, (nb - a0) * state.pxPerMin) + 'px';
        bk.querySelector('.tl-t').textContent = minToHm(a0) + '–' + minToHm(nb);
      },
      onEnd: function () {
        bk.classList.remove('dragging');
        if (nb === b0) return;
        _reschedule(bk.getAttribute('data-id'), date0, a0, nb);
      },
      onCancel: function () { bk.classList.remove('dragging'); }
    });
  }

  function _reschedule(id, date, aMin, bMin) {
    var startAt = date + ' ' + minToHm(aMin) + ':00';
    var endAt   = date + ' ' + minToHm(bMin) + ':00';
    _toast('予約を移動中…');
    fetch(_base() + '/reschedule.php', { method: 'POST', headers: _headers(true),
      body: JSON.stringify({ booking_id: id, booking_date: date, start_at: startAt, end_at: endAt }) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        var j = res.body || {};
        if (j.ok) { _toast('予約を' + date + ' ' + minToHm(aMin) + 'に変更しました'); }
        else if (j.error === 'slot_taken') { _toast('その時間帯は他の予約と重複します'); }
        else { _toast('変更に失敗: ' + _esc(j.error || ('HTTP ' + res.status))); }
        load();
      })
      .catch(function () { _toast('通信エラー'); load(); });
  }

  function _canvasY(canvas, clientY) {
    var r = canvas.getBoundingClientRect();
    return clientY - r.top;
  }

  function _createDrag(ev, canvas, ds, scroll) {
    var y0 = _canvasY(canvas, ev.clientY);
    var startMin = snapMin(yToMin(y0));
    var ghost = document.createElement('div'); ghost.className = 'tl-ghost'; canvas.appendChild(ghost);
    function paint(a, b) {
      ghost.style.top = minToY(Math.min(a,b)) + 'px';
      ghost.style.height = Math.max(state.snap * state.pxPerMin, Math.abs(b-a) * state.pxPerMin) + 'px';
      ghost.textContent = minToHm(Math.min(a,b)) + '–' + minToHm(Math.max(a, Math.min(a,b) + state.snap));
    }
    var curEnd = startMin + state.snap; paint(startMin, curEnd);
    TimelineGestures.pointerDrag(ev, {
      autoScroll: { el: scroll, edge: 52, maxSpeed: 16 },
      onMove: function (info) {
        var y = _canvasY(canvas, info.clientY);
        curEnd = snapMin(yToMin(y));
        paint(startMin, curEnd);
      },
      onEnd: function () {
        canvas.removeChild(ghost);
        var a = Math.min(startMin, curEnd), b = Math.max(startMin, curEnd);
        if (b - a < state.snap) b = a + state.snap;
        _add(ds, a, b);
      },
      onCancel: function () { if (ghost.parentNode) canvas.removeChild(ghost); }
    });
  }

  function _moveDrag(ev, win, ds, scroll) {
    var a0 = +win.getAttribute('data-s'), b0 = +win.getAttribute('data-e'), dur = b0 - a0;
    win.classList.add('dragging');
    var startCanvasY = _canvasY(win.parentNode, ev.clientY);
    var na = a0, nd = ds;   // vertical = time; horizontal (week view) = day column
    TimelineGestures.pointerDrag(ev, {
      threshold: 3,
      autoScroll: { el: scroll, edge: 52, maxSpeed: 16 },
      onMove: function (info) {
        var y = _canvasY(win.parentNode, info.clientY);
        na = snapMin(yToMin(y - (startCanvasY - minToY(a0))));
        na = Math.max(dayStartMin(), Math.min(dayEndMin() - dur, na));
        nd = _dateUnderPointer(info.clientX, info.clientY, nd);   // cross-day (same as bookings)
        win.style.top = minToY(na) + 'px';
        win.querySelector('.tl-t').textContent = minToHm(na) + '–' + minToHm(na + dur) + (nd !== ds ? ' →' + nd.slice(5) : '');
        win._na = na;
      },
      onEnd: function () {
        win.classList.remove('dragging');
        if (na === a0 && nd === ds) return;
        // hm_windows_update re-derives window_date from the start datetime, so a
        // date change here MOVES the window to the target day (backend supported).
        _update(win.getAttribute('data-id'), nd, na, na + dur);
      },
      onCancel: function () { win.classList.remove('dragging'); win.style.top = minToY(a0) + 'px'; }
    });
  }

  function _resizeDrag(ev, win, ds, edge, scroll) {
    var a0 = +win.getAttribute('data-s'), b0 = +win.getAttribute('data-e');
    win.classList.add('dragging');
    TimelineGestures.pointerDrag(ev, {
      autoScroll: { el: scroll, edge: 52, maxSpeed: 16 },
      onMove: function (info) {
        var y = _canvasY(win.parentNode, info.clientY), m = snapMin(yToMin(y));
        var a = a0, b = b0;
        if (edge === 'top') a = Math.min(b0 - state.snap, Math.max(dayStartMin(), m));
        else                b = Math.max(a0 + state.snap, Math.min(dayEndMin(), m));
        win.style.top = minToY(a) + 'px';
        win.style.height = Math.max(16, (b - a) * state.pxPerMin) + 'px';
        win.querySelector('.tl-t').textContent = minToHm(a) + '–' + minToHm(b);
        win._na = a; win._nb = b;
      },
      onEnd: function () {
        win.classList.remove('dragging');
        var a = win._na != null ? win._na : a0, b = win._nb != null ? win._nb : b0;
        if (a === a0 && b === b0) return;
        _update(win.getAttribute('data-id'), ds, a, b);
      },
      onCancel: function () { win.classList.remove('dragging'); }
    });
  }

  /* ── MONTH overview ── */
  function _renderMonth() {
    var grid = monthGrid(ymd(state.anchor)), mon = state.anchor.getMonth(), tdy = today();
    var body = document.getElementById('tlBody');
    var dows = '<div class="tl-mdow">' + DOW.map(function (d, i) { return '<div style="' + (i===0?'color:#d93025':i===6?'color:#1a73e8':'') + '">' + d + '</div>'; }).join('') + '</div>';
    var cells = grid.map(function (ds) {
      var d = parse(ds), inMonth = d.getMonth() === mon;
      var wins = state.windows[ds] || [];
      var totalMin = wins.reduce(function (acc, w) { return acc + (dtMin(w.end_at) - dtMin(w.start_at)); }, 0);
      var sum = totalMin > 0 ? '<span class="sum">' + (Math.round(totalMin/60*10)/10) + 'h 空き</span>' : '';
      // Bookings as draggable chips — drag between cells to move across days / weeks
      // / months (the 6-week grid spans them all; navigate months to go further).
      var chips = (state.bookings[ds] || []).map(function (b) {
        var pend = (b.status && b.status !== 'confirmed' && b.status !== 'completed') ? ' pending' : '';
        return '<div class="tl-mchip' + pend + '" data-id="' + _esc(b.id) + '" data-date="' + ds + '" ' +
               'data-s="' + dtMin(b.start_at) + '" data-e="' + dtMin(b.end_at) + '" ' +
               'title="' + _esc(b.customer_name || '') + '">' + minToHm(dtMin(b.start_at)) + ' ' + _esc(b.customer_name || '予約') + '</div>';
      }).join('');
      var cls = state.closed[ds];
      var meta = cls ? '<span class="closed-tag" title="' + _esc(cls.reason || '') + '">休業</span>' : sum;
      return '<div class="tl-mcell' + (inMonth ? '' : ' dim') + (ds === tdy ? ' tl-today' : '') + (cls ? ' tl-mcell-closed' : '') + '" data-date="' + ds + '">' +
               '<span class="n">' + d.getDate() + '</span>' + meta + chips + '</div>';
    }).join('');
    body.innerHTML = dows + '<div class="tl-month">' + cells + '</div>';
    body.querySelectorAll('.tl-mcell').forEach(function (c) {
      c.onclick = function (e) {
        if (e.target.closest('.tl-mchip')) return;
        if (Date.now() - _chipDragTs < 400) return;   // ignore the click synthesized after a chip drop
        state.anchor = parse(c.getAttribute('data-date')); state.view = 'day'; render();
      };
    });
    body.querySelectorAll('.tl-mchip').forEach(function (chip) {
      chip.addEventListener('pointerdown', function (e) { e.stopPropagation(); _mchipDrag(e, chip); });
    });
  }

  // Drag a booking chip between month cells → reschedule to the target DAY, keeping
  // the time-of-day. Covers cross-day, cross-week AND cross-month in one gesture.
  function _mchipDrag(ev, chip) {
    var id = chip.getAttribute('data-id'), date0 = chip.getAttribute('data-date');
    var sMin = +chip.getAttribute('data-s'), eMin = +chip.getAttribute('data-e');
    var target = date0, lastCell = null;
    _chipDragTs = Date.now();   // guard: suppress the click synthesized on pointerup
    chip.classList.add('dragging');
    function highlight(cell) {
      if (lastCell && lastCell !== cell) lastCell.classList.remove('droptarget');
      if (cell) cell.classList.add('droptarget');
      lastCell = cell;
    }
    TimelineGestures.pointerDrag(ev, {
      threshold: 4,
      onMove: function (info) {
        var el = document.elementFromPoint(info.clientX, info.clientY);
        var cell = el && el.closest ? el.closest('.tl-mcell') : null;
        target = cell ? cell.getAttribute('data-date') : date0;
        highlight(cell);
      },
      onEnd: function () {
        chip.classList.remove('dragging');
        if (lastCell) lastCell.classList.remove('droptarget');
        _chipDragTs = Date.now();   // refresh guard at drop time
        if (target && target !== date0) _reschedule(id, target, sMin, eMin);   // keep time, change day
      },
      onCancel: function () { chip.classList.remove('dragging'); if (lastCell) lastCell.classList.remove('droptarget'); }
    });
  }

  /* ── writes → availability-windows.php ── */
  function _post(payload, ok) {
    return fetch(_base() + '/availability-windows.php', { method: 'POST', headers: _headers(true), body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) { if (ok) _toast(ok); load(); return j; }
        _toast('失敗: ' + _esc((j && j.error) || 'error')); load(); return j;
      })
      .catch(function () { _toast('通信エラー'); load(); });
  }
  function _add(ds, aMin, bMin)   { return _post({ action:'add', date: ds, start_time: minToHm(aMin), end_time: minToHm(bMin) }, '空き時間帯を追加'); }
  function _update(id, ds, aMin, bMin) { return _post({ action:'update', id: id, date: ds, start_time: minToHm(aMin), end_time: minToHm(bMin) }, '更新しました'); }
  function _delete(id) { if (!window.confirm('この空き時間帯を削除しますか？')) return; return _post({ action:'delete', id: id }, '削除しました'); }

  /* ── public entry (from go('calendar')) ── */
  function onShow() {
    if (!_enabled()) return false;
    if (!state.anchor) state.anchor = parse(today());
    if (!mount()) return false;
    _loadConfig(load);
    return true;
  }

  var _debug = {
    minToY: minToY, yToMin: yToMin, snapMin: snapMin, weekDates: weekDates, monthGrid: monthGrid,
    hmToMin: hmToMin, minToHm: minToHm, dtMin: dtMin,
    setCfg: function (c) { state.cfg = Object.assign(state.cfg, c || {}); },
    setSnap: function (n) { state.snap = n; }, setView: function (v) { state.view = v; },
    setAnchor: function (s) { state.anchor = parse(s); }, rangeOf: rangeOf,
    pxPerMin: function () { return state.pxPerMin; }
  };

  return { onShow: onShow, mount: mount, reload: load, enabled: _enabled, configure: configure, _debug: _debug };
})();
