'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   slotCalendar.js — unified 「空き枠管理」 admin screen (slot-based availability)

   Phase 2 of the slot-only redesign. Replaces the day-level ○△× "Calendar Block"
   as the MANAGEMENT surface with a slot-aware month grid whose single source of
   truth is `slot_capacity` (read via slot-capacity.php?action=month-status).

   One screen inside #view-calendar:
     • month grid on top — each day shows the 4 bands (午前/午後/夕方/夜間) coloured
       by state (open/limited/full/closed) + a read-only ○△× day roll-up glyph
     • clicking a day drives the EXISTING per-band editor (window.SlotCapacity —
       open/close, capacity ±, whole-day close/reopen, multi-day range), relocated
       directly below the grid so there is ONE workflow (no separate 容量設定 screen)
     • 複数日選択 (bulk) — select several days and 全日休止/全日再開 them at once

   Non-invasive, mirrors slotCapacity.js / intervalEditor.js:
     • self-injects its <style> once; builds its DOM into #view-calendar at runtime
       (no admin.html markup rewrite beyond the <script> include + nav relabel)
     • writes ONLY through slot-capacity.php (single source of truth); the booking
       engine, availability.php and create-booking.php are untouched
     • feature flag `hm_admin_slot_ui` (localStorage) — DEFAULT ON; set to '0' to
       fall back to the legacy ○△× grid during staged rollout

   Globals used: API_BASE, API_KEY, __HM_ADMIN_TOKEN, SlotCapacity, (opt) toast,
   loadCapacity, todayStr.
   ════════════════════════════════════════════════════════════════════════════ */

