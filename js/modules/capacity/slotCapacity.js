'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   SLOT CAPACITY GRID  (admin — per-band capacity: Morning/Afternoon/Evening/Night)

   A self-contained panel that manages per-band capacity for a selected date via
   slot-capacity.php. Kept SEPARATE from the existing day-level capacity.js
   ({max,limited}) — this module only appends a new panel and never touches that.

   Grid per date: 時間帯 | 状態(Open/Closed) | 上限(±) | 使用 | 残り
     ± / Close / Reopen → POST slot-capacity.php (set / close / reopen)

   Non-invasive (mirrors intervalEditor.js / pendingRequests.js):
     - On boot, appends a panel into #view-capacity .settings-grid (one-time),
       injects its own <style> once. No admin.html markup change beyond the
       <script> include.
     - Talks to the DB only through slot-capacity.php (single source of truth).

   Depends on globals: API_BASE, API_KEY, __HM_ADMIN_TOKEN, (optional) toast/todayStr.
   ════════════════════════════════════════════════════════════════════════════ */

window.SlotCapacity = (function () {

  var BANDS = [
    { id: 'am', label: '午前 (Morning)',   time: '09:00–12:00' },
    { id: 'pm', label: '午後 (Afternoon)', time: '12:00–15:00' },
    { id: 'ev', label: '夕方 (Evening)',   time: '15:00–18:00' },
    { id: 'nt', label: '夜間 (Night)',     time: '18:00–21:00' }
  ];

  function _base()   { return (window.API_BASE || '').replace(/\/+$/, ''); }
  function _toast(m) { if (typeof window.toast === 'function') window.toast(m); else console.log('[SlotCapacity]', m); }
  function _headers() {
    var h = { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' };
    if (window.__HM_ADMIN_TOKEN) h['X-ADMIN-TOKEN'] = window.__HM_ADMIN_TOKEN;
    return h;
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _today() {
    if (typeof window.todayStr === 'function') { var t = window.todayStr(); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; }
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ── one-time scoped styles ── */
  function _injectStyles() {
    if (document.getElementById('hmScStyle')) return;
    var s = document.createElement('style');
    s.id = 'hmScStyle';
    s.textContent =
      '.hm-sc-wrap{overflow-x:auto}' +
      '.hm-sc-table{width:100%;border-collapse:collapse;min-width:520px;font-size:13px}' +
      '.hm-sc-table th,.hm-sc-table td{padding:10px 12px;border-bottom:1px solid #eef0f3;text-align:left;white-space:nowrap}' +
      '.hm-sc-table th{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.03em}' +
      '.hm-sc-band{font-weight:700;color:#0a1f44}.hm-sc-band small{display:block;font-weight:400;color:#9ca3af;font-size:11px}' +
      '.hm-sc-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}' +
      '.hm-sc-open{background:#ecfdf5;color:#059669;border:1px solid #a7f3d0}' +
      '.hm-sc-closed{background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb}' +
      '.hm-sc-cap{display:inline-flex;align-items:center;gap:8px}' +
      '.hm-sc-cap button{width:28px;height:28px;border:1px solid #d5dae1;border-radius:7px;background:#fff;cursor:pointer;font-size:16px;line-height:1;color:#0a1f44}' +
      '.hm-sc-cap button:disabled{opacity:.4;cursor:not-allowed}' +
      '.hm-sc-cap span{min-width:22px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}' +
      '.hm-sc-num{font-variant-numeric:tabular-nums}' +
      '.hm-sc-full{color:#b91c1c;font-weight:700}.hm-sc-limited{color:#b45309;font-weight:700}' +
      '@media(max-width:640px){.hm-sc-table th,.hm-sc-table td{padding:8px 8px}}';
    document.head.appendChild(s);
  }

  /* ── mount the panel into the capacity view (idempotent) ── */
  function mount() {
    if (document.getElementById('hmScPanel')) return true;
    var grid = document.querySelector('#view-capacity .settings-grid');
    if (!grid) return false;
    _injectStyles();
    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'hmScPanel';
    panel.style.marginTop = '16px';
    panel.innerHTML =
      '<div class="panel-head"><span class="panel-title">時間帯別キャパシティ</span>' +
        '<input type="date" id="hmScDate" class="price-input" style="margin-left:auto;width:auto">' +
        '<span style="font-size:12px;color:#6b7280">〜</span>' +
        '<input type="date" id="hmScDateTo" class="price-input" style="width:auto" title="終了日（連続休止の範囲・任意）">' +
        '<button class="btn btn-ghost btn-sm" id="hmScCloseDay" type="button" title="この日（または範囲）を全時間帯休止">全日休止</button>' +
        '<button class="btn btn-ghost btn-sm" id="hmScReopenDay" type="button" title="この日（または範囲）を全時間帯再開">全日再開</button>' +
        '<button class="btn btn-ghost btn-sm" id="hmScReload" type="button">更新</button>' +
      '</div>' +
      '<div class="panel-body">' +
        '<div style="font-size:12px;color:#6b7280;margin-bottom:10px">時間帯ごとの受付上限。予約は上限に達するか「休止」の場合のみ締め切られます。</div>' +
        '<div class="hm-sc-wrap"><table class="hm-sc-table"><thead><tr>' +
          '<th>時間帯</th><th>状態</th><th>上限</th><th>使用</th><th>残り</th>' +
        '</tr></thead><tbody id="hmScBody"></tbody></table></div>' +
        '<div id="hmScMsg" style="margin-top:10px;font-size:13px;min-height:16px"></div>' +
      '</div>';
    grid.appendChild(panel);
    var dateEl = document.getElementById('hmScDate');
    dateEl.value = _today();
    dateEl.onchange = function () { _load(); };
    document.getElementById('hmScReload').onclick = function () { _load(); };
    document.getElementById('hmScCloseDay').onclick = function () {
      var span = _rangeLabel();
      var r = window.prompt(span + 'を全時間帯 休止 にします。理由（任意・例: 祝日 / お盆 / Holiday）', '');
      if (r === null) return;                                   // cancelled
      var payload = { action: 'close-day', date: _date(), reason: r.trim() };
      var to = _dateTo(); if (to) payload.to = to;
      _post(payload, span + 'を全日休止にしました');
    };
    document.getElementById('hmScReopenDay').onclick = function () {
      var span = _rangeLabel();
      if (!window.confirm(span + 'を全時間帯 再開 しますか？')) return;
      var payload = { action: 'reopen-day', date: _date() };
      var to = _dateTo(); if (to) payload.to = to;
      _post(payload, span + 'を全日再開しました');
    };
    _load();
    return true;
  }

  function _msg(text, kind) {
    var el = document.getElementById('hmScMsg'); if (!el) return;
    el.textContent = text || '';
    el.style.color = kind === 'error' ? '#b91c1c' : kind === 'ok' ? '#059669' : '#6b7280';
  }
  function _date() { var el = document.getElementById('hmScDate'); return (el && el.value) || _today(); }
  // Optional range end. Honoured only when set AND on/after the start date.
  function _dateTo() {
    var el = document.getElementById('hmScDateTo');
    var v = (el && el.value) || '';
    return (v && v >= _date()) ? v : '';   // ISO YYYY-MM-DD compares lexicographically
  }
  function _rangeLabel() { var to = _dateTo(); return to ? ('この期間（' + _date() + '〜' + to + '）') : 'この日'; }

  /* ── read: per-band status for the selected date ── */
  function _load() {
    var d = _date();
    _msg('読み込み中…');
    fetch(_base() + '/slot-capacity.php?action=get&date=' + encodeURIComponent(d), { headers: _headers() })
      .then(function (r) { return r.json(); })
      .then(function (out) {
        if (!out || !out.ok) { _msg('取得できませんでした: ' + _esc((out && out.error) || 'error'), 'error'); return; }
        _render(out.bands || {});
        _msg('');
      })
      .catch(function () { _msg('通信エラー', 'error'); });
  }

  function _render(bands) {
    var body = document.getElementById('hmScBody'); if (!body) return;
    body.innerHTML = BANDS.map(function (b) {
      var s = bands[b.id] || { status: 'available', capacity: 1, used: 0, remaining: 1, closed: false };
      var closed = !!s.closed;
      var badge = closed
        ? '<span class="hm-sc-badge hm-sc-closed">休止 Closed</span>' +
          (s.reason ? '<small style="display:block;color:#9ca3af;font-size:11px;margin-top:2px">理由: ' + _esc(s.reason) + '</small>' : '')
        : '<span class="hm-sc-badge hm-sc-open">受付中 Open</span>';
      var remCls = s.remaining <= 0 ? 'hm-sc-full' : (s.status === 'limited' ? 'hm-sc-limited' : '');
      var cap = parseInt(s.capacity, 10) || 0;
      return '<tr data-band="' + b.id + '">' +
        '<td class="hm-sc-band">' + _esc(b.label) + '<small>' + _esc(b.time) + '</small></td>' +
        '<td>' + badge +
          ' <button class="btn btn-ghost btn-sm hm-sc-toggle" type="button" data-band="' + b.id + '" data-closed="' + (closed ? '1' : '0') + '" style="margin-left:6px">' +
            (closed ? '再開' : '休止') + '</button></td>' +
        '<td><span class="hm-sc-cap">' +
            '<button type="button" class="hm-sc-dec" data-band="' + b.id + '" data-cap="' + cap + '"' + (cap <= 0 ? ' disabled' : '') + '>−</button>' +
            '<span>' + cap + '</span>' +
            '<button type="button" class="hm-sc-inc" data-band="' + b.id + '" data-cap="' + cap + '">＋</button>' +
          '</span></td>' +
        '<td class="hm-sc-num">' + (parseInt(s.used, 10) || 0) + '</td>' +
        '<td class="hm-sc-num ' + remCls + '">' + (parseInt(s.remaining, 10) || 0) + '</td>' +
      '</tr>';
    }).join('');

    body.querySelectorAll('.hm-sc-inc').forEach(function (btn) {
      btn.onclick = function () { _set(btn.getAttribute('data-band'), (parseInt(btn.getAttribute('data-cap'), 10) || 0) + 1); };
    });
    body.querySelectorAll('.hm-sc-dec').forEach(function (btn) {
      btn.onclick = function () { _set(btn.getAttribute('data-band'), Math.max(0, (parseInt(btn.getAttribute('data-cap'), 10) || 0) - 1)); };
    });
    body.querySelectorAll('.hm-sc-toggle').forEach(function (btn) {
      btn.onclick = function () { _toggle(btn.getAttribute('data-band'), btn.getAttribute('data-closed') === '1'); };
    });
  }

  /* ── writes → slot-capacity.php ── */
  function _post(payload, okMsg) {
    _msg('保存中…');
    fetch(_base() + '/slot-capacity.php', { method: 'POST', headers: _headers(), body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        var j = res.body || {};
        if (j.ok) {
          _render(j.bands || {}); _msg(okMsg, 'ok'); _toast(okMsg);
          // Notify listeners (the slot calendar month grid) that this date's
          // capacity/closure changed so they can refresh their colouring.
          try { document.dispatchEvent(new CustomEvent('slotcap:changed', { detail: { date: _date() } })); } catch (e) {}
          return;
        }
        _msg('失敗: ' + _esc(j.error || ('HTTP ' + res.status)), 'error');
      })
      .catch(function () { _msg('通信エラー', 'error'); });
  }
  function _set(band, cap)      { _post({ action: 'set',    date: _date(), band: band, capacity: cap }, '上限を更新しました'); }
  function _toggle(band, closed) {
    if (closed) { _post({ action: 'reopen', date: _date(), band: band }, '再開しました'); return; }
    var reason = window.prompt('この時間帯を休止にします。理由（任意・例: 祝日 / Holiday）', '');
    if (reason === null) return;                                // cancelled
    _post({ action: 'close', date: _date(), band: band, reason: reason.trim() }, '休止しました');
  }

  /* ── boot: mount when the capacity view exists ── */
  function _boot() {
    if (mount()) return;
    var tries = 0, iv = setInterval(function () { if (mount() || ++tries > 20) clearInterval(iv); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
  else _boot();

  return { mount: mount, reload: _load };
})();
