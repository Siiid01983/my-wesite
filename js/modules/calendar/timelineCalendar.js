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

  var state = {
    view: 'week',           // 'day' | 'week' | 'month'
    anchor: null,           // Date (any day within the shown range)
    snap: 30,               // minutes: 15 | 30 | 60
    windows: {},            // date → [{id,start_at,end_at}]
    cfg: { day_start: '07:00', day_end: '22:00', step: 30, durations: [30,60,90,120,180], default_duration: 120 },
    pxPerMin: 0.8,          // vertical scale (48px / hour)
    built: false
  };

  /* ── env helpers (mirror slotCalendar.js) ── */
  function _base()   { return (window.API_BASE || '').replace(/\/+$/, ''); }
  function _toast(m) { if (typeof window.toast === 'function') window.toast(m); else console.log('[Timeline]', m); }
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
  function _enabled() { try { return localStorage.getItem('hm_timeline_ui') === '1'; } catch (_) { return false; } }

  /* ── pure date/time helpers (exposed for unit tests) ── */
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate()+n); return x; }
  function today() { if (typeof window.todayStr === 'function') { var t = window.todayStr(); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; } return ymd(new Date()); }
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
      '.tl-empty{padding:26px;text-align:center;font-size:13px;opacity:.6}',
      '.tl-hint{font-size:12px;opacity:.6;margin:8px 2px 0}',
      '@media(max-width:640px){.tl-title{font-size:15px;min-width:0}.tl-seg button{padding:6px 9px}.tl-colhead .d{font-size:14px}}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ── mount into #view-calendar (idempotent) ── */
  function mount() {
    if (!_enabled()) return false;
    var view = document.getElementById('view-calendar');
    if (!view) return false;
    if (document.getElementById('hmTl')) return true;
    _injectStyles();

    // Hide the legacy band/slot screens while the timeline preview is on.
    ['#slotAvailScreen', '.cal-wrap'].forEach(function (sel) {
      var el = view.querySelector(sel); if (el) el.style.display = 'none';
    });

    try { state.snap = parseInt(localStorage.getItem('hm_timeline_snap') || '30', 10) || 30; } catch (_) {}

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

    state.built = true;
    return true;
  }

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
        state.windows = {};
        if (out && out.ok && Array.isArray(out.windows)) {
          out.windows.forEach(function (w) {
            var d = (w.window_date || String(w.start_at).slice(0, 10));
            (state.windows[d] = state.windows[d] || []).push(w);
          });
        }
        render();
      })
      .catch(function () { state.windows = {}; render(); });
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
      var now = isT ? _nowLine() : '';
      var dd = parse(ds), dowCls = dd.getDay() === 0 ? 'dow-sun' : dd.getDay() === 6 ? 'dow-sat' : '';
      var head = '<div class="tl-colhead"><span class="' + dowCls + '">' + DOW[dd.getDay()] + '</span> <span class="d">' + dd.getDate() + '</span></div>';
      return '<div class="tl-col' + (isT ? ' tl-today' : '') + '" data-date="' + ds + '" style="height:' + (h + 40) + 'px">' +
               head + '<div class="tl-canvas" data-date="' + ds + '" style="position:absolute;left:0;right:0;top:40px;height:' + h + 'px">' +
               lines + wins + now + '</div></div>';
    }).join('');

    var colW = state.view === 'day' ? '1fr' : 'repeat(7,1fr)';
    body.innerHTML = '<div class="tl-scroll" id="tlScroll"><div class="tl-grid" style="grid-template-columns:56px ' + colW + '">' +
                     '<div style="position:relative;padding-top:40px">' + axis + '</div>' + cols + '</div></div>';

    // Scroll to ~1h before the first window (or day start).
    var scroll = document.getElementById('tlScroll');
    var firstMin = _firstWindowMin(dates); if (firstMin != null) scroll.scrollTop = Math.max(0, minToY(firstMin - 60) - 8);

    _bindTimeInteractions(scroll);
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
          if (ev.target.closest('.tl-win')) return;   // not on an existing block
          _createDrag(ev, canvas, ds, scroll);
        }
      });

      // MOVE / RESIZE / DELETE on existing blocks.
      canvas.querySelectorAll('.tl-win').forEach(function (win) {
        win.querySelector('.tl-del').addEventListener('click', function (e) { e.stopPropagation(); _delete(win.getAttribute('data-id')); });
        win.querySelector('.tl-h.top').addEventListener('pointerdown', function (e) { e.stopPropagation(); _resizeDrag(e, win, ds, 'top', scroll); });
        win.querySelector('.tl-h.bot').addEventListener('pointerdown', function (e) { e.stopPropagation(); _resizeDrag(e, win, ds, 'bot', scroll); });
        win.addEventListener('pointerdown', function (e) {
          if (e.target.closest('.tl-h') || e.target.closest('.tl-del')) return;
          _moveDrag(e, win, ds, scroll);
        });
      });
    });
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
    TimelineGestures.pointerDrag(ev, {
      threshold: 3,
      autoScroll: { el: scroll, edge: 52, maxSpeed: 16 },
      onMove: function (info) {
        var y = _canvasY(win.parentNode, info.clientY);
        var na = snapMin(yToMin(y - (startCanvasY - minToY(a0))));
        na = Math.max(dayStartMin(), Math.min(dayEndMin() - dur, na));
        win.style.top = minToY(na) + 'px';
        win.querySelector('.tl-t').textContent = minToHm(na) + '–' + minToHm(na + dur);
        win._na = na;
      },
      onEnd: function () {
        win.classList.remove('dragging');
        var na = win._na != null ? win._na : a0;
        if (na === a0) return;
        _update(win.getAttribute('data-id'), ds, na, na + dur);
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
      var bars = wins.slice(0, 3).map(function () { return '<div class="bar"></div>'; }).join('');
      var sum = totalMin > 0 ? '<span class="sum">' + (Math.round(totalMin/60*10)/10) + 'h 空き</span>' : '';
      return '<div class="tl-mcell' + (inMonth ? '' : ' dim') + (ds === tdy ? ' tl-today' : '') + '" data-date="' + ds + '">' +
               '<span class="n">' + d.getDate() + '</span>' + bars + sum + '</div>';
    }).join('');
    body.innerHTML = dows + '<div class="tl-month">' + cells + '</div>';
    body.querySelectorAll('.tl-mcell').forEach(function (c) {
      c.onclick = function () { state.anchor = parse(c.getAttribute('data-date')); state.view = 'day'; render(); };
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
    setAnchor: function (s) { state.anchor = parse(s); }, rangeOf: rangeOf
  };

  return { onShow: onShow, mount: mount, reload: load, enabled: _enabled, _debug: _debug };
})();
