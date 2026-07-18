/* ════════════════════════════════════════════════════════════════════════════
   calendar.js — M5 Dispatcher Calendar (/ops/calendar.html)

   A flexible, Curama-style operational calendar over the EXISTING bookings.
     • Day timeline (06:00–22:00) · Week columns · Month grid
     • Booking cards positioned at their ACTUAL time (start_at/end_at, or parsed
       from the packed notes time) — NO time bands, NO booking_slots, NO locking
     • Drag to reschedule: another date (week/month), another time + duration (day)
       persisted through the existing bookings update (rest.php: booking_date /
       start_at / end_at only) — the booking engine is never touched
     • Filters (status / staff / search / scope) · staff overlay · detail modal
       with the exact furniture list · lazy per-view rendering (500+ bookings)
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, Api = Ops.Api;

  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var H0 = 6, H1 = 22;                          // timeline window
  var HOUR_PX = 58;                             // must match --cal-hour

  var STATUS_CLASS = { '新規': 'cst-pending', '確認中': 'cst-progress', '確定': 'cst-confirm', '完了': 'cst-done', 'キャンセル': 'cst-cancel', '却下': 'cst-cancel', '要修正': 'cst-progress' };
  var STATUS_FILTERS = [
    { k: 'all', l: 'calendar.f.all' },
    { k: '新規', l: 'calendar.f.pending' },
    { k: '確定', l: 'calendar.f.confirmed' },
    { k: '確認中', l: 'calendar.f.progress' },
    { k: '完了', l: 'calendar.f.completed' },
  ];

  var state = {
    selected: U.todayStr(), anchor: U.todayStr(), view: 'day',
    bookings: [], byDate: {}, error: false,
    q: '', status: 'all', staff: 'all', staffOverlay: false, sheet: null,
  };

  /* ── Debug overlay (opt-in via ?debug=1) ──────────────────────────────────
     Logs the pointer-DnD lifecycle on-screen so a real-device failure can be
     pinpointed. Zero cost / never rendered unless ?debug=1 is in the URL.
     BUILD is a marker so you can confirm the device actually loaded THIS file
     (vs a stale service-worker cache). Bump it whenever calendar.js changes. */
  var BUILD = 'calendar-2026-07-17b-no-capture';
  var DBG = /[?&]debug=1(?:&|$)/.test(location.search || '');
  var _dbgEl = null, _dbgMoveT = 0, _dbgEnvDone = false;
  function dbg(msg) {
    if (!DBG) return;
    try { console.log('[cal] ' + msg); } catch (_) {}
    if (!_dbgEl) {
      _dbgEl = document.createElement('div');
      _dbgEl.id = 'cal-dbg';
      _dbgEl.style.cssText = 'position:fixed;left:6px;right:6px;bottom:6px;max-height:40vh;overflow:auto;z-index:99999;background:rgba(20,24,18,.94);color:#c8f0a8;font:11px/1.35 ui-monospace,monospace;padding:8px 10px;border-radius:8px;white-space:pre-wrap;-webkit-user-select:text;user-select:text';
      (document.body || document.documentElement).appendChild(_dbgEl);
    }
    var d = new Date();
    var ts = ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2) + '.' + ('00' + d.getMilliseconds()).slice(-3);
    _dbgEl.textContent = ts + '  ' + msg + '\n' + _dbgEl.textContent;
    if (_dbgEl.textContent.length > 6000) _dbgEl.textContent = _dbgEl.textContent.slice(0, 6000);
  }
  function dbgTarget(t) {
    if (!t) return 'NONE';
    var h = t.getAttribute('data-drop-hour'); if (h != null) return 'hour ' + h;
    var d = t.getAttribute('data-drop-date'); if (d != null) return 'date ' + d;
    return t.className || t.tagName;
  }
  function dbgEnvOnce() {
    if (!DBG || _dbgEnvDone) return; _dbgEnvDone = true;
    dbg('BUILD ' + BUILD);
    dbg('PointerEvent=' + (typeof window.PointerEvent !== 'undefined') + ' maxTouch=' + (navigator.maxTouchPoints || 0));
    var card = document.querySelector('.cal-event, .cal-wk-card, .cal-chip-bk');
    dbg('card touch-action=' + (card ? getComputedStyle(card).touchAction : 'NO CARD RENDERED') + ' view=' + state.view);
    dbg('tap a booking to test — expect: pointerdown → BEGIN → move → drop → PERSIST');
  }

  /* ── Date helpers ──────────────────────────────────────────────────────── */
  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmt(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sundayOf(s) { var d = parse(s); return addDays(d, -d.getDay()); }
  function weekDates(anchor) { var ws = sundayOf(anchor); var o = []; for (var i = 0; i < 7; i++) o.push(fmt(addDays(ws, i))); return o; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function min2hm(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function nowSql() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

  /* ── Schedule derivation (real times only — never bands) ───────────────── */
  function hmFrom(s) { var d = new Date(String(s).replace(' ', 'T')); if (isNaN(d)) return null; return { h: d.getHours(), m: d.getMinutes() }; }
  function sched(b) {
    var s = b.startAt ? hmFrom(b.startAt) : null;
    var e = b.endAt ? hmFrom(b.endAt) : null;
    if (!s && b.time) {
      var m = String(b.time).match(/(\d{1,2}):(\d{2})(?:\s*[-–~〜]\s*(\d{1,2}):(\d{2}))?/);
      if (m) { s = { h: +m[1], m: +m[2] }; if (m[3]) e = { h: +m[3], m: +m[4] }; }
    }
    var hasTime = !!s;
    if (!s) s = { h: 9, m: 0 };
    if (!e) e = { h: Math.min(s.h + 2, 23), m: s.m };
    var sMin = s.h * 60 + s.m, eMin = e.h * 60 + e.m;
    if (eMin <= sMin) eMin = sMin + 60;
    return { sMin: sMin, eMin: eMin, hasTime: hasTime };
  }
  function timeLabel(b) { var t = sched(b); return min2hm(t.sMin) + '-' + min2hm(t.eMin); }
  function stClass(b) { return STATUS_CLASS[b.status] || 'cst-done'; }

  /* ── byDate index (excludes cancelled from the board; kept in state.bookings) */
  function reindex() {
    var by = {};
    state.bookings.forEach(function (b) {
      if (!b.date || b.status === 'キャンセル') return;
      (by[b.date] = by[b.date] || []).push(b);
    });
    Object.keys(by).forEach(function (d) { by[d].sort(function (a, b) { return sched(a).sMin - sched(b).sMin; }); });
    state.byDate = by;
  }
  function removeBk(b) { var a = state.byDate[b.date]; if (!a) return; var i = a.indexOf(b); if (i >= 0) a.splice(i, 1); }
  function addBk(b) { if (b.status === 'キャンセル') return; (state.byDate[b.date] = state.byDate[b.date] || []).push(b); state.byDate[b.date].sort(function (x, y) { return sched(x).sMin - sched(y).sMin; }); }

  /* ── Filters ───────────────────────────────────────────────────────────── */
  function staffOf(b) { return (b.workers && String(b.workers).trim()) || t('calendar.unassigned'); }
  function passesFilter(b) {
    if (state.status !== 'all' && b.status !== state.status) return false;
    if (state.staff !== 'all' && staffOf(b) !== state.staff) return false;
    if (state.q) {
      var q = state.q.trim().toLowerCase();
      if ((b.name + ' ' + b.ref + ' ' + (b.service || '')).toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }
  function dayList(date) { return (state.byDate[date] || []).filter(passesFilter); }
  function staffOptions() {
    var set = {};
    state.bookings.forEach(function (b) { if (b.status !== 'キャンセル') set[staffOf(b)] = 1; });
    return Object.keys(set).sort();
  }

  /* ── Counts / summary ──────────────────────────────────────────────────── */
  function todayCount() { return (state.byDate[U.todayStr()] || []).length; }
  function pendingCount() { return state.bookings.filter(function (b) { return b.status === '新規'; }).length; }

  /* ════════════════════════════════════════════════════════════════════════
     Render — shell + active view
     ════════════════════════════════════════════════════════════════════════ */
  function titleFor() {
    var a = parse(state.anchor);
    if (state.view === 'day') return U.fmtDateFull(state.selected);
    if (state.view === 'week') { var w = weekDates(state.anchor); var s = parse(w[0]), e = parse(w[6]); return (s.getMonth() + 1) + '/' + s.getDate() + ' – ' + (e.getMonth() + 1) + '/' + e.getDate(); }
    return a.getFullYear() + '年' + (a.getMonth() + 1) + '月';
  }
  function step(dir) {
    if (state.view === 'day') { state.selected = fmt(addDays(parse(state.selected), dir)); state.anchor = state.selected; }
    else if (state.view === 'week') { state.anchor = fmt(addDays(parse(state.anchor), 7 * dir)); }
    else { var d = parse(state.anchor); d.setMonth(d.getMonth() + dir); state.anchor = fmt(d); }
    render();
  }

  function render() {
    var el = document.getElementById('ops-content');
    if (state.error) { el.innerHTML = errorState(); var rt = document.getElementById('cal-retry'); if (rt) rt.addEventListener('click', load); return; }

    el.innerHTML =
      summaryHtml() +
      '<div class="cal-views"><div class="cal-seg">' +
        ['day', 'week', 'month'].map(function (v) { return '<button data-view="' + v + '" class="' + (state.view === v ? 'active' : '') + '">' + t('calendar.v.' + v) + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="cal-toolbar">' +
        '<button class="cal-nav" id="cal-prev">' + UI.icon('chevronL') + '</button>' +
        '<div class="cal-title">' + U.esc(titleFor()) + '</div>' +
        '<button class="cal-nav" id="cal-next">' + UI.icon('chevronR') + '</button>' +
        '<button class="cal-today" id="cal-today">' + t('calendar.today') + '</button>' +
      '</div>' +
      filtersHtml() +
      '<div id="cal-body"></div>';

    el.querySelectorAll('[data-view]').forEach(function (b) { b.addEventListener('click', function () { state.view = b.getAttribute('data-view'); render(); }); });
    document.getElementById('cal-prev').addEventListener('click', function () { step(-1); });
    document.getElementById('cal-next').addEventListener('click', function () { step(1); });
    document.getElementById('cal-today').addEventListener('click', function () { state.selected = U.todayStr(); state.anchor = state.selected; render(); });
    wireFilters();
    renderBody();
  }

  function summaryHtml() {
    return '<div class="cal-summary">' +
      '<div class="cal-badge">' + UI.icon('calendar') + '<div><b>' + todayCount() + '</b> <span>' + t('calendar.todayBookings') + '</span></div></div>' +
      '<div class="cal-badge warn">' + UI.icon('clock') + '<div><b>' + pendingCount() + '</b> <span>' + t('calendar.pendingReview') + '</span></div></div>' +
    '</div>';
  }

  function filtersHtml() {
    var staff = staffOptions();
    return '<div class="cal-filters">' +
      '<div class="cal-search">' + UI.icon('search') + '<input id="cal-q" type="search" placeholder="' + t('calendar.searchPh') + '" autocomplete="off" /></div>' +
      '<div class="cal-chips">' +
        STATUS_FILTERS.map(function (f) { return '<button class="cal-chip' + (state.status === f.k ? ' active' : '') + '" data-st="' + f.k + '">' + t(f.l) + '</button>'; }).join('') +
        '<select class="cal-staff-sel" id="cal-staff"><option value="all">' + t('calendar.allStaff') + '</option>' +
          staff.map(function (s) { return '<option value="' + U.esc(s) + '"' + (state.staff === s ? ' selected' : '') + '>' + U.esc(s) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<label class="cal-toggle" style="margin-top:8px"><input type="checkbox" id="cal-staff-ov"' + (state.staffOverlay ? ' checked' : '') + ' /> ' + t('calendar.staffOverlay') + '</label>' +
    '</div>';
  }

  function wireFilters() {
    var q = document.getElementById('cal-q');
    q.value = state.q;
    q.addEventListener('input', U.debounce(function () { state.q = q.value; renderBody(); }, 200));
    document.querySelectorAll('[data-st]').forEach(function (c) { c.addEventListener('click', function () { state.status = c.getAttribute('data-st'); render(); }); });
    document.getElementById('cal-staff').addEventListener('change', function () { state.staff = this.value; renderBody(); });
    document.getElementById('cal-staff-ov').addEventListener('change', function () { state.staffOverlay = this.checked; renderBody(); });
  }

  function renderBody() {
    var host = document.getElementById('cal-body');
    if (!host) return;
    if (state.staffOverlay) { host.innerHTML = staffOverlayHtml(); bindCards(host, 'date'); return; }
    if (state.view === 'day') { host.innerHTML = dayHtml(); bindDay(host); }
    else if (state.view === 'week') { host.innerHTML = weekHtml(); bindCards(host, 'date'); }
    else { host.innerHTML = monthHtml(); bindCards(host, 'date'); }
  }

  /* ── DAY view (timeline, absolute cards, time DnD + resize) ─────────────── */
  function packLanes(evs) {
    var laneEnd = [];
    evs.forEach(function (ev) {
      var placed = false;
      for (var i = 0; i < laneEnd.length; i++) { if (ev._s >= laneEnd[i]) { ev._lane = i; laneEnd[i] = ev._e; placed = true; break; } }
      if (!placed) { ev._lane = laneEnd.length; laneEnd.push(ev._e); }
    });
    return laneEnd.length || 1;
  }
  function dayHtml() {
    var list = dayList(state.selected);
    var hours = '';
    for (var h = H0; h <= H1; h++) hours += '<div class="cal-hour-lbl">' + pad(h) + ':00</div>';
    var rows = '';
    for (var r = H0; r <= H1; r++) rows += '<div class="cal-hour-row" data-drop-hour="' + r + '"></div>';

    list.forEach(function (b) { var s = sched(b); b._s = s.sMin; b._e = s.eMin; });
    var lanes = packLanes(list);
    var events = list.map(function (b) {
      var top = ((b._s - H0 * 60) / 60) * HOUR_PX;
      var hgt = Math.max(((b._e - b._s) / 60) * HOUR_PX - 4, 26);
      var w = 100 / lanes, left = b._lane * w;
      return '<div class="cal-event ' + stClass(b) + '" data-open="' + U.esc(b.dbId) + '" data-drag="time" ' +
        'style="top:' + top + 'px;height:' + hgt + 'px;left:calc(' + left + '% + 2px);width:calc(' + w + '% - 4px)">' +
        '<div class="e-name">' + U.esc(b.name) + t('common.honorific') + '</div>' +
        '<div class="e-meta">' + U.esc(b.service || t('common.booking')) + ' · ' + timeLabel(b) + '</div>' +
        '<div class="cal-resize" data-resize="' + U.esc(b.dbId) + '"></div>' +
      '</div>';
    }).join('');
    var body = '<div class="cal-day"><div class="cal-hours">' + hours + '</div>' +
      '<div class="cal-timeline" style="height:' + ((H1 - H0 + 1) * HOUR_PX) + 'px">' + rows + events + '</div></div>';
    if (!list.length) body += '<div class="cal-hint">' + t('calendar.noBookingsDay') + '</div>';
    return body + '<div class="cal-hint">' + t('calendar.dragHint') + '</div>';
  }
  function bindDay(host) {
    dbgEnvOnce();
    host.querySelectorAll('[data-open]').forEach(function (el) {
      el.addEventListener('click', function () { openDetail(el.getAttribute('data-open')); });
      var b = byId(el.getAttribute('data-open'));
      if (b) attachDrag(el, b, 'time');
    });
    host.querySelectorAll('[data-resize]').forEach(function (g) {
      var b = byId(g.getAttribute('data-resize'));
      if (b) attachResize(g, b);
    });
  }

  /* ── WEEK view (columns, date DnD) ─────────────────────────────────────── */
  function weekHtml() {
    var today = U.todayStr();
    return '<div class="cal-week">' + weekDates(state.anchor).map(function (d) {
      var dt = parse(d), list = dayList(d);
      var cards = list.map(function (b) {
        return '<div class="cal-wk-card ' + stClass(b) + '" data-open="' + U.esc(b.dbId) + '" data-drag="date">' +
          '<div class="w-time">' + timeLabel(b) + '</div><div class="w-name">' + U.esc(b.name) + t('common.honorific') + '</div></div>';
      }).join('');
      return '<div class="cal-col" data-drop-date="' + d + '">' +
        '<div class="cal-col-hd' + (d === today ? ' today' : '') + '">' + WD[dt.getDay()] + '<small>' + (dt.getMonth() + 1) + '/' + dt.getDate() + '</small></div>' +
        '<div class="cal-col-body">' + (cards || '<div class="cal-hint" style="margin:6px 0">—</div>') + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ── MONTH view (grid, date DnD) ───────────────────────────────────────── */
  function monthCells(anchor) {
    var a = parse(anchor); a.setDate(1);
    var start = addDays(a, -a.getDay());
    var mon = a.getMonth(), out = [];
    for (var i = 0; i < 42; i++) { var d = addDays(start, i); out.push({ date: fmt(d), inMonth: d.getMonth() === mon }); }
    return out;
  }
  function monthHtml() {
    var today = U.todayStr();
    var wd = '<div class="cal-month-wd">' + WD.map(function (w) { return '<div>' + w + '</div>'; }).join('') + '</div>';
    var cells = monthCells(state.anchor).map(function (c) {
      var dt = parse(c.date), list = dayList(c.date);
      var chips = list.slice(0, 3).map(function (b) {
        return '<div class="cal-chip-bk ' + stClass(b) + '" data-open="' + U.esc(b.dbId) + '" data-drag="date"><i></i><span>' + U.esc(b.name) + '</span></div>';
      }).join('');
      var more = list.length > 3 ? '<div class="cal-more">+' + (list.length - 3) + '</div>' : '';
      return '<div class="cal-cell' + (c.inMonth ? '' : ' dim') + (c.date === today ? ' today' : '') + '" data-drop-date="' + c.date + '" data-goto="' + c.date + '">' +
        '<div class="cal-cell-d">' + dt.getDate() + '</div>' + chips + more + '</div>';
    }).join('');
    return wd + '<div class="cal-month">' + cells + '</div>';
  }

  /* ── Staff overlay ─────────────────────────────────────────────────────── */
  function currentRange() {
    if (state.view === 'day') return [state.selected];
    if (state.view === 'week') return weekDates(state.anchor);
    return monthCells(state.anchor).filter(function (c) { return c.inMonth; }).map(function (c) { return c.date; });
  }
  function staffOverlayHtml() {
    var groups = {};
    currentRange().forEach(function (d) { dayList(d).forEach(function (b) { var s = staffOf(b); (groups[s] = groups[s] || []).push(b); }); });
    var keys = Object.keys(groups).sort();
    if (!keys.length) return '<div class="cal-none">' + t('calendar.noBookingsRange') + '</div>';
    return keys.map(function (k) {
      var items = groups[k].sort(function (a, b) { return (a.date + a._s).localeCompare ? String(a.date).localeCompare(String(b.date)) : 0; });
      var cards = items.map(function (b) {
        return '<div class="cal-wk-card ' + stClass(b) + '" data-open="' + U.esc(b.dbId) + '" style="margin-bottom:6px">' +
          '<div class="w-time">' + U.fmtDate(b.date) + ' · ' + timeLabel(b) + '</div><div class="w-name">' + U.esc(b.name) + t('common.honorific') + ' · ' + U.esc(b.service || t('common.booking')) + '</div></div>';
      }).join('');
      return '<div class="cal-staff-grp"><div class="cal-staff-hd">' + UI.icon('customers') + U.esc(k) + '<span class="n">' + items.length + t('calendar.staffUnit') + '</span></div>' + cards + '</div>';
    }).join('');
  }

  /* ── Card binding (week/month/staff share date-drag + tap-to-open) ─────── */
  function bindCards(host, mode) {
    host.querySelectorAll('[data-open]').forEach(function (el) {
      el.addEventListener('click', function () { openDetail(el.getAttribute('data-open')); });
      if (el.getAttribute('data-drag')) { var b = byId(el.getAttribute('data-open')); if (b) attachDrag(el, b, mode); }
    });
    host.querySelectorAll('[data-goto]').forEach(function (cell) {
      cell.addEventListener('click', function (e) {
        if (e.target.closest('[data-open]')) return;               // chip handled its own tap
        state.selected = cell.getAttribute('data-goto'); state.anchor = state.selected; state.view = 'day'; render();
      });
    });
  }

  function byId(id) { for (var i = 0; i < state.bookings.length; i++) if (String(state.bookings[i].dbId) === String(id)) return state.bookings[i]; return null; }

  /* ════════════════════════════════════════════════════════════════════════
     Drag & drop (long-press) — reschedule via existing bookings update
     ════════════════════════════════════════════════════════════════════════ */
  function attachDrag(el, b, mode) {
    el.addEventListener('pointerdown', function (e) {
      if (e.button && e.button !== 0) return;
      dragSession(e, el, b, mode);
    });
  }
  function attachResize(g, b) {
    g.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      if (e.button && e.button !== 0) return;
      dragSession(e, g.parentNode, b, 'resize');
    });
  }
  function dragSession(e, el, b, mode) {
    var sx = e.clientX, sy = e.clientY, dragging = false, ghost = null;
    var pid = e.pointerId;
    function begin() {
      dragging = true; document.body.classList.add('cal-dnd'); el.classList.add('cal-dragging');
      dbg('BEGIN drag mode=' + mode);
      if (mode !== 'resize') { ghost = el.cloneNode(true); ghost.className += ' cal-ghost'; ghost.style.width = el.offsetWidth + 'px'; document.body.appendChild(ghost); place(sx, sy); }
    }
    function place(x, y) { if (ghost) { ghost.style.left = (x - el.offsetWidth / 2) + 'px'; ghost.style.top = (y - 18) + 'px'; } }
    function hot(x, y) {
      clearHot();
      var t = dropAt(x, y, mode);
      if (t) t.classList.add('cal-hot');
    }
    function move(ev) {
      if (!dragging) {
        // Start the drag as soon as the pointer moves past a small threshold.
        // (The old 200ms hold + ">10px → cancel" gate aborted every real drag,
        // because a genuine drag moves before the timer fires. touch-action:none
        // on the card already prevents the browser from scroll-hijacking, so no
        // long-press is needed to disambiguate.)
        if (Math.abs(ev.clientX - sx) < 8 && Math.abs(ev.clientY - sy) < 8) return;  // still a tap
        begin();
      }
      ev.preventDefault(); place(ev.clientX, ev.clientY); hot(ev.clientX, ev.clientY);
      if (DBG && Date.now() - _dbgMoveT > 200) { _dbgMoveT = Date.now(); dbg('move dx=' + Math.round(ev.clientX - sx) + ' dy=' + Math.round(ev.clientY - sy)); }
    }
    function up(ev) { var t = dragging ? dropAt(ev.clientX, ev.clientY, mode) : null; if (DBG) dbg('pointerup dragging=' + dragging + ' target=' + dbgTarget(t)); end(t); }
    function end(target) {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel);
      if (ghost) ghost.remove();
      document.body.classList.remove('cal-dnd'); el.classList.remove('cal-dragging'); clearHot();
      if (dragging) {
        // A real drag happened — swallow the click that the browser fires next so
        // the detail modal doesn't pop open on drop.
        var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); el.removeEventListener('click', swallow, true); };
        el.addEventListener('click', swallow, true);
        setTimeout(function () { el.removeEventListener('click', swallow, true); }, 400);
        if (target) applyDrop(b, target, mode);
      }
      dragging = false;
    }
    function cancel() { dbg('POINTERCANCEL → abort (dragging=' + dragging + ')'); end(null); }   // pointercancel (e.g. OS gesture)
    dbg('pointerdown mode=' + mode + ' pid=' + pid);
    // NOTE: do NOT setPointerCapture here. On iOS/WebKit, calling it inside
    // pointerdown suppresses subsequent pointermove events (the drag never
    // starts). Touch pointers are IMPLICITLY captured to the pointerdown target
    // and their events bubble to document, so these document-level listeners
    // receive move/up reliably; touch-action:none stops the browser scrolling.
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  }
  function dropAt(x, y, mode) {
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    return el.closest(mode === 'time' || mode === 'resize' ? '[data-drop-hour]' : '[data-drop-date]');
  }
  function clearHot() { document.querySelectorAll('.cal-hot').forEach(function (n) { n.classList.remove('cal-hot'); }); }

  function applyDrop(b, tgt, mode) {
    var cur = sched(b), sMin = cur.sMin, eMin = cur.eMin, dur = eMin - sMin, newDate = b.date, setTimes = cur.hasTime;
    if (mode === 'date') {
      newDate = tgt.getAttribute('data-drop-date');
      if (newDate === b.date) return;
    } else if (mode === 'time') {
      var hr = +tgt.getAttribute('data-drop-hour'); sMin = hr * 60; eMin = sMin + dur; setTimes = true;
      if (sMin === cur.sMin) return;
    } else if (mode === 'resize') {
      var hr2 = +tgt.getAttribute('data-drop-hour'); eMin = (hr2 + 1) * 60; if (eMin <= sMin) eMin = sMin + 60; setTimes = true;
      if (eMin === cur.eMin) return;
    }
    dbg('applyDrop mode=' + mode + ' → date=' + newDate + ' ' + min2hm(sMin) + '-' + min2hm(eMin));
    commit(b, newDate, sMin, eMin, setTimes);
  }

  function commit(b, newDate, sMin, eMin, setTimes) {
    var prev = { date: b.date, startAt: b.startAt, endAt: b.endAt, time: b.time };
    removeBk(b);
    b.date = newDate;
    if (setTimes) { b.startAt = newDate + ' ' + min2hm(sMin) + ':00'; b.endAt = newDate + ' ' + min2hm(eMin) + ':00'; b.time = min2hm(sMin) + '-' + min2hm(eMin); }
    else if (b.startAt) { b.startAt = newDate + ' ' + b.startAt.slice(11); if (b.endAt) b.endAt = newDate + ' ' + b.endAt.slice(11); }
    addBk(b);
    renderBody();
    UI.toast(t('common.saving'));

    var values = { updated_at: nowSql(), booking_date: newDate };
    if (setTimes || b.startAt) { if (b.startAt) values.start_at = b.startAt; if (b.endAt) values.end_at = b.endAt; }
    Api.rest({ table: 'bookings', action: 'update', values: values, filters: [{ col: 'id', op: 'eq', val: b.dbId }] }).then(function (res) {
      if (res.error) {
        dbg('PERSIST FAIL: ' + ((res.error && res.error.message) || 'error'));
        removeBk(b); b.date = prev.date; b.startAt = prev.startAt; b.endAt = prev.endAt; b.time = prev.time; addBk(b);
        renderBody(); UI.toast(t('common.saveFailed') + '：' + ((res.error && res.error.message) || ''));
      } else { dbg('PERSIST OK (booking_date=' + newDate + ')'); UI.toast(t('calendar.savedBk', { name: b.name })); }
    });
  }

  /* ── Detail modal ──────────────────────────────────────────────────────── */
  function kv(k, v) { return v ? '<div class="ops-kv"><span class="k">' + k + '</span><span class="v">' + U.esc(v) + '</span></div>' : ''; }
  function furnitureHtml(items) {
    if (!items || !items.length) return '<div class="cal-none">' + t('furniture.none') + '</div>';
    if (window.HMFmt) return HMFmt.furnitureGrid(items);   // T4 — icon + name + ×qty cards
    var agg = {}, order = [];
    items.forEach(function (it) { var n = String(it).trim(); if (!n) return; if (!(n in agg)) { agg[n] = 0; order.push(n); } agg[n]++; });
    return '<div class="cal-furni">' + order.map(function (n) {
      var hasCount = /[×xX]\s*\d+\s*$/.test(n);
      return '<div class="f"><span>' + U.esc(n) + '</span>' + (hasCount ? '' : '<span class="fx">×' + agg[n] + '</span>') + '</div>';
    }).join('') + '</div>';
  }
  function openDetail(id) {
    var b = byId(id); if (!b) return;
    var price = b.price || b.amount || b.total_price;
    var addr = (kv(t('customers.currentAddr'), Ops.addrText(b, 'from')) + kv(t('customers.destAddr'), Ops.addrText(b, 'to'))) || '<p class="cal-none" style="margin:6px 0">' + t('customers.noAddr') + '</p>';
    var html =
      '<h2>' + U.esc(b.name) + t('common.honorific') + '</h2>' +
      '<div class="ops-muted" style="margin:0 0 12px;font-size:.86rem">' + t('bookings.receiptNo') + ' ' + U.esc(b.ref) + ' · <span class="cal-stbadge ' + stClass(b) + '">' + U.esc(t('status.' + Ops.toDbStatus(b.status))) + '</span></div>' +
      '<div class="ops-card" style="margin:0 0 12px;padding:4px 14px">' +
        kv(t('bookings.service'), b.service) + kv(t('bookings.moveDate'), U.fmtDateFull(b.date)) + kv(t('calendar.time'), timeLabel(b)) +
        kv(t('bookings.phone'), b.phone) + kv(t('bookings.email'), b.email) +
        kv(t('calendar.staff'), b.workers) + (price ? kv(t('calendar.price'), price) : '') +
      '</div>' +
      '<div class="ops-section-title" style="margin:4px 2px 8px">' + t('customers.addresses') + '</div><div class="ops-card" style="margin:0 0 12px;padding:4px 14px">' + addr + '</div>' + Ops.addrExtraHtml(b) +
      (b.notes ? '<div class="ops-section-title" style="margin:4px 2px 8px">' + t('customers.memo') + '</div><div class="ops-card" style="margin:0 0 12px;padding:10px 14px;font-size:.9rem">' + U.esc(b.notes) + '</div>' : '') +
      ((window.HMFmt && HMFmt.preferredOptions(b)) ? '<div class="ops-card" style="margin:0 0 12px;padding:10px 14px">' + HMFmt.preferredOptions(b) + '</div>' : '') +   // T5
      '<div class="ops-section-title" style="margin:4px 2px 8px">' + t('furniture.title') + '</div>' + furnitureHtml(b.items) +
      '<div class="ops-btn-row" style="margin-top:14px">' +
        '<a class="ops-btn ghost" href="customers.html">' + UI.icon('customers') + t('calendar.customer') + '</a>' +
        '<a class="ops-btn ghost" href="message.html?booking=' + encodeURIComponent(b.dbId) + '&ref=' + encodeURIComponent(b.ref) + '">' + UI.icon('chat') + t('bookings.chat') + '</a>' +
      '</div>' +
      '<div class="ops-btn-row" style="margin-top:8px">' +
        '<a class="ops-btn sage" href="bookings.html?ref=' + encodeURIComponent(b.ref) + '">' + UI.icon('bookings') + t('calendar.editBooking') + '</a>' +
      '</div>';
    state.sheet.open(html);
  }

  /* ── Load / boot ───────────────────────────────────────────────────────── */
  function errorState() {
    return '<div class="ops-empty">' + UI.icon('empty') + '<h3>' + t('bookings.errorTitle') + '</h3>' +
      '<p>' + t('bookings.errorSub') + '</p><button class="ops-btn" id="cal-retry" style="margin-top:14px">' + t('common.retry') + '</button></div>';
  }
  function load() {
    var el = document.getElementById('ops-content');
    el.innerHTML = UI.skeleton(6);
    state.error = false;
    Api.listBookings().then(function (r) {
      if (r.error && !(r.data && r.data.length)) { state.error = true; render(); return; }
      state.bookings = r.data || [];
      reindex();
      render();
    });
  }

  /* Live sync (P2): re-fetch on an interval so a confirmation / reschedule / new
     booking made elsewhere (e.g. the Bookings screen or the customer flow) shows
     on the calendar without a manual reload. Skips while dragging or while a
     detail sheet is open, and refreshes only the body + summary counts so an
     in-progress search/filter keeps its focus. Slot reservation itself is the
     existing slot architecture (unchanged) — this reflects its result. */
  function refresh() {
    if (state.error) return;
    if (document.body.classList.contains('cal-dnd')) return;                 // mid-drag
    if (document.querySelector('.ops-sheet-backdrop.open')) return;          // viewing a booking
    Api.listBookings().then(function (r) {
      if (r.error && !(r.data && r.data.length)) return;                     // transient blip → keep current
      state.bookings = r.data || [];
      reindex();
      if (document.getElementById('cal-body')) renderBody();
      var sum = document.querySelector('.cal-summary');
      if (sum) sum.outerHTML = summaryHtml();
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: 'calendar', title: t('calendar.title') });
    state.sheet = UI.sheet();
    load();
    setInterval(refresh, Ops.cfg.POLL_MS);
  });
})();
