'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   PENDING REQUESTS  (admin — Client-Request booking model)

   A self-contained overlay listing customer booking REQUESTS awaiting admin
   decision: status 'pending' (新規) rows that carry a preferred appointment time
   (preferred_start_1). For each the admin sees the 1st/2nd preference, inputs the
   FINAL start + end (admin decides the duration), and:
     • 確定 → POST confirm-request.php action=confirm  (overlap-checked → confirmed)
     • 却下 → POST confirm-request.php action=reject    (→ rejected)

   Non-invasive (mirrors intervalEditor.js):
     - Injects a "承認待ちリクエスト (N)" button into the bookings toolbar (#bkFilter)
       at runtime; hidden when N=0, so it's DORMANT in band mode (no requests exist)
       and only appears once the Client-Request flow is live.
     - Reads Adapter.getBookings() (already includes preferred_start_1/2 + _dbId).
     - Builds one overlay appended to <body>; the bookings table is untouched.

   Depends on globals: Adapter, API_BASE, API_KEY, __HM_ADMIN_TOKEN, (optional) toast.
   ════════════════════════════════════════════════════════════════════════════ */

window.PendingRequests = (function () {

  var OVERLAY_ID = 'hmPendingReqOverlay';

  function _base()   { return (window.API_BASE || '').replace(/\/+$/, ''); }
  function _toast(m) { if (typeof window.toast === 'function') window.toast(m); else console.log('[PendingRequests]', m); }
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
  // "YYYY-MM-DD HH:MM:SS" (or ...T...) → "YYYY-MM-DDTHH:MM" (datetime-local value).
  function _toLocal(dt) {
    var s = String(dt == null ? '' : dt).replace(' ', 'T');
    return s.slice(0, 16);
  }
  // → compact "M/D HH:MM" for display.
  function _fmt(dt) {
    var m = String(dt == null ? '' : dt).replace('T', ' ').match(/^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}:\d{2})/);
    return m ? (parseInt(m[2], 10) + '/' + parseInt(m[3], 10) + ' ' + m[4]) : '';
  }

  // Pending client-requests = mapped status '新規' (pending) AND a preferred time.
  function _list() {
    var all = (window.Adapter && Adapter.getBookings) ? (Adapter.getBookings() || []) : [];
    return all.filter(function (b) { return b && b.status === '新規' && b.preferred_start_1; });
  }

  /* ── trigger button (idempotent; hidden when no requests) ── */
  function mountButton() {
    var btn = document.getElementById('hmPendingReqBtn');
    if (!btn) {
      var anchor = document.getElementById('bkFilter');
      if (!anchor || !anchor.parentNode) return false;
      btn = document.createElement('button');
      btn.id = 'hmPendingReqBtn';
      btn.type = 'button';
      btn.className = 'btn btn-primary btn-sm';
      btn.style.marginLeft = '6px';
      btn.onclick = open;
      anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    }
    refreshCount();
    return true;
  }
  function refreshCount() {
    var btn = document.getElementById('hmPendingReqBtn');
    if (!btn) return;
    var n = _list().length;
    btn.textContent = '承認待ちリクエスト (' + n + ')';
    btn.style.display = n > 0 ? '' : 'none';
  }

  /* ── overlay ── */
  function _ensureOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    var o = document.createElement('div');
    o.id = OVERLAY_ID;
    o.style.cssText = 'position:fixed;inset:0;z-index:9999;display:none;align-items:flex-start;justify-content:center;background:rgba(10,15,23,.55);padding:24px 12px;overflow:auto';
    o.innerHTML =
      '<div role="dialog" aria-modal="true" style="background:#fff;color:#0b0f17;width:min(640px,95vw);max-height:90vh;overflow:auto;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);font-family:inherit">'
    +   '<div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #eef0f3">'
    +     '<strong style="font-size:15px;color:#0a1f44">承認待ちリクエスト</strong>'
    +     '<button type="button" id="hmPrClose" aria-label="閉じる" style="margin-left:auto;border:0;background:transparent;font-size:20px;cursor:pointer;color:#6b7280;line-height:1">×</button>'
    +   '</div>'
    +   '<div id="hmPrList" style="padding:14px 18px"></div>'
    + '</div>';
    document.body.appendChild(o);
    o.addEventListener('click', function (e) { if (e.target === o) close(); });
    document.getElementById('hmPrClose').onclick = close;
  }

  function _render() {
    var host = document.getElementById('hmPrList');
    var reqs = _list();
    if (!reqs.length) {
      host.innerHTML = '<div style="color:#9ca3af;font-size:14px;padding:10px 0">承認待ちのリクエストはありません</div>';
      return;
    }
    host.innerHTML = reqs.map(function (b) {
      var start = _toLocal(b.preferred_start_1);
      return '<div class="hm-pr-row" data-id="' + _esc(b._dbId) + '" style="border:1px solid #eef0f3;border-radius:10px;padding:12px;margin-bottom:12px">'
        + '<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px">'
        +   '<strong style="font-size:14px;color:#0a1f44">' + _esc(b.name || '—') + '</strong>'
        +   '<span style="font-size:12px;color:#6b7280">' + _esc(b.service || '') + '</span>'
        +   '<span style="margin-left:auto;font-size:12px;color:#374151">第1希望 <b>' + _esc(_fmt(b.preferred_start_1)) + '</b>'
        +     (b.preferred_start_2 ? ' ／ 第2希望 <b>' + _esc(_fmt(b.preferred_start_2)) + '</b>' : '') + '</span>'
        + '</div>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">'
        +   '<label style="font-size:12px;color:#374151">確定 開始<br><input type="datetime-local" class="hm-pr-start" value="' + _esc(start) + '" style="padding:6px 8px;border:1px solid #d5dae1;border-radius:8px;font:inherit"></label>'
        +   '<label style="font-size:12px;color:#374151">確定 終了<br><input type="datetime-local" class="hm-pr-end" style="padding:6px 8px;border:1px solid #d5dae1;border-radius:8px;font:inherit"></label>'
        +   '<button type="button" class="btn btn-primary btn-sm hm-pr-confirm" style="padding:8px 14px">確定</button>'
        +   '<button type="button" class="btn btn-ghost btn-sm hm-pr-reject" style="padding:8px 14px;color:#b91c1c">却下</button>'
        + '</div>'
        + '<div class="hm-pr-msg" style="margin-top:8px;font-size:13px;min-height:16px"></div>'
        + '</div>';
    }).join('');
    host.querySelectorAll('.hm-pr-row').forEach(function (row) {
      var id = row.getAttribute('data-id');
      var msg = row.querySelector('.hm-pr-msg');
      row.querySelector('.hm-pr-confirm').onclick = function () {
        var s = row.querySelector('.hm-pr-start').value, e = row.querySelector('.hm-pr-end').value;
        if (!s || !e) { _setMsg(msg, '開始と終了を入力してください', 'error'); return; }
        if (s >= e)   { _setMsg(msg, '終了は開始より後にしてください', 'error'); return; }
        _post({ action: 'confirm', booking_id: id, start_time: s, end_time: e }, msg, row);
      };
      row.querySelector('.hm-pr-reject').onclick = function () {
        if (!window.confirm('このリクエストを却下しますか？')) return;
        _post({ action: 'reject', booking_id: id }, msg, row);
      };
    });
  }

  function _setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.style.color = kind === 'error' ? '#b91c1c' : kind === 'ok' ? '#059669' : '#6b7280';
  }

  function _post(payload, msg, row) {
    _setMsg(msg, '処理中…');
    fetch(_base() + '/confirm-request.php', { method: 'POST', headers: _headers(), body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        var j = res.body || {};
        if (j.ok) {
          _toast(payload.action === 'confirm' ? '予約を確定しました' : 'リクエストを却下しました');
          row.parentNode.removeChild(row);                 // optimistic removal
          _syncAndRefresh();
          if (!_list().length) _render();                  // show empty state
          return;
        }
        if (j.error === 'slot_taken')      { _setMsg(msg, 'この時間帯は既存の予約と重複しています', 'error'); return; }
        if (j.error === 'hourly_disabled') { _setMsg(msg, '時間帯予約が未有効です（hourly_enabled + 移行が必要）', 'error'); return; }
        _setMsg(msg, '失敗: ' + _esc(j.error || ('HTTP ' + res.status)), 'error');
      })
      .catch(function () { _setMsg(msg, '通信エラー', 'error'); });
  }

  // Refresh the admin cache + bookings table + the button count after an action.
  function _syncAndRefresh() {
    var done = function () {
      refreshCount();
      if (typeof window._renderBookingsUI === 'function') { try { window._renderBookingsUI(); } catch (_) {} }
    };
    if (window.Adapter && typeof Adapter.syncBookings === 'function') {
      Promise.resolve(Adapter.syncBookings()).then(done, done);
    } else { done(); }
  }

  function open()  { _ensureOverlay(); _render(); document.getElementById(OVERLAY_ID).style.display = 'flex'; }
  function close() { var o = document.getElementById(OVERLAY_ID); if (o) o.style.display = 'none'; refreshCount(); }

  /* ── boot ── */
  function _boot() {
    if (!mountButton()) {
      var tries = 0, iv = setInterval(function () { if (mountButton() || ++tries > 20) clearInterval(iv); }, 400);
    }
    ['booking:created', 'booking:updated', 'booking:cancelled'].forEach(function (ev) {
      document.addEventListener(ev, refreshCount);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
  else _boot();

  return { open: open, close: close, mountButton: mountButton, refreshCount: refreshCount };
})();