window.SlotCalendar = (function () {

  var BANDS = [
    { id: 'am', label: '午前', time: '9–12' },
    { id: 'pm', label: '午後', time: '12–15' },
    { id: 'ev', label: '夕方', time: '15–18' },
    { id: 'nt', label: '夜間', time: '18–21' }
  ];
  var DOW = ['日', '月', '火', '水', '木', '金', '土'];
  var MN = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  var state = { view: null, selected: null, days: {}, bulk: false, sel: {} };
  var _built = false;

  /* ── env helpers (mirror slotCapacity.js) ── */
  function _base()   { return (window.API_BASE || '').replace(/\/+$/, ''); }
  function _toast(m) { if (typeof window.toast === 'function') window.toast(m); else console.log('[SlotCalendar]', m); }
  function _headers() {
    var h = { 'X-API-KEY': window.API_KEY || '' };
    if (window.__HM_ADMIN_TOKEN) h['X-ADMIN-TOKEN'] = window.__HM_ADMIN_TOKEN;
    return h;
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _enabled() {
    try { var v = localStorage.getItem('hm_admin_slot_ui'); return v === null ? true : (v !== '0' && v !== 'false'); }
    catch (_) { return true; }
  }

  /* ── date helpers ── */
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function today() { if (typeof window.todayStr === 'function') { var t = window.todayStr(); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; } return ymd(new Date()); }

  // 42-cell (6-week) grid window for the current month → [start,end] dates.
  function gridRange() {
    var m = state.view; var first = new Date(m.getFullYear(), m.getMonth(), 1);
    var start = addDays(first, -first.getDay());
    return { start: start, end: addDays(start, 41) };
  }

  /* ── one-time scoped styles ── */
  function _injectStyles() {
    if (document.getElementById('hmSlotCalStyle')) return;
    var s = document.createElement('style');
    s.id = 'hmSlotCalStyle';
    s.textContent =
      '#slotAvailScreen{margin-bottom:14px}' +
      '.slotcal-hdr{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}' +
      '.slotcal-hdr .m{font-size:16px;font-weight:800;color:var(--ink,#0b0f17);min-width:120px}' +
      '.slotcal-nav{width:32px;height:32px;border:1px solid var(--line,#e5e7eb);border-radius:8px;background:#fff;cursor:pointer;font-size:15px;color:var(--ink,#0b0f17)}' +
      '.slotcal-nav:hover{background:#f2f6ec}' +
      '.slotcal-sp{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}' +
      '.slotcal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px}' +
      '.slotcal-dow>div{text-align:center;font-size:11px;font-weight:700;color:#6b7280}' +
      '.slotcal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}' +
      '.slotcal-cell{border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:6px 6px 7px;min-height:74px;cursor:pointer;background:#fff;display:flex;flex-direction:column;gap:5px;transition:border-color .12s,box-shadow .12s}' +
      '.slotcal-cell:hover{border-color:#9AB57A}' +
      '.slotcal-cell.dim{opacity:.4}' +
      '.slotcal-cell.today{border-color:#2563eb}' +
      '.slotcal-cell.sel{box-shadow:0 0 0 2px #2C3626;border-color:#2C3626}' +
      '.slotcal-cell.picked{box-shadow:0 0 0 2px #2563eb;border-color:#2563eb;background:#eff6ff}' +
      '.slotcal-top{display:flex;align-items:center;justify-content:space-between}' +
      '.slotcal-d{font-size:13px;font-weight:700;color:var(--ink,#0b0f17)}' +
      '.slotcal-roll{font-size:13px;font-weight:800;line-height:1}' +
      '.roll-a{color:#059669}.roll-l{color:#b45309}.roll-b{color:#b91c1c}' +
      '.slotcal-bands{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-top:auto}' +
      '.slotcal-bd{height:16px;border-radius:4px;font-size:9px;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:center;letter-spacing:.02em}' +
      '.bd-available{background:#10b981}.bd-limited{background:#f59e0b}.bd-full{background:#ef4444}.bd-closed{background:#9ca3af}' +
      '.slotcal-legend{display:flex;gap:14px;flex-wrap:wrap;margin:12px 2px 4px;font-size:11px;color:#6b7280;align-items:center}' +
      '.slotcal-legend b{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:4px;vertical-align:-1px}' +
      '.slotcal-bulkbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:8px 12px;margin:10px 0}' +
      '.slotcal-editor-note{font-size:12px;color:#6b7280;margin:14px 2px 8px;font-weight:600}' +
      '@media(max-width:640px){.slotcal-cell{min-height:64px;padding:5px 4px}.slotcal-bd{font-size:8px}}';
    document.head.appendChild(s);
  }

  /* ── build the screen into #view-calendar (idempotent) ── */
  function mount() {
    if (!_enabled()) return false;                       // flag off → legacy ○△× grid stays
    var view = document.getElementById('view-calendar');
    if (!view) return false;
    if (document.getElementById('slotAvailScreen')) return true;
    _injectStyles();

    // Ensure the existing per-band editor exists, then relocate its panel here so
    // the whole workflow is on ONE screen (no separate 容量設定 nav).
    if (window.SlotCapacity && SlotCapacity.mount) { try { SlotCapacity.mount(); } catch (_) {} }

    var screen = document.createElement('div');
    screen.id = 'slotAvailScreen';
    screen.innerHTML =
      '<div class="slotcal-hdr">' +
        '<button class="slotcal-nav" id="slotcalPrev" type="button" title="前の月">&#8592;</button>' +
        '<span class="m" id="slotcalMonth"></span>' +
        '<button class="slotcal-nav" id="slotcalNext" type="button" title="次の月">&#8594;</button>' +
        '<div class="slotcal-sp">' +
          '<button class="btn btn-ghost btn-sm" id="slotcalToday" type="button">今日</button>' +
          '<button class="btn btn-ghost btn-sm" id="slotcalBulk" type="button">複数日選択</button>' +
          '<button class="btn btn-ghost btn-sm" id="slotcalReload" type="button">更新</button>' +
        '</div>' +
      '</div>' +
      '<div id="slotcalBulkBar" class="slotcal-bulkbar" style="display:none"></div>' +
      '<div class="slotcal-dow">' + DOW.map(function (d, i) { return '<div style="' + (i === 0 ? 'color:#ef4444' : i === 6 ? 'color:#2563eb' : '') + '">' + d + '</div>'; }).join('') + '</div>' +
      '<div class="slotcal-grid" id="slotcalGrid"></div>' +
      '<div class="slotcal-legend">' +
        '<span><b class="bd-available"></b>受付中</span>' +
        '<span><b class="bd-limited"></b>残りわずか</span>' +
        '<span><b class="bd-full"></b>満枠</span>' +
        '<span><b class="bd-closed"></b>休止</span>' +
        '<span style="margin-left:auto">○ 全枠受付 · △ 一部制限 · × 全枠休止/満枠</span>' +
      '</div>' +
      '<div class="slotcal-editor-note">選択した日の時間帯を編集：</div>' +
      '<div id="slotcalEditorHost"></div>';

    view.insertBefore(screen, view.firstChild);

    // Hide the legacy ○△× grid (kept in the DOM as the flag-off fallback).
    var legacy = view.querySelector('.cal-wrap');
    if (legacy) legacy.style.display = 'none';

    // Merge 容量設定 into this screen: hide its now-redundant nav entry (go('capacity')
    // is aliased to 'calendar' in navigation.js). Kept in the DOM so the flag-off
    // fallback still exposes it.
    var capNav = document.querySelector('.sb-link[data-view="capacity"]');
    if (capNav) capNav.style.display = 'none';

    // Relocate the per-band editor + {max,limited} thresholds (D3: kept) into this
    // screen so there is a single availability workflow. The nodes keep their IDs,
    // so SlotCapacity.reload() and saveCapacity() keep working after the move.
    var sg = document.querySelector('#view-capacity .settings-grid');
    if (sg) document.getElementById('slotcalEditorHost').appendChild(sg);
    if (typeof window.loadCapacity === 'function') { try { window.loadCapacity(); } catch (_) {} }

    // Wire controls.
    document.getElementById('slotcalPrev').onclick   = function () { state.view.setMonth(state.view.getMonth() - 1); loadMonth(); };
    document.getElementById('slotcalNext').onclick   = function () { state.view.setMonth(state.view.getMonth() + 1); loadMonth(); };
    document.getElementById('slotcalToday').onclick  = function () { state.view = parse(today()); state.view.setDate(1); selectDay(today()); loadMonth(); };
    document.getElementById('slotcalReload').onclick = function () { loadMonth(); };
    document.getElementById('slotcalBulk').onclick   = function () { _toggleBulk(); };

    _built = true;
    return true;
  }

  /* ── month title ── */
  function _renderHeader() {
    var el = document.getElementById('slotcalMonth');
    if (el) el.textContent = state.view.getFullYear() + '年' + MN[state.view.getMonth()];
  }

  /* ── day roll-up glyph (D2, read-only) from the 4 band states ── */
  function rollup(bands) {
    if (!bands) return { g: '○', c: 'roll-a' };
    var st = BANDS.map(function (b) { return (bands[b.id] || {}).status || 'available'; });
    var allClosed = st.every(function (s) { return s === 'closed'; });
    if (allClosed) return { g: '×', c: 'roll-b' };
    var allBlocked = st.every(function (s) { return s === 'closed' || s === 'full'; });
    if (allBlocked) return { g: '×', c: 'roll-b' };
    var anyLimited = st.some(function (s) { return s !== 'available'; });
    return anyLimited ? { g: '△', c: 'roll-l' } : { g: '○', c: 'roll-a' };
  }

  /* ── load month-status for the visible 6-week window ── */
  function loadMonth() {
    _renderHeader();
    var r = gridRange();
    var from = ymd(r.start), to = ymd(r.end);
    var grid = document.getElementById('slotcalGrid');
    if (grid && !Object.keys(state.days).length) grid.innerHTML = '<div style="grid-column:1/-1;color:#6b7280;font-size:13px;padding:16px 0">読み込み中…</div>';
    fetch(_base() + '/slot-capacity.php?action=month-status&from=' + from + '&to=' + to, { headers: _headers() })
      .then(function (res) { return res.json(); })
      .then(function (out) {
        state.days = (out && out.ok && out.days && typeof out.days === 'object') ? out.days : {};
        renderGrid();
      })
      .catch(function () { state.days = {}; renderGrid(); });
  }

  function renderGrid() {
    var grid = document.getElementById('slotcalGrid');
    if (!grid) return;
    var r = gridRange(), mon = state.view.getMonth(), tdy = today();
    var html = '';
    for (var i = 0; i < 42; i++) {
      var d = addDays(r.start, i), ds = ymd(d), inMonth = d.getMonth() === mon;
      var bands = state.days[ds];
      var ru = rollup(bands);
      var strip = BANDS.map(function (b) {
        var s = (bands && bands[b.id]) || { status: 'available' };
        return '<div class="slotcal-bd bd-' + s.status + '" title="' + b.label + ' ' + b.time + '：' + _bandTitle(s) + '">' + b.label.charAt(0) + '</div>';
      }).join('');
      var cls = 'slotcal-cell' + (inMonth ? '' : ' dim') + (ds === tdy ? ' today' : '');
      if (state.bulk) { if (state.sel[ds]) cls += ' picked'; }
      else if (ds === state.selected) cls += ' sel';
      html += '<div class="' + cls + '" data-ds="' + ds + '">' +
        '<div class="slotcal-top"><span class="slotcal-d">' + d.getDate() + '</span><span class="slotcal-roll ' + ru.c + '">' + ru.g + '</span></div>' +
        '<div class="slotcal-bands">' + strip + '</div>' +
      '</div>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll('[data-ds]').forEach(function (cell) {
      cell.onclick = function () {
        var ds = cell.getAttribute('data-ds');
        if (state.bulk) { if (state.sel[ds]) delete state.sel[ds]; else state.sel[ds] = 1; renderGrid(); _renderBulkBar(); }
        else selectDay(ds);
      };
    });
  }
  function _bandTitle(s) {
    if (s.closed) return '休止' + (s.reason ? '（' + s.reason + '）' : '');
    if (s.status === 'full') return '満枠';
    var cap = (s.capacity != null ? s.capacity : 1), used = (s.used != null ? s.used : 0);
    return '受付中 ' + used + '/' + cap;
  }

  /* ── select a day → drive the existing per-band editor (SlotCapacity) ── */
  function selectDay(ds) {
    state.selected = ds;
    renderGrid();
    var dateEl = document.getElementById('hmScDate');
    if (dateEl) { dateEl.value = ds; }
    if (window.SlotCapacity && SlotCapacity.reload) SlotCapacity.reload();
    var host = document.getElementById('slotcalEditorHost');
    if (host && host.scrollIntoView) host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ── bulk (multi-day) select + whole-day close/reopen across the selection ── */
  function _toggleBulk() {
    state.bulk = !state.bulk;
    state.sel = {};
    var btn = document.getElementById('slotcalBulk');
    if (btn) btn.textContent = state.bulk ? '選択を終了' : '複数日選択';
    document.getElementById('slotcalBulkBar').style.display = state.bulk ? '' : 'none';
    renderGrid();
    _renderBulkBar();
  }
  function _renderBulkBar() {
    var el = document.getElementById('slotcalBulkBar');
    if (!el) return;
    var n = Object.keys(state.sel).length;
    el.innerHTML =
      '<span style="font-size:13px;font-weight:700;color:#2563eb">' + n + '日選択中</span>' +
      '<span style="color:#94a3b8">|</span>' +
      '<button class="btn btn-ghost btn-sm" id="slotcalBulkClose" type="button">選択日を全日休止</button>' +
      '<button class="btn btn-ghost btn-sm" id="slotcalBulkOpen" type="button">選択日を全日再開</button>' +
      '<button class="btn btn-ghost btn-sm" id="slotcalBulkClear" type="button" style="margin-left:auto">選択解除</button>';
    var close = document.getElementById('slotcalBulkClose');
    var open  = document.getElementById('slotcalBulkOpen');
    var clr   = document.getElementById('slotcalBulkClear');
    if (close) close.onclick = function () { _bulkApply(true); };
    if (open)  open.onclick  = function () { _bulkApply(false); };
    if (clr)   clr.onclick   = function () { state.sel = {}; renderGrid(); _renderBulkBar(); };
  }
  function _bulkApply(closing) {
    var dates = Object.keys(state.sel).sort();
    if (!dates.length) { _toast('日付を選択してください'); return; }
    var reason = '';
    if (closing) {
      reason = window.prompt(dates.length + '日を全時間帯 休止 にします。理由（任意・例: 祝日 / お盆）', '');
      if (reason === null) return;   // cancelled
    } else if (!window.confirm(dates.length + '日を全時間帯 再開 しますか？')) return;

    var base = _base();
    if (!base) { _toast('APIが未設定です'); return; }
    _toast('保存中…（' + dates.length + '日）');
    var chain = Promise.resolve(), okN = 0, failN = 0;
    dates.forEach(function (ds) {
      chain = chain.then(function () {
        var payload = closing ? { action: 'close-day', date: ds, reason: (reason || '').trim() } : { action: 'reopen-day', date: ds };
        return fetch(base + '/slot-capacity.php', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, _headers()), body: JSON.stringify(payload) })
          .then(function (r) { return r.json(); })
          .then(function (j) { if (j && j.ok) okN++; else failN++; })
          .catch(function () { failN++; });
      });
    });
    chain.then(function () {
      _toast(failN ? (okN + '日を更新（' + failN + '日は失敗）') : (okN + '日を更新しました'));
      state.sel = {}; state.bulk = false;
      var btn = document.getElementById('slotcalBulk'); if (btn) btn.textContent = '複数日選択';
      document.getElementById('slotcalBulkBar').style.display = 'none';
      loadMonth();
      if (state.selected && window.SlotCapacity && SlotCapacity.reload) SlotCapacity.reload();
    });
  }

  /* ── public entry: called from go('calendar') ── */
  function onShow() {
    if (!_enabled()) return false;             // legacy grid path handles rendering
    if (!state.view) { state.view = parse(today()); state.view.setDate(1); }
    if (!mount()) return false;
    if (!state.selected) state.selected = today();
    loadMonth();
    // Prime the editor on the selected day (first open).
    var dateEl = document.getElementById('hmScDate');
    if (dateEl && !dateEl.value) { dateEl.value = state.selected; if (window.SlotCapacity && SlotCapacity.reload) SlotCapacity.reload(); }
    return true;
  }

  // On load, hide the redundant 容量設定 nav immediately when the slot UI is on
  // (mount() also does this, but only on first visit — this prevents a brief flash).
  function _bootNav() {
    if (!_enabled()) return;
    var capNav = document.querySelector('.sb-link[data-view="capacity"]');
    if (capNav) capNav.style.display = 'none';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bootNav);
  else _bootNav();

  // Pure helpers exposed for unit smoke tests (no DOM/DB): rollup glyph mapping
  // (D2) and the 6-week grid window. Harmless in production.
  var _debug = {
    rollup: rollup,
    gridRange: function (viewDate) { var s = state.view; state.view = viewDate; var r = gridRange(); state.view = s; return { start: ymd(r.start), end: ymd(r.end) }; },
    ymd: ymd
  };

  return { onShow: onShow, mount: mount, reload: loadMonth, enabled: _enabled, _debug: _debug };
})();

