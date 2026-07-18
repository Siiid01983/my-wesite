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

  /* ── Time-band model ────────────────────────────────────────
     The booking pipeline stores b.time as a BAND label (午前/午後/
     夕方/夜間/時間指定なし), not a clock time. We map each band onto
     its clock hours so the hourly 08:00–18:00 grid can place it.
     Anchored to its band's START hour; the DAY_START/DAY_END window and PPM
     below drive the absolute block layout. */

  /* Services for the quick-book sheet (matches the public 6-service lineup) */
  var SERVICES = [
    '当日・お急ぎ引越しプラン', '単身引越し', 'カップル・ご夫婦引越し',
    '学生・新生活引越し', '不用品回収・処分サービス', '家具組立・分解'
  ];

  /* Map any stored time value onto its hour bucket (08–18).
     Works for exact slots ("09:00〜10:00") AND public band labels
     ("午前（9:00〜12:00）" → 9, "午後…" → 12, "夕方…" → 15, "夜間…" → 18)
     by reading the FIRST hour number; blank/時間指定なし → 08 bucket. */
  function _slotHourOf(timeStr) {
    var m = String(timeStr || '').match(/(\d{1,2})\s*[:時]/);
    if (!m) return 8;
    var h = +m[1];
    if (h < 8)  return 8;
    if (h > 18) return 18;
    return h;
  }
  function _slotLabel(h) { return pad(h) + ':00〜' + pad(h + 1) + ':00'; }

  /* ── Interval model (dynamic block layout) ──────────────────
     Resolve each booking to a [startMin,endMin] window on the day axis, then
     render absolute-positioned blocks (top = start·PPM, height = duration·PPM)
     instead of fixed hour rows. Prefers real start_at/end_at timestamps once the
     backend provides them; falls back to the band window so this works today. */
  var DAY_START = 8, DAY_END = 19, PPM = 1.2;   // 08:00–19:00 window · px per minute

  function _intervalOf(b) {
    if (b.start_at && b.end_at) {
      var s = new Date(String(b.start_at).replace(' ', 'T'));
      var e = new Date(String(b.end_at).replace(' ', 'T'));
      if (!isNaN(s) && !isNaN(e) && e > s) {
        return { s: s.getHours() * 60 + s.getMinutes(), e: e.getHours() * 60 + e.getMinutes() };
      }
    }
    var h = _slotHourOf(b.time);                 // band fallback → [startH, +duration]
    return { s: h * 60, e: h * 60 + (/指定なし/.test(b.time || '') ? 60 : 180) }; // 3h band / 1h
  }

  /* Greedy lane assignment so concurrent bookings sit side-by-side. */
  function _assignLanes(items) {
    items.sort(function (a, b) { return a.s - b.s || a.e - b.e; });
    var ends = [];
    items.forEach(function (it) {
      var lane = -1;
      for (var i = 0; i < ends.length; i++) { if (ends[i] <= it.s) { lane = i; break; } }
      if (lane === -1) { lane = ends.length; ends.push(0); }
      ends[lane] = it.e;
      it.lane = lane;
    });
    return ends.length || 1;
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
        '<span class="mct-sub-actions">' +
          (isToday ? '' : '<button class="mct-today" onclick="MobileCal.goToday()">今日へ</button>') +
          '<button class="mct-month-toggle" onclick="MobileCal.toggleMonth()" aria-label="月間カレンダー表示切替">' +
            '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/></svg>月間表示' +
          '</button>' +
        '</span>' +
      '</div>';

    /* Full-day lock: when the day's capacity is exhausted (× 満了) the whole
       day is hard-blocked for the public calendar — surface that. */
    var dayLocked = st === 'booked';

    /* Resolve bookings → intervals, then assign lanes for overlaps. */
    var items = list.map(function (b) { var iv = _intervalOf(b); return { b: b, s: iv.s, e: iv.e, lane: 0 }; });
    var laneCount = _assignLanes(items);
    var winStart = DAY_START * 60, winEnd = DAY_END * 60;

    /* Background rail: hour gridlines + labels (does NOT contain bookings). */
    var rail = '';
    for (var gh = DAY_START; gh <= DAY_END; gh++) {
      rail += '<div class="mct-line" style="top:' + ((gh - DAY_START) * 60 * PPM) + 'px">' +
                '<span class="mct-hh">' + pad(gh) + ':00</span></div>';
    }

    /* Absolute blocks: top = (start − windowStart)·PPM, height = duration·PPM. */
    var blocks = items.map(function (it) {
      var s0 = Math.max(it.s, winStart), e0 = Math.min(it.e, winEnd);
      var top    = (s0 - winStart) * PPM;
      var height = Math.max((e0 - s0) * PPM, 22);            // min height for tappability
      var w = 100 / laneCount, left = it.lane * w;
      return '<div class="mct-block" style="top:' + top + 'px;height:' + height + 'px;' +
               'left:calc(' + left + '% + 46px);width:calc(' + w + '% - 50px)" role="listitem">' +
               _bookingCard(it.b) +
             '</div>';
    }).join('');

    var emptyHint = (!items.length && !dayLocked)
      ? '<div class="mct-empty">タップして予約枠を追加</div>' : '';

    var axisH = (DAY_END - DAY_START) * 60 * PPM;
    root.innerHTML = head +
      '<div class="mct-axis' + (dayLocked ? ' mct-axis-lock' : '') + '" ' +
           'style="height:' + axisH + 'px" onclick="MobileCal.axisTap(event)" ' +
           'role="list" aria-label="' + label + ' 時間別スケジュール">' +
        rail + blocks + emptyHint +
      '</div>';
  }

  /* Single booking block (used inside an hour track) — clearly
     separates お客様名 from 場所/詳細, and marks the slot LOCKED. */
  function _bookingCard(b) {
    var loc = '';
    if (b.fromAddr) {
      loc = esc(b.fromAddr) + (b.toAddr ? ' <span class="mct-arrow">→</span> ' + esc(b.toAddr) : '');
    }
    // Show the real HH:MM〜HH:MM once timestamps exist; else the band label.
    var timeLabel = (b.start_at && b.end_at)
      ? (String(b.start_at).slice(11, 16) + '〜' + String(b.end_at).slice(11, 16))
      : (b.time || '時間指定なし');
    return '<button class="mct-slot mct-slot-booked" onclick="if(window.openDetail)openDetail(\'' + esc(b.id) + '\')">' +
        '<span class="mct-lockrow">' +
          '<svg class="mct-lockicon" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z"/></svg>' +
          '<span class="mct-band">' + esc(timeLabel) + '</span>' +
          badge(b.status || '新規') +
        '</span>' +
        '<span class="mct-name">' + esc(b.name || 'お客様') + '</span>' +
        (loc ? '<span class="mct-loc"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z"/></svg>' + loc + '</span>' : '') +
        '<span class="mct-meta">' +
          '<span class="mct-svc">' + esc(b.service || 'サービス未設定') + '</span>' +
          (b.phone ? '<span class="mct-phone">' + esc(b.phone) + '</span>' : '') +
        '</span>' +
      '</button>';
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

  /* ── Book-this-slot sheet ──────────────────────────────── */
  function _injectBookModal() {
    if (document.getElementById('mobileCalBookModal')) return;
    var m = document.createElement('div');
    m.id = 'mobileCalBookModal';
    m.addEventListener('click', function (e) { if (e.target === m) closeBook(); });
    document.body.appendChild(m);
  }

  function bookSlot(h) {
    _injectBookModal();
    var m = document.getElementById('mobileCalBookModal');
    var d = new Date((_sel || todayStr()) + 'T00:00:00');
    var dow = d.getDay();
    var label = (d.getMonth() + 1) + '月' + d.getDate() + '日（' + DN[dow] + '）';
    var slot = _slotLabel(h);

    m.innerHTML =
      '<div class="mcb-sheet" role="dialog" aria-label="この枠を予約">' +
        '<div class="mcm-grip"></div>' +
        '<div class="mcb-head">' +
          '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z"/></svg>' +
          '<span>この枠を予約</span>' +
        '</div>' +
        '<div class="mcb-slotline">' +
          '<span class="mcb-date">' + label + '</span>' +
          '<span class="mcb-time">' + slot + '</span>' +
        '</div>' +
        '<label class="mcb-field"><span>お客様名 <em>必須</em></span>' +
          '<input id="mcbName" type="text" inputmode="text" placeholder="山田 太郎" autocomplete="off"></label>' +
        '<label class="mcb-field"><span>電話番号</span>' +
          '<input id="mcbPhone" type="tel" inputmode="tel" placeholder="090-0000-0000" autocomplete="off"></label>' +
        '<label class="mcb-field"><span>サービス</span>' +
          '<select id="mcbService">' + SERVICES.map(function (s) {
            return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
          }).join('') + '</select></label>' +
        '<input type="hidden" id="mcbSlot" value="' + esc(slot) + '">' +
        '<div class="mcb-foot">' +
          '<button class="btn btn-ghost" onclick="MobileCal.closeBook()">キャンセル</button>' +
          '<button class="btn btn-primary mcb-confirm" onclick="MobileCal.confirmBook()">' +
            '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z"/></svg>' +
            'この枠を予約する</button>' +
        '</div>' +
      '</div>';
    m.classList.add('open');
    setTimeout(function () { var n = document.getElementById('mcbName'); if (n) n.focus(); }, 60);
  }

  function closeBook() {
    var m = document.getElementById('mobileCalBookModal');
    if (m) m.classList.remove('open');
  }

  function confirmBook() {
    var name = (document.getElementById('mcbName') || {}).value || '';
    if (!name.trim()) {
      var n = document.getElementById('mcbName');
      if (n) { n.classList.add('mcb-err'); n.focus(); }
      if (typeof toast === 'function') toast('お客様名を入力してください');
      return;
    }
    if (typeof window.quickBookSlot !== 'function') {
      if (typeof toast === 'function') toast('予約機能を初期化中です。再度お試しください');
      return;
    }
    // Booking is finalized ONLY here, on the explicit Confirm press — selection
    // (date/slot) is held in local state (_sel + the modal) until this point.
    var created = window.quickBookSlot({
      date:    _sel,
      time:    (document.getElementById('mcbSlot') || {}).value || '',
      name:    name,
      phone:   (document.getElementById('mcbPhone') || {}).value || '',
      service: (document.getElementById('mcbService') || {}).value || '単身引越し'
    });
    closeBook();
    if (created) render(_sel);   // reflect the slot ONLY once the booking is committed
  }

  /* ── Month-grid toggle (reveal the ○△× availability editor) ── */
  function toggleMonth() {
    var v = document.getElementById('view-calendar');
    if (v) v.classList.toggle('mc-show-month');
  }

  /* Tap empty axis space → quick-book at the tapped hour. Ignores taps that
     land on a booking block (their own handler opens the detail). */
  function axisTap(e) {
    if (e.target && e.target.closest && e.target.closest('.mct-block')) return;
    if (_availOf(_sel) === 'booked') return;                 // day locked (満了)
    var rect = e.currentTarget.getBoundingClientRect();
    var minute = (e.clientY - rect.top) / PPM + DAY_START * 60;
    var h = Math.floor(Math.max(DAY_START * 60, Math.min(minute, (DAY_END - 1) * 60)) / 60);
    bookSlot(h);
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
    _injectBookModal();
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
    bookSlot: bookSlot,
    closeBook: closeBook,
    confirmBook: confirmBook,
    toggleMonth: toggleMonth,
    axisTap: axisTap,
  };

})();
