/* ════════════════════════════════════════════════════════════════════════════
   calendar.js — M5 Calendar (/ops/calendar.html)

   READ-ONLY. Day + week views of slot availability and booking blocks.
   Availability (available / reserved / full per band) comes from the existing
   availability.php (booking_slots + capacity); booking blocks come from the
   bookings table. No slot is created, reserved, or released here.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, Api = Ops.Api;

  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var BANDS = [
    { key: 'am', label: '午前', time: '08:00–12:00' },
    { key: 'pm', label: '午後', time: '12:00–16:00' },
    { key: 'ev', label: '夕方', time: '16:00–19:00' },
    { key: 'nt', label: '夜間', time: '19:00–21:00' },
  ];

  var state = { selected: U.todayStr(), weekStart: null, view: 'day', bookings: [], byDate: {}, avail: {} };

  /* ── Date helpers ──────────────────────────────────────────────────────── */
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmt(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sundayOf(s) { var d = parse(s); return addDays(d, -d.getDay()); }
  function weekDates() { var out = []; for (var i = 0; i < 7; i++) out.push(fmt(addDays(state.weekStart, i))); return out; }

  function bookingsOf(date) { return (state.byDate[date] || []); }

  /* ── Availability fetch + cache ────────────────────────────────────────── */
  function loadAvail(date) {
    if (state.avail[date]) return Promise.resolve(state.avail[date]);
    return Api.availability(date).then(function (j) {
      var a = (j && j.ok) ? { bands: j.bands || {}, capacity: j.capacity || null } : { bands: {}, capacity: null };
      state.avail[date] = a;
      return a;
    });
  }

  function bandState(date, key) {
    var a = state.avail[date];
    if (!a) return 'loading';
    var cap = a.capacity && a.capacity[key];
    if (cap) {
      if (cap.closed) return 'full';
      if (typeof cap.remaining === 'number' && cap.remaining <= 0) return 'full';
    }
    return a.bands[key] === 'reserved' ? 'reserved' : 'available';
  }
  var STATE_LABEL = { available: '空きあり', reserved: '予約済み', full: '満枠', loading: '…' };

  /* ── Render ────────────────────────────────────────────────────────────── */
  function render() {
    var el = document.getElementById('ops-content');
    var ws = state.weekStart;
    var title = ws.getFullYear() + '年' + (ws.getMonth() + 1) + '月';

    el.innerHTML =
      '<div class="ops-cal-head">' +
        '<button class="ops-cal-nav" id="ops-prev" aria-label="前の週">' + UI.icon('chevronL') + '</button>' +
        '<div class="ops-cal-title">' + title + '</div>' +
        '<button class="ops-cal-nav" id="ops-next" aria-label="次の週">' + UI.icon('chevronR') + '</button>' +
      '</div>' +
      weekStrip() +
      '<div class="ops-filters" style="margin-bottom:14px">' +
        '<button class="ops-chip' + (state.view === 'day' ? ' active' : '') + '" data-v="day">日</button>' +
        '<button class="ops-chip' + (state.view === 'week' ? ' active' : '') + '" data-v="week">週</button>' +
        '<button class="ops-chip" id="ops-today">今日</button>' +
      '</div>' +
      '<div id="ops-cal-body"></div>';

    document.getElementById('ops-prev').addEventListener('click', function () { state.weekStart = addDays(state.weekStart, -7); render(); prefetchWeek(); });
    document.getElementById('ops-next').addEventListener('click', function () { state.weekStart = addDays(state.weekStart, 7); render(); prefetchWeek(); });
    document.getElementById('ops-today').addEventListener('click', function () { state.selected = U.todayStr(); state.weekStart = sundayOf(state.selected); render(); prefetchWeek(); });
    el.querySelectorAll('[data-v]').forEach(function (c) { c.addEventListener('click', function () { state.view = c.getAttribute('data-v'); render(); }); });
    el.querySelectorAll('[data-day]').forEach(function (c) { c.addEventListener('click', function () { state.selected = c.getAttribute('data-day'); state.view = 'day'; render(); loadAvail(state.selected).then(renderBody); }); });

    renderBody();
  }

  function weekStrip() {
    var today = U.todayStr();
    var cells = weekDates().map(function (d, i) {
      var dt = parse(d);
      var cnt = bookingsOf(d).length;
      return '<div class="day' + (d === state.selected ? ' selected' : '') + (d === today ? ' today' : '') + '" data-day="' + d + '">' +
        '<span>' + dt.getDate() + '</span>' + (cnt ? '<span class="dot"></span>' : '') +
      '</div>';
    }).join('');
    return '<div class="ops-week">' + WD.map(function (w) { return '<div class="wd">' + w + '</div>'; }).join('') + cells + '</div>';
  }

  function bandRow(date, b) {
    var st = bandState(date, b.key);
    return '<div class="ops-band">' +
      '<div><div class="ops-band-name">' + b.label + '</div><div class="ops-band-time">' + b.time + '</div></div>' +
      '<div style="flex:1"></div>' +
      '<span class="ops-band-state ' + st + '">' + STATE_LABEL[st] + '</span>' +
    '</div>';
  }

  function blockRow(b) {
    return '<a class="ops-row tap" href="bookings.html?ref=' + encodeURIComponent(b.ref) + '">' +
      '<div class="ops-avatar">' + U.initials(b.name) + '</div>' +
      '<div class="ops-row-main">' +
        '<div class="ops-row-title">' + U.esc(b.name) + '様</div>' +
        '<div class="ops-row-sub">' + U.esc(b.service || 'ご予約') + (b.time ? ' · ' + U.esc(b.time) : '') + '</div>' +
      '</div>' +
      '<div class="ops-row-end">' + UI.statusBadge(b.status) + '</div>' +
    '</a>';
  }

  function renderBody() {
    var host = document.getElementById('ops-cal-body');
    if (!host) return;
    if (state.view === 'week') { host.innerHTML = renderWeekView(); bindBlocks(host); return; }

    var date = state.selected;
    var blocks = bookingsOf(date);
    host.innerHTML =
      '<div class="ops-card" style="text-align:center;padding:12px"><strong style="font-size:1.02rem">' + U.fmtDateFull(date) + '</strong></div>' +
      '<div class="ops-section-title" style="margin-top:6px">時間帯の空き状況</div>' +
      BANDS.map(function (b) { return bandRow(date, b); }).join('') +
      '<div class="ops-section-title">予約ブロック（' + blocks.length + '件）</div>' +
      (blocks.length ? blocks.map(blockRow).join('') : UI.empty('予約はありません', 'この日の予約ブロックはまだありません', 'calendar'));
    bindBlocks(host);
  }

  function renderWeekView() {
    return weekDates().map(function (d) {
      var dt = parse(d);
      var blocks = bookingsOf(d);
      var chips = BANDS.map(function (b) {
        var st = bandState(d, b.key);
        return '<span class="ops-band-state ' + st + '" style="font-size:.66rem;padding:2px 7px">' + b.label + '</span>';
      }).join(' ');
      return '<div class="ops-card tap" data-day="' + d + '" style="padding:13px 14px;margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
          '<strong>' + (dt.getMonth() + 1) + '/' + dt.getDate() + '（' + WD[dt.getDay()] + '）</strong>' +
          '<span class="ops-muted" style="font-size:.8rem">予約 ' + blocks.length + '件</span>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:5px">' + chips + '</div>' +
      '</div>';
    }).join('');
  }

  function bindBlocks(host) {
    host.querySelectorAll('[data-day]').forEach(function (c) {
      c.addEventListener('click', function () { state.selected = c.getAttribute('data-day'); state.view = 'day'; render(); loadAvail(state.selected).then(renderBody); });
    });
  }

  function prefetchWeek() {
    weekDates().forEach(function (d) { loadAvail(d).then(function () { if (document.getElementById('ops-cal-body')) renderBody(); }); });
  }

  function load() {
    var el = document.getElementById('ops-content');
    el.innerHTML = UI.skeleton(5);
    Api.listBookings().then(function (r) {
      var byDate = {};
      (r.data || []).forEach(function (b) {
        if (b.status === 'キャンセル' || !b.date) return;
        (byDate[b.date] = byDate[b.date] || []).push(b);
      });
      state.bookings = r.data || [];
      state.byDate = byDate;
      state.weekStart = sundayOf(state.selected);
      render();
      loadAvail(state.selected).then(renderBody);
      prefetchWeek();
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: 'calendar', title: 'カレンダー' });
    load();
  });
})();
