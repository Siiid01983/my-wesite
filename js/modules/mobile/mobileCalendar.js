'use strict';

/* ════════════════════════════════════════════════════════
   MOBILE CALENDAR — daily timeline + date-picker (Phase 27F)

   Mobile-only enhancement of the Calendar view. On phones the
   month availability grid (.cal-wrap) + Google-Calendar panel are
   hidden by CSS (mobile.css) and this daily timeline is shown
   instead — a Curama-style day agenda with a tap-to-switch
   date-picker modal. Desktop / tablet are completely untouched:
   the month grid and its ○→△→× availability editor stay as-is.

   Injects (once, into the live DOM — no admin.html markup needed):
     #mobileCalTimeline  — prepended into #view-calendar
     #mobileCalModal     — date-picker modal (appended to <body>)

   Re-renders on every go('calendar') via a thin go() wrapper.
   Reads bookings through Adapter and availability through
   CalendarService — same sources the desktop grid uses.
   ════════════════════════════════════════════════════════ */

window.MobileCal = (function () {

  var _sel    = null;          // selected day  'YYYY-MM-DD'
  var _picker = new Date();    // month currently shown in the picker modal
  var _wired  = false;

  /* ── Data helpers ──────────────────────────────────────── */
  function _bookings(ds) {
    if (!window.Adapter) return [];
    return Adapter.getBookings()
      .filter(function (b) { return b.date === ds && b.status !== 'キャンセル'; })
      .sort(function (a, b) { return String(a.time || '99').localeCompare(String(b.time || '99')); });
  }
  function _countByDate() {
    var m = {};
    if (!window.Adapter) return m;
    Adapter.getBookings().forEach(function (b) {
      if (b.date && b.status !== 'キャンセル') m[b.date] = (m[b.date] || 0) + 1;
    });
    return m;
  }
  function _availOf(ds) {
    try { return (CalendarService.getAvailability() || {})[ds] || 'available'; }
    catch (e) { return 'available'; }
  }
  function _shiftDay(ds, delta) {
    var d = new Date(ds + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ── Timeline injection ────────────────────────────────── */
  function _injectTimeline() {
    if (document.getElementById('mobileCalTimeline')) return;
    var view = document.getElementById('view-calendar');
    if (!view) return;
    var el = document.createElement('section');
    el.id = 'mobileCalTimeline';
    el.setAttribute('aria-label', '日別タイムライン');
    view.insertBefore(el, view.firstChild);
  }

  function _injectModal() {
    if (document.getElementById('mobileCalModal')) return;
    var m = document.createElement('div');
    m.id = 'mobileCalModal';
    m.addEventListener('click', function (e) { if (e.target === m) closePicker(); });
    document.body.appendChild(m);
  }

  /* ── Timeline render ───────────────────────────────────── */
  function render(ds) {
    _injectTimeline();
    _injectModal();
    var root = document.getElementById('mobileCalTimeline');
    if (!root) return;

    if (ds) _sel = ds;
    if (!_sel) _sel = todayStr();

    var d       = new Date(_sel + 'T00:00:00');
    var dow     = d.getDay();
    var dowCol  = dow === 0 ? '#ef4444' : dow === 6 ? '#2563eb' : 'var(--ink)';
    var label   = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    var st      = _availOf(_sel);
    var stTxt   = st === 'available' ? '○ 空き' : st === 'limited' ? '△ 残りわずか' : '× 満了';
    var stCls   = st === 'available' ? 'mct-st-a' : st === 'limited' ? 'mct-st-l' : 'mct-st-b';
    var list    = _bookings(_sel);
    var isToday = _sel === todayStr();

    var head =
      '<div class="mct-head">' +
        '<button class="mct-nav" aria-label="前日" onclick="MobileCal.step(-1)">' +
          '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>' +
        '<button class="mct-date" onclick="MobileCal.openPicker()">' +
          '<span class="mct-date-main" style="color:' + dowCol + '">' + label + '（' + DN[dow] + '）</span>' +
          '<span class="mct-date-cap">タップで日付を選択 ▾</span>' +
        '</button>' +
        '<button class="mct-nav" aria-label="翌日" onclick="MobileCal.step(1)">' +
          '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>' +
      '</div>' +
      '<div class="mct-sub">' +
        '<span class="mct-status ' + stCls + '">' + stTxt + '</span>' +
        '<span class="mct-count">予約 ' + list.length + '件</span>' +
        (isToday ? '' : '<button class="mct-today" onclick="MobileCal.goToday()">今日へ</button>') +
      '</div>';

    var body;
    if (!list.length) {
      body =
        '<div class="mct-empty">' +
          '<svg viewBox="0 0 24 24" width="34" height="34"><path fill="currentColor" d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H5V8h14v13z"/></svg>' +
          '<p>この日の予約はありません</p>' +
          '<button class="mqb-chip primary" onclick="if(window.openAdd)openAdd()">' +
            '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>予約を追加</button>' +
        '</div>';
    } else {
      body = '<div class="mct-list">' + list.map(function (b) {
        var t = (b.time && String(b.time).trim()) ? esc(b.time) : '時刻未定';
        return '<button class="mct-item" onclick="if(window.openDetail)openDetail(\'' + esc(b.id) + '\')">' +
            '<span class="mct-time">' + t + '</span>' +
            '<span class="mct-rail"><span class="mct-dot"></span></span>' +
            '<span class="mct-card">' +
              '<span class="mct-name">' + esc(b.name || 'お客様') + '</span>' +
              '<span class="mct-svc">' + esc(b.service || 'サービス未設定') + '</span>' +
              '<span class="mct-badges">' + badge(b.status || '新規') +
                (b.phone ? '<span class="mct-phone">' + esc(b.phone) + '</span>' : '') +
              '</span>' +
            '</span>' +
          '</button>';
      }).join('') + '</div>';
    }

    root.innerHTML = head + body;
  }

  /* ── Date-picker modal ─────────────────────────────────── */
  function openPicker() {
    _injectModal();
    _picker = new Date((_sel || todayStr()) + 'T00:00:00');
    _picker.setDate(1);
    _renderPicker();
    document.getElementById('mobileCalModal').classList.add('open');
  }
  function closePicker() {
    var m = document.getElementById('mobileCalModal');
    if (m) m.classList.remove('open');
  }
  function pickerMove(dir) { _picker.setMonth(_picker.getMonth() + dir); _renderPicker(); }

  function _renderPicker() {
    var m = document.getElementById('mobileCalModal');
    if (!m) return;
    var y = _picker.getFullYear(), mo = _picker.getMonth();
    var first = new Date(y, mo, 1).getDay();
    var total = new Date(y, mo + 1, 0).getDate();
    var counts = _countByDate();
    var today = todayStr();

    var cells = '';
    for (var i = 0; i < first; i++) cells += '<span class="mcm-day mcm-empty"></span>';
    for (var day = 1; day <= total; day++) {
      var dsc = y + '-' + pad(mo + 1) + '-' + pad(day);
      var dw  = new Date(y, mo, day).getDay();
      var cls = 'mcm-day';
      if (dsc === _sel)  cls += ' sel';
      if (dsc === today) cls += ' today';
      if (dw === 0) cls += ' sun';
      if (dw === 6) cls += ' sat';
      var n = counts[dsc] || 0;
      cells += '<button class="' + cls + '" onclick="MobileCal.pick(\'' + dsc + '\')">' +
          '<span class="mcm-n">' + day + '</span>' +
          (n ? '<span class="mcm-cnt">' + (n > 9 ? '9+' : n) + '</span>' : '<span class="mcm-cnt-sp"></span>') +
        '</button>';
    }

    m.innerHTML =
      '<div class="mcm-sheet" role="dialog" aria-label="日付を選択">' +
        '<div class="mcm-grip"></div>' +
        '<div class="mcm-head">' +
          '<button class="mct-nav" aria-label="前月" onclick="MobileCal.pickerMove(-1)">' +
            '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>' +
          '<span class="mcm-title">' + y + '年' + MN[mo] + '</span>' +
          '<button class="mct-nav" aria-label="翌月" onclick="MobileCal.pickerMove(1)">' +
            '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>' +
        '</div>' +
        '<div class="mcm-dows">' + DN.map(function (dn, i) {
          return '<span class="mcm-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + dn + '</span>';
        }).join('') + '</div>' +
        '<div class="mcm-grid">' + cells + '</div>' +
        '<div class="mcm-foot">' +
          '<button class="btn btn-ghost btn-sm" onclick="MobileCal.goToday()">今日</button>' +
          '<button class="btn btn-primary btn-sm" onclick="MobileCal.closePicker()">閉じる</button>' +
        '</div>' +
      '</div>';
  }

  /* ── Public actions ────────────────────────────────────── */
  function step(delta) { render(_shiftDay(_sel || todayStr(), delta)); }
  function goToday()    { _picker = new Date(); closePicker(); render(todayStr()); }
  function pick(ds)     { closePicker(); render(ds); }

  /* ── Wrap go() so the timeline refreshes on calendar open ── */
  function _wrapGo() {
    if (_wired) return;
    var prev = window.go;
    if (typeof prev !== 'function') return;
    window.go = function (view) {
      prev(view);
      if (view === 'calendar') render(_sel || todayStr());
    };
    _wired = true;
  }

  function init() {
    _injectTimeline();
    _injectModal();
    _wrapGo();
    /* Keep timeline live when availability/bookings change elsewhere */
    document.addEventListener('calendar:updated', function () {
      if (document.getElementById('view-calendar') &&
          document.getElementById('view-calendar').classList.contains('active')) render(_sel);
    });
  }

  return {
    init: init,
    render: render,
    step: step,
    goToday: goToday,
    pick: pick,
    openPicker: openPicker,
    closePicker: closePicker,
    pickerMove: pickerMove,
  };

})();
