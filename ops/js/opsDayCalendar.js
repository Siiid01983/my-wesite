'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   opsDayCalendar.js — simplified Ops DAILY calendar with drag-to-select duration

   A deliberately minimal, single-day (24-hour) dispatcher calendar for the Ops
   app. The operator drags vertically over an empty area of the 00:00–24:00 grid
   to size a time range; on release a minimal editor opens for a free-text title,
   and Save persists the entry.

   ── Why a NEW component (not the shared timeline) ─────────────────────────────
   Admin + the OLD Ops calendar share js/modules/calendar/timelineCalendar.js
   (day/week/month, zoom, snap selector, 空き/ブロック/予約 modes). This screen is a
   product SIMPLIFICATION requested for Ops ONLY: daily view only, no week/month,
   no zoom, no 30-min selector, no status labels on empty cells. Simplifying the
   shared component would break Admin, so per the project Core Rule ("prefer new
   files over edits") this is a standalone Ops-only component. The shared timeline
   and its test are left untouched.

   ── Data / backend (UNCHANGED) ───────────────────────────────────────────────
   Reads the day via availability-windows.php?action=range (windows + bookings +
   blocks + closed) — the SAME endpoint the shared timeline uses. A drag-created
   titled entry is persisted as a manual availability BLOCK via block-interval.php
   (reason = the free-text title). block-interval already:
     • accepts a free-text label + arbitrary range with NO email/phone,
     • is internal-only (never shown to customers), and
     • enforces the existing conflict rules (overlap a real booking → 409
       slot_taken; blocks never stack).
   No schema / API / booking-logic change is made.

   Gestures use the shared, tested TimelineGestures engine (Pointer Events → one
   path for mouse + touch). Globals: Ops (ops-core.js), API_BASE / API_KEY /
   __HM_ADMIN_TOKEN (env.js + ops login), TimelineGestures.
   ════════════════════════════════════════════════════════════════════════════ */
window.OpsDayCalendar = (function () {

  var DOW = ['日', '月', '火', '水', '木', '金', '土'];
  var MN  = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  // Full 24-hour day, 1-hour increments (the whole point of this screen).
  var DAY_START = 0;      // 00:00
  var DAY_END   = 1440;   // 24:00
  var SNAP      = 60;     // minutes — 1-hour increments; NOT a 30-min selector
  var PX_PER_MIN = 52 / 60;   // 52px per hour

  var state = {
    date: null,        // 'YYYY-MM-DD' (the single day shown)
    windows: [],       // [{id,start_at,end_at}]        (bookable periods — faint bg)
    bookings: [],      // [{id,customer_name,status,start_at,end_at}]  (read-only)
    blocks: [],        // [{id,reason,memo,start_at,end_at}]           (operator entries)
    closed: null,      // {day,reason,...} | null
    reduceMotion: false
  };

  /* ── env helpers ── */
  function _base()   { return (window.API_BASE || (window.location.origin + '/hm-api')).replace(/\/+$/, ''); }
  function _headers(json) {
    var h = json ? { 'Content-Type': 'application/json' } : {};
    h['X-API-KEY'] = window.API_KEY || '';
    if (window.__HM_ADMIN_TOKEN) h['X-ADMIN-TOKEN'] = window.__HM_ADMIN_TOKEN;
    return h;
  }
  function _toast(m) {
    if (window.Ops && Ops.UI && Ops.UI.toast) Ops.UI.toast(m);
    else if (typeof window.toast === 'function') window.toast(m);
    else console.log('[OpsDayCal]', m);
  }
  function _esc(s) {
    if (window.Ops && Ops.util && Ops.util.esc) return Ops.util.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  /* ── date / time helpers ── */
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate()+n); return ymd(d); }
  function todayStr() {
    if (window.Ops && Ops.util && Ops.util.todayStr) return Ops.util.todayStr();
    var d = new Date(); return ymd(d);
  }
  function minToHm(m) { m = Math.max(0, Math.min(1440, Math.round(m))); return pad(Math.floor(m/60)) + ':' + pad(m%60); }
  function dtMin(dt) { var m = String(dt).match(/(\d{2}):(\d{2})/); return m ? (+m[1])*60 + (+m[2]) : 0; }
  function minToY(min) { return (min - DAY_START) * PX_PER_MIN; }
  function yToMin(y)   { return DAY_START + y / PX_PER_MIN; }
  function snap(m)     { return Math.round(m / SNAP) * SNAP; }
  function clampMin(m) { return Math.max(DAY_START, Math.min(DAY_END, m)); }

  /* ── data load ── */
  function load() {
    var d = state.date;
    return fetch(_base() + '/availability-windows.php?action=range&from=' + d + '&to=' + d + '&_ts=' + Date.now(),
                 { headers: _headers(), cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (out) {
        state.windows = []; state.bookings = []; state.blocks = []; state.closed = null;
        if (out && out.ok) {
          (out.windows  || []).forEach(function (w) { if (String(w.start_at).slice(0,10) === d || w.window_date === d) state.windows.push(w); });
          (out.bookings || []).forEach(function (b) { if (String(b.start_at).slice(0,10) === d) state.bookings.push(b); });
          (out.blocks   || []).forEach(function (b) { if (String(b.start_at).slice(0,10) === d) state.blocks.push(b); });
          (out.closed   || []).forEach(function (c) { if (c && c.day === d) state.closed = c; });
        }
        render();
      })
      .catch(function () { render(); });
  }

  /* ── render ── */
  function _host() { return document.getElementById('view-calendar') || document.getElementById('ops-content'); }

  function render() {
    var host = _host();
    if (!host) return;
    var root = document.getElementById('odCal');
    if (!root) {
      root = document.createElement('div');
      root.id = 'odCal';
      root.className = 'od-cal';
      host.appendChild(root);
    }
    var d = parse(state.date);
    var title = d.getFullYear() + '年' + MN[d.getMonth()] + d.getDate() + '日（' + DOW[d.getDay()] + '）';

    var closed = !!state.closed;
    root.innerHTML =
      '<div class="od-bar">' +
        '<button class="od-nav" id="odPrev" type="button" aria-label="前の日">&#8249;</button>' +
        '<button class="od-today" id="odToday" type="button">今日</button>' +
        '<button class="od-nav" id="odNext" type="button" aria-label="次の日">&#8250;</button>' +
        '<button class="od-title" id="odTitle" type="button" aria-haspopup="dialog" aria-expanded="false" ' +
          'title="日付を選択">' + _esc(title) + '<span class="od-caret" aria-hidden="true">▾</span></button>' +
        '<button class="od-close' + (closed ? ' on' : '') + '" id="odClose" type="button" aria-pressed="' + (closed ? 'true' : 'false') + '">' +
          (closed ? '終日休業を解除' : '終日休業') + '</button>' +
        '<button class="od-add" id="odAdd" type="button"' + (closed ? ' disabled' : '') + '>＋ 予定を追加</button>' +
      '</div>' +
      (closed ? '<div class="od-closed" role="status">この日は終日休業です' +
                (state.closed.reason && state.closed.reason !== '終日休業' ? '（' + _esc(state.closed.reason) + '）' : '') + '</div>' : '') +
      '<div class="od-scroll" id="odScroll">' + _gridHtml() + '</div>' +
      '<p class="od-hint">' + (closed ? '休業中です。「終日休業を解除」で通常に戻せます。'
        : ('空いている時間を' + (isTouch() ? '長押ししてから下へドラッグ' : 'ドラッグ') + 'すると予定を作成できます。')) + '</p>';

    root.querySelector('#odPrev').onclick  = function () { state.date = addDays(state.date, -1); load(); };
    root.querySelector('#odNext').onclick  = function () { state.date = addDays(state.date, 1); load(); };
    root.querySelector('#odToday').onclick = function () { state.date = todayStr(); load(); };
    root.querySelector('#odTitle').onclick = function () { _openPicker(); };
    root.querySelector('#odClose').onclick = function () { closed ? _reopenDay() : _closeDay(); };
    var addBtn = root.querySelector('#odAdd');
    addBtn.onclick = function () { if (!state.closed) openEditor(null, defaultRange()); };

    var scroll = root.querySelector('#odScroll');
    _bindInteractions(scroll);

    // Scroll to ~07:00 (or the earliest existing entry / now) so the workday is in view.
    var focusMin = _focusMin();
    scroll.scrollTop = Math.max(0, minToY(focusMin) - 12);
  }

  function _gridHtml() {
    var h = (DAY_END - DAY_START) * PX_PER_MIN;
    var axis = '', lines = '';
    for (var m = DAY_START; m <= DAY_END; m += 60) {
      axis  += '<div class="od-hr" style="top:' + minToY(m) + 'px">' + minToHm(m) + '</div>';
      lines += '<div class="od-hrline" style="top:' + minToY(m) + 'px"></div>';
    }
    var wins  = state.windows.map(_winHtml).join('');
    var bks   = state.bookings.map(_bkHtml).join('');
    var blks  = state.blocks.map(_blkHtml).join('');
    var now   = (state.date === todayStr()) ? _nowLine() : '';
    // Closed day: hatch the whole 24h, keep bookings visible, no bookable-window tint.
    var closed = !!state.closed;
    var closedOv = closed ? '<div class="od-closed-ov" aria-hidden="true"><span>終日休業</span></div>' : '';
    return '<div class="od-grid" style="height:' + h + 'px">' +
             '<div class="od-axis" style="height:' + h + 'px">' + axis + '</div>' +
             '<div class="od-canvas' + (closed ? ' od-closed-canvas' : '') + '" id="odCanvas" style="height:' + h + 'px">' +
               lines + (closed ? '' : wins) + blks + bks + now + closedOv +
             '</div>' +
           '</div>';
  }

  // Bookable window — faint background band, NO text (empty cells stay blank).
  function _winHtml(w) {
    var a = dtMin(w.start_at), b = dtMin(w.end_at);
    return '<div class="od-win" style="top:' + minToY(a) + 'px;height:' + Math.max(2, (b-a)*PX_PER_MIN) + 'px"></div>';
  }
  // Customer booking — read-only entry (existing data must remain intact).
  function _bkHtml(b) {
    var a = dtMin(b.start_at), z = dtMin(b.end_at);
    var pend = (b.status && b.status !== 'confirmed' && b.status !== 'completed' && b.status !== '確定' && b.status !== '完了') ? ' pending' : '';
    return '<div class="od-ev od-bk' + pend + '" data-kind="booking" data-id="' + _esc(b.id) + '" ' +
           'style="top:' + minToY(a) + 'px;height:' + Math.max(22, (z-a)*PX_PER_MIN) + 'px" ' +
           'tabindex="0" role="button" aria-label="' + _esc((b.customer_name||'予約') + ' ' + minToHm(a) + 'から' + minToHm(z)) + '">' +
             '<span class="od-ev-t">' + minToHm(a) + '–' + minToHm(z) + '</span>' +
             '<span class="od-ev-n">' + _esc(b.customer_name || '予約') + '</span>' +
           '</div>';
  }
  // Operator-created titled entry (a manual block). Editable + deletable.
  function _blkHtml(b) {
    var a = dtMin(b.start_at), z = dtMin(b.end_at);
    var title = (b.reason && b.reason !== '（ブロック）') ? b.reason : (b.memo || '（無題）');
    return '<div class="od-ev od-blk" data-kind="block" data-id="' + _esc(b.id) + '" ' +
           'data-title="' + _esc(b.reason || '') + '" data-memo="' + _esc(b.memo || '') + '" ' +
           'data-s="' + a + '" data-e="' + z + '" ' +
           'style="top:' + minToY(a) + 'px;height:' + Math.max(22, (z-a)*PX_PER_MIN) + 'px" ' +
           'tabindex="0" role="button" aria-label="' + _esc(title + ' ' + minToHm(a) + 'から' + minToHm(z) + ' 編集') + '">' +
             '<span class="od-ev-t">' + minToHm(a) + '–' + minToHm(z) + '</span>' +
             '<span class="od-ev-n">' + _esc(title) + '</span>' +
           '</div>';
  }
  function _nowLine() {
    var now = new Date(), m = now.getHours()*60 + now.getMinutes();
    return '<div class="od-now" style="top:' + minToY(m) + 'px"></div>';
  }

  function _focusMin() {
    var min = null;
    state.blocks.concat(state.bookings).forEach(function (e) { var a = dtMin(e.start_at); if (min == null || a < min) min = a; });
    if (state.date === todayStr()) { var now = new Date(); min = Math.min(min == null ? 1440 : min, now.getHours()*60); }
    return min == null ? 420 : Math.max(0, min - 60);   // default 07:00
  }

  function isTouch() { try { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0; } catch (_) { return false; } }

  /* ── interactions: drag-to-select on empty canvas + tap existing entries ── */
  function _canvasY(canvas, clientY) { return clientY - canvas.getBoundingClientRect().top; }

  function _bindInteractions(scroll) {
    var canvas = scroll.querySelector('#odCanvas');
    if (!canvas) return;

    canvas.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;             // primary button only
      if (state.closed) return;                                   // day closed → no new Ops scheduling
      if (e.target.closest('.od-ev')) return;                     // existing entry handles itself
      if (e.pointerType === 'mouse') { _beginSelect(e, canvas, scroll); return; }
      // Touch / pen: require a brief stationary hold so a normal swipe still scrolls
      // the day. Once held (no scroll started), we take over and prevent scrolling.
      var sx = e.clientX, sy = e.clientY;
      var timer = setTimeout(function () { cleanup(); _beginSelect(e, canvas, scroll); }, 160);
      function mv(ev) { if (Math.abs(ev.clientX - sx) > 10 || Math.abs(ev.clientY - sy) > 10) cleanup(); }
      function cleanup() {
        clearTimeout(timer);
        window.removeEventListener('pointermove', mv, true);
        window.removeEventListener('pointerup', cleanup, true);
        window.removeEventListener('pointercancel', cleanup, true);
      }
      window.addEventListener('pointermove', mv, true);
      window.addEventListener('pointerup', cleanup, true);
      window.addEventListener('pointercancel', cleanup, true);
    });

    // Existing entries: tap/Enter → edit an operator block, or MOVE a real booking.
    // The two paths are kept strictly separate (a booking is never turned into a
    // block, and vice-versa).
    canvas.querySelectorAll('.od-ev').forEach(function (ev) {
      var open = function () {
        if (ev.getAttribute('data-kind') === 'block') {
          openEditor(ev.getAttribute('data-id'), {
            start: +ev.getAttribute('data-s'), end: +ev.getAttribute('data-e'),
            title: ev.getAttribute('data-title'), memo: ev.getAttribute('data-memo')
          });
        } else {
          openBookingEditor(ev.getAttribute('data-id'));   // real customer booking → reschedule
        }
      };
      ev.addEventListener('click', open);
      ev.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  function _beginSelect(ev, canvas, scroll) {
    var start = clampMin(snap(yToMin(_canvasY(canvas, ev.clientY))));
    var ghost = document.createElement('div');
    ghost.className = 'od-ghost';
    canvas.appendChild(ghost);
    var a = start, b = start + SNAP;

    function paint(s, e) {
      var lo = clampMin(Math.min(s, e)), hi = clampMin(Math.max(s, e));
      if (hi - lo < SNAP) hi = clampMin(lo + SNAP);
      a = lo; b = hi;
      ghost.style.top = minToY(lo) + 'px';
      ghost.style.height = Math.max(SNAP * PX_PER_MIN, (hi - lo) * PX_PER_MIN) + 'px';
      ghost.textContent = minToHm(lo) + ' ～ ' + minToHm(hi);
    }
    paint(start, start + SNAP);

    window.TimelineGestures.pointerDrag(ev, {
      autoScroll: { el: scroll, edge: 48, maxSpeed: 16 },
      onMove: function (info) { paint(start, snap(yToMin(_canvasY(canvas, info.clientY)))); },
      onEnd: function () { if (ghost.parentNode) canvas.removeChild(ghost); openEditor(null, { start: a, end: b }); },
      onCancel: function () { if (ghost.parentNode) canvas.removeChild(ghost); }
    });
  }

  function defaultRange() {
    var base = (state.date === todayStr()) ? (new Date().getHours() * 60) : 540;   // now, or 09:00
    var s = clampMin(snap(base)); var e = clampMin(s + 60);
    if (e <= s) { s = 540; e = 600; }
    return { start: s, end: e };
  }

  /* ── minimal editor (create / edit) ── */
  var _openOv = null;
  function _closeEditor() { if (_openOv) { _openOv.remove(); _openOv = null; document.removeEventListener('keydown', _escClose, true); } }
  function _escClose(e) { if (e.key === 'Escape') _closeEditor(); }

  function _hourOptions(selMin, from, to) {
    var out = '';
    for (var m = from; m <= to; m += 60) out += '<option value="' + m + '"' + (m === selMin ? ' selected' : '') + '>' + minToHm(m) + '</option>';
    return out;
  }

  function openEditor(blockId, range) {
    _closeEditor();
    var editing = !!blockId;
    var s = clampMin(range.start), e = clampMin(range.end);
    if (e <= s) e = clampMin(s + 60);
    // Round an end of 23:59 (stored for a 24:00 selection) up to 24:00 for display.
    if (e >= 1439) e = 1440;

    var ov = document.createElement('div');
    ov.className = 'od-ov';
    ov.innerHTML =
      '<div class="od-modal" role="dialog" aria-modal="true" aria-labelledby="odEdH">' +
        '<h3 id="odEdH">' + (editing ? '予定を編集' : '予定を追加') + '</h3>' +
        '<label class="od-field"><span>タイトル</span>' +
          '<input id="odEdTitle" type="text" maxlength="120" autocomplete="off" ' +
          'placeholder="例：引越し 〇〇様 / 見積もり / 電話" value="' + _esc(range.title || '') + '"></label>' +
        '<div class="od-field"><span>時間</span>' +
          '<div class="od-range">' +
            '<select id="odEdStart" aria-label="開始時刻">' + _hourOptions(s, 0, 1380) + '</select>' +
            '<span class="od-tilde" aria-hidden="true">～</span>' +
            '<select id="odEdEnd" aria-label="終了時刻">' + _hourOptions(e, 60, 1440) + '</select>' +
          '</div>' +
        '</div>' +
        '<p class="od-err" id="odEdErr" role="alert" hidden></p>' +
        '<div class="od-modal-actions">' +
          (editing ? '<button type="button" class="od-btn od-del" id="odEdDel">削除</button>' : '<span></span>') +
          '<div>' +
            '<button type="button" class="od-btn od-cancel" id="odEdCancel">キャンセル</button>' +
            '<button type="button" class="od-btn od-save" id="odEdSave">保存</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    _openOv = ov;
    document.addEventListener('keydown', _escClose, true);
    ov.addEventListener('pointerdown', function (e) { if (e.target === ov) _closeEditor(); });

    var elTitle = ov.querySelector('#odEdTitle'),
        elStart = ov.querySelector('#odEdStart'),
        elEnd   = ov.querySelector('#odEdEnd'),
        elErr   = ov.querySelector('#odEdErr'),
        elSave  = ov.querySelector('#odEdSave');

    // Keep end > start as the operator changes the selects.
    elStart.addEventListener('change', function () {
      if (+elEnd.value <= +elStart.value) elEnd.value = String(clampMin(+elStart.value + 60));
    });
    elEnd.addEventListener('change', function () {
      if (+elEnd.value <= +elStart.value) elStart.value = String(Math.max(0, +elEnd.value - 60));
    });

    ov.querySelector('#odEdCancel').onclick = _closeEditor;
    var delBtn = ov.querySelector('#odEdDel');
    if (delBtn) delBtn.onclick = function () { if (window.confirm('この予定を削除しますか？')) _deleteBlock(blockId); };

    elSave.onclick = function () {
      var aMin = +elStart.value, bMin = +elEnd.value;
      if (bMin <= aMin) { elErr.hidden = false; elErr.textContent = '終了時刻は開始時刻より後にしてください。'; return; }
      var title = elTitle.value.trim();
      elSave.disabled = true; elSave.textContent = '保存中…';
      var done = function (ok) {
        elSave.disabled = false; elSave.textContent = '保存';
        if (ok) _closeEditor();
      };
      if (editing) _updateBlock(blockId, state.date, aMin, bMin, title).then(done);
      else         _createBlock(state.date, aMin, bMin, title).then(done);
    };

    setTimeout(function () { elTitle.focus(); }, 30);
  }

  /* ── writes → block-interval.php (reason = free-text title; no schema change) ── */
  function _endTimeStr(bMin) { return bMin >= 1440 ? '23:59:59' : minToHm(bMin); }

  function _blockPost(payload) {
    return fetch(_base() + '/block-interval.php', { method: 'POST', headers: _headers(true), body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }, function () { return { status: r.status, j: null }; }); });
  }

  function _createBlock(date, aMin, bMin, title) {
    return _blockPost({ action: 'block', date: date, start_time: minToHm(aMin), end_time: _endTimeStr(bMin), reason: title })
      .then(function (res) {
        var j = res.j || {};
        if (j.ok) { _toast('予定を保存しました'); _broadcast(); load(); return true; }
        if (j.error === 'slot_taken') { _toast('その時間帯は他の予約と重複します'); }
        else { _toast('保存に失敗しました: ' + _esc(j.error || ('HTTP ' + res.status))); }
        return false;
      })
      .catch(function () { _toast('通信エラー：保存できませんでした'); return false; });
  }

  function _deleteBlock(id) {
    return _blockPost({ action: 'unblock', id: id })
      .then(function (res) {
        var j = res.j || {};
        if (j.ok) { _toast('予定を削除しました'); _broadcast(); _closeEditor(); load(); return true; }
        _toast('削除に失敗しました'); return false;
      })
      .catch(function () { _toast('通信エラー：削除できませんでした'); return false; });
  }

  // block-interval has no update action, so an edit = unblock old + block new. On
  // failure the original values are re-added so an edit never destroys the entry.
  function _updateBlock(id, date, aMin, bMin, title) {
    var orig = state.blocks.filter(function (b) { return String(b.id) === String(id); })[0] || null;
    return _blockPost({ action: 'unblock', id: id }).then(function (delRes) {
      if (!delRes.j || !delRes.j.ok) { _toast('更新に失敗しました'); return false; }
      return _blockPost({ action: 'block', date: date, start_time: minToHm(aMin), end_time: _endTimeStr(bMin), reason: title })
        .then(function (addRes) {
          var j = addRes.j || {};
          if (j.ok) { _toast('予定を更新しました'); _broadcast(); load(); return true; }
          // Roll back — re-create the original so nothing is lost.
          if (orig) {
            _blockPost({ action: 'block', date: String(orig.start_at).slice(0,10),
              start_time: minToHm(dtMin(orig.start_at)), end_time: _endTimeStr(dtMin(orig.end_at)),
              reason: orig.reason || '' }).then(function () { load(); });
          } else { load(); }
          _toast(j.error === 'slot_taken' ? 'その時間帯は重複します（変更を取り消しました）' : '更新に失敗しました（変更を取り消しました）');
          return false;
        });
    }).catch(function () { _toast('通信エラー：更新できませんでした'); load(); return false; });
  }

  /* ── move a REAL customer booking (reuses the existing reschedule.php path) ──
     This edits the ACTUAL booking record: reschedule.php moves it atomically,
     re-checks conflicts (→ 409 slot_taken), and emails the customer for confirmed
     bookings. It NEVER creates a block or a duplicate booking. If nothing changed
     the API is not called, so opening + closing never fires a spurious change email. */
  function openBookingEditor(id) {
    var b = state.bookings.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!b) return;
    _closeEditor();
    var origDate = state.date;
    var oS = dtMin(b.start_at), oE = dtMin(b.end_at);
    var pS = clampMin(Math.floor(oS / 60) * 60);
    var pE = clampMin(Math.max(pS + 60, Math.ceil(oE / 60) * 60));
    var dirty = false;

    var ov = document.createElement('div');
    ov.className = 'od-ov';
    ov.innerHTML =
      '<div class="od-modal" role="dialog" aria-modal="true" aria-labelledby="odBkH">' +
        '<h3 id="odBkH">予約を移動</h3>' +
        '<p class="od-bk-name">' + _esc(b.customer_name || 'ご予約') + '</p>' +
        '<div class="od-field"><span>日付</span>' +
          '<input id="odBkDate" type="date" value="' + _esc(origDate) + '"></div>' +
        '<div class="od-field"><span>時間</span>' +
          '<div class="od-range">' +
            '<select id="odBkStart" aria-label="開始時刻">' + _hourOptions(pS, 0, 1380) + '</select>' +
            '<span class="od-tilde" aria-hidden="true">～</span>' +
            '<select id="odBkEnd" aria-label="終了時刻">' + _hourOptions(pE, 60, 1440) + '</select>' +
          '</div></div>' +
        '<p class="od-note">お客様の既存予約の日時を変更します。</p>' +
        // OPTIONAL secondary SMS — sent only if checked AND the reschedule succeeds.
        // Existing reschedule + its customer email are unaffected; SMS never blocks.
        '<div class="ops-sms-row od-sms">' +
          ((window.Ops && Ops.Sms) ? Ops.Sms.checkboxHtml('odBkSms', true) : '') +
        '</div>' +
        '<p class="od-err" id="odBkErr" role="alert" hidden></p>' +
        '<div class="od-modal-actions"><span></span><div>' +
          '<button type="button" class="od-btn od-cancel" id="odBkCancel">キャンセル</button>' +
          '<button type="button" class="od-btn od-save" id="odBkSave">保存</button>' +
        '</div></div>' +
      '</div>';
    document.body.appendChild(ov);
    _openOv = ov;
    document.addEventListener('keydown', _escClose, true);
    ov.addEventListener('pointerdown', function (e) { if (e.target === ov) _closeEditor(); });

    var dEl = ov.querySelector('#odBkDate'), sEl = ov.querySelector('#odBkStart'),
        eEl = ov.querySelector('#odBkEnd'), errEl = ov.querySelector('#odBkErr'), saveEl = ov.querySelector('#odBkSave');
    var mark = function () { dirty = true; };
    dEl.addEventListener('change', mark);
    sEl.addEventListener('change', function () { mark(); if (+eEl.value <= +sEl.value) eEl.value = String(clampMin(+sEl.value + 60)); });
    eEl.addEventListener('change', function () { mark(); if (+eEl.value <= +sEl.value) sEl.value = String(Math.max(0, +eEl.value - 60)); });
    ov.querySelector('#odBkCancel').onclick = _closeEditor;

    saveEl.onclick = function () {
      var nd = dEl.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nd)) { errEl.hidden = false; errEl.textContent = '日付を選択してください。'; return; }
      var aMin = +sEl.value, bMin = +eEl.value;
      if (bMin <= aMin) { errEl.hidden = false; errEl.textContent = '終了時刻は開始時刻より後にしてください。'; return; }
      if (!dirty) { _closeEditor(); return; }   // unchanged → no API call (no spurious change email)
      // Capture the OPTIONAL SMS opt-in before the modal closes on success.
      var wantSms = !!(window.Ops && Ops.Sms && Ops.Sms.isChecked('odBkSms'));
      saveEl.disabled = true; saveEl.textContent = '保存中…';
      _rescheduleBooking(id, nd, aMin, bMin).then(function (ok) {
        saveEl.disabled = false; saveEl.textContent = '保存';
        if (ok) {
          // Reschedule (+ its existing customer email) succeeded — NOW attempt the
          // optional SMS (non-blocking; failure never undoes the reschedule).
          if (wantSms) Ops.Sms.send(id, 'reschedule');
          _closeEditor();
        }
      });
    };
  }

  // POST the existing reschedule.php (atomic move + conflict re-check + customer
  // email). On success, navigate to the target day so the moved booking stays in view.
  function _rescheduleBooking(id, date, aMin, bMin) {
    var startAt = date + ' ' + minToHm(aMin) + ':00';
    var endAt   = date + ' ' + (bMin >= 1440 ? '23:59:59' : (minToHm(bMin) + ':00'));
    return fetch(_base() + '/reschedule.php', { method: 'POST', headers: _headers(true),
        body: JSON.stringify({ booking_id: id, booking_date: date, start_at: startAt, end_at: endAt }) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }, function () { return { status: r.status, j: null }; }); })
      .then(function (res) {
        var j = res.j || {};
        if (j.ok) { _toast('予約を移動しました'); _broadcast(); state.date = date; load(); return true; }
        if (j.error === 'slot_taken') { _toast('その時間帯は他の予約と重複します'); }
        else { _toast('変更に失敗しました: ' + _esc(j.error || ('HTTP ' + res.status))); }
        return false;
      })
      .catch(function () { _toast('通信エラー：変更できませんでした'); return false; });
  }

  /* ── full-day close / reopen (reuses the existing close-day.php path) ──
     A whole-day closure is an availability STATE (closed_days table), NOT a booking.
     It removes the day's bookable availability but NEVER touches, deletes, or converts
     the real customer bookings — they stay in the bookings table and stay visible.
     Reason is fixed ('終日休業', internal-only) to keep this a one-tap control. */
  function _closeDay() {
    if (state.closed) return;
    var n = state.bookings.length;
    var msg = n > 0
      ? ('この日には確定済みのお客様のご予約が ' + n + ' 件あります。\n\n終日休業にしても予約は削除・変更されず、そのまま表示されます。\n終日休業にしますか？')
      : ('この日を終日休業（00:00〜24:00）にしますか？');
    if (!window.confirm(msg)) return;
    fetch(_base() + '/close-day.php', { method: 'POST', headers: _headers(true),
        body: JSON.stringify({ action: 'close', date: state.date, reason: '終日休業' }) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }, function () { return { status: r.status, j: null }; }); })
      .then(function (res) {
        var j = res.j || {};
        if (j.ok) { _toast('終日休業にしました'); _broadcast(); load(); }
        else { _toast('休業設定に失敗しました: ' + _esc(j.error || ('HTTP ' + res.status))); }
      })
      .catch(function () { _toast('通信エラー：休業設定を保存できませんでした'); });
  }
  function _reopenDay() {
    if (!state.closed) return;
    if (!window.confirm('この日の終日休業を解除しますか？')) return;
    fetch(_base() + '/close-day.php', { method: 'POST', headers: _headers(true),
        body: JSON.stringify({ action: 'reopen', date: state.date }) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }, function () { return { status: r.status, j: null }; }); })
      .then(function (res) {
        var j = res.j || {};
        if (j.ok) { _toast('終日休業を解除しました'); _broadcast(); load(); }
        else { _toast('解除に失敗しました: ' + _esc(j.error || ('HTTP ' + res.status))); }
      })
      .catch(function () { _toast('通信エラー：解除できませんでした'); });
  }

  /* ── quick date picker (month grid) — a DATE-SELECTION tool only ──
     Tapping the centered date opens a small month calendar to jump to any day.
     It never renders the 24h schedule and does not add week/month scheduling views;
     picking a day just sets state.date + load() (which shows that day's normal state,
     including a full-day closure). Frontend-only; no backend/endpoint change. */
  var _pickerOv = null, _pickerMonth = null;

  function _pickerKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); _closePicker(); }
  }
  function _closePicker() {
    if (!_pickerOv) return;
    _pickerOv.remove(); _pickerOv = null;
    document.removeEventListener('keydown', _pickerKey, true);
    var t = document.getElementById('odTitle');
    if (t) { t.setAttribute('aria-expanded', 'false'); try { t.focus(); } catch (_) {} }
  }
  function _openPicker() {
    _closePicker();
    _pickerMonth = parse(state.date); _pickerMonth.setDate(1);
    var ov = document.createElement('div');
    ov.className = 'od-pick-ov';
    ov.innerHTML = '<div class="od-pick" role="dialog" aria-modal="true" aria-label="日付を選択">' + _pickerInner() + '</div>';
    document.body.appendChild(ov);
    _pickerOv = ov;
    var t = document.getElementById('odTitle'); if (t) t.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', _pickerKey, true);
    ov.addEventListener('pointerdown', function (e) { if (e.target === ov) _closePicker(); });
    _bindPicker();
    setTimeout(function () {
      var f = ov.querySelector('.od-pick-day.sel') || ov.querySelector('#odPickClose');
      if (f) try { f.focus(); } catch (_) {}
    }, 20);
  }
  function _pickerInner() {
    var y = _pickerMonth.getFullYear(), m = _pickerMonth.getMonth();
    var head = '<div class="od-pick-head">' +
        '<button class="od-pick-nav" id="odPickPrev" type="button" aria-label="前の月">&#8249;</button>' +
        '<span class="od-pick-title" aria-live="polite">' + y + '年' + MN[m] + '</span>' +
        '<button class="od-pick-nav" id="odPickNext" type="button" aria-label="次の月">&#8250;</button>' +
        '<button class="od-pick-close" id="odPickClose" type="button" aria-label="閉じる">&times;</button>' +
      '</div>';
    var dow = '<div class="od-pick-dow">' + DOW.map(function (d, i) {
      return '<span class="' + (i === 0 ? 'sun' : i === 6 ? 'sat' : '') + '">' + d + '</span>';
    }).join('') + '</div>';
    var first = new Date(y, m, 1);
    var start = new Date(first); start.setDate(1 - first.getDay());
    var today = todayStr(), sel = state.date, cells = '';
    for (var i = 0; i < 42; i++) {
      var d = new Date(start); d.setDate(start.getDate() + i);
      var ds = ymd(d), inMonth = d.getMonth() === m;
      var cls = 'od-pick-day' + (inMonth ? '' : ' dim') + (ds === sel ? ' sel' : '') + (ds === today ? ' today' : '');
      cells += '<button class="' + cls + '" type="button" data-date="' + ds + '"' +
               (ds === sel ? ' aria-current="date"' : '') + '>' + d.getDate() + '</button>';
    }
    return head + dow + '<div class="od-pick-grid">' + cells + '</div>';
  }
  function _bindPicker() {
    var ov = _pickerOv; if (!ov) return;
    ov.querySelector('#odPickClose').onclick = _closePicker;
    ov.querySelector('#odPickPrev').onclick = function () { _pickerMonth.setMonth(_pickerMonth.getMonth() - 1); _refreshPicker(); };
    ov.querySelector('#odPickNext').onclick = function () { _pickerMonth.setMonth(_pickerMonth.getMonth() + 1); _refreshPicker(); };
    ov.querySelectorAll('.od-pick-day').forEach(function (b) {
      b.onclick = function () {
        var ds = b.getAttribute('data-date');
        _closePicker();
        state.date = ds; load();   // switch the day view; load() renders that day's normal state (incl. closure)
      };
    });
  }
  function _refreshPicker() {
    if (!_pickerOv) return;
    _pickerOv.querySelector('.od-pick').innerHTML = _pickerInner();
    _bindPicker();
  }

  /* ── live sync (same channel the shared timeline uses) ── */
  var _chan = null;
  function _initSync() {
    try {
      _chan = ('BroadcastChannel' in window) ? new BroadcastChannel('hm_timeline_sync') : null;
      if (_chan) _chan.onmessage = function (e) {
        if (e && e.data && e.data.type === 'timeline_changed' && document.getElementById('odCal') && !_openOv && !_pickerOv) load();
      };
    } catch (_) { _chan = null; }
  }
  function _broadcast() { try { if (_chan) _chan.postMessage({ type: 'timeline_changed', at: Date.now() }); } catch (_) {} }

  /* ── public entry ── */
  function onShow(dateStr) {
    try { state.reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
    state.date = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : todayStr();
    _initSync();
    return load();
  }
  function reload() { if (document.getElementById('odCal') && !_openOv && !_pickerOv) return load(); }

  // Test seam (pure helpers + fixtures).
  var _debug = {
    minToY: minToY, yToMin: yToMin, snap: snap, clampMin: clampMin, dtMin: dtMin, minToHm: minToHm,
    endTimeStr: _endTimeStr,
    setState: function (o) { Object.keys(o || {}).forEach(function (k) { state[k] = o[k]; }); },
    render: render
  };

  return { onShow: onShow, reload: reload, _debug: _debug };
})();

/* ── mount into the Ops SPA content area (mirrors opsCalendar.js boot) ── */
(function () {
  if (!window.Ops || !Ops.ready) return;   // not in the Ops app (e.g. unit-test harness)
  var UI = Ops.UI;
  var tr = (typeof window.t === 'function') ? window.t : function (k) { return k; };

  Ops.ready(function () {
    UI.mountChrome({ active: 'calendar', title: tr('calendar.title') });

    var content = document.getElementById('ops-content');
    if (content) content.innerHTML = '<div id="view-calendar" class="ops-tl-host"></div>';

    // Deep-link ?date=YYYY-MM-DD (parity with the old Ops calendar).
    var dl = '';
    try { dl = new URLSearchParams(location.search || '').get('date') || ''; } catch (_) {}

    OpsDayCalendar.onShow(dl);

    // Live refresh on the Ops poll cadence.
    setInterval(function () { try { OpsDayCalendar.reload(); } catch (_) {} }, (Ops.cfg && Ops.cfg.POLL_MS) || 15000);
  });
})();
