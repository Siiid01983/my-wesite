'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   INTERVAL EDITOR  (admin — hourly time-off / block management)

   A self-contained overlay modal that lets an admin "drill down" from the
   day-level availability calendar into the specific hourly INTERVALS on a date:
     • Bands summary (am/pm/ev/nt) — read-only, kept for the at-a-glance view.
     • The day's busy intervals (orders + admin blocks) from availability.php.
     • Add a custom block interval  → POST block-interval.php  (action=block)
     • Remove an existing block      → POST block-interval.php  (action=unblock)

   Non-invasive by design:
     - Appends its own trigger button next to the calendar toolbar's #bulkToggle
       at runtime (no markup change to admin.html beyond the <script> include).
     - Builds a single overlay appended to <body>; the day-grid DOM and the
       existing calClick()/bulk flow are untouched.
     - Orders are READ-ONLY here; only status='admin_blocked' rows are removable
       (the server enforces this too — the button is just UX).

   Depends only on globals: API_BASE, API_KEY, __HM_ADMIN_TOKEN, and (optional)
   toast() / todayStr(). Activates when the server returns hourly intervals
   (i.e. after hourly_enabled + migration); block writes 409 'hourly_disabled'
   until then, which the modal surfaces plainly.
   ════════════════════════════════════════════════════════════════════════════ */

window.IntervalEditor = (function () {

  var OVERLAY_ID = 'hmIntervalEditorOverlay';
  var _date = null;

  /* ── small helpers ── */
  function _base()   { return (window.API_BASE || '').replace(/\/+$/, ''); }
  function _today()  { return (typeof window.todayStr === 'function') ? window.todayStr() : new Date().toISOString().slice(0, 10); }
  function _toast(m) { if (typeof window.toast === 'function') window.toast(m); else console.log('[IntervalEditor]', m); }
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
  // "YYYY-MM-DD HH:MM:SS" (or ...T...) → "HH:MM", else ''.
  function _hm(dt) {
    var t = String(dt == null ? '' : dt).split(/[ T]/)[1] || '';
    var m = t.match(/^(\d{1,2}):(\d{2})/);
    return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : '';
  }
  var BAND_LABEL = { am: '午前', pm: '午後', ev: '夕方', nt: '夜間' };

  /* ── trigger button injection (idempotent) ── */
  function mountButton() {
    if (document.getElementById('hmIvOpenBtn')) return true;
    var anchor = document.getElementById('bulkToggle');
    if (!anchor || !anchor.parentNode) return false;
    var btn = document.createElement('button');
    btn.id = 'hmIvOpenBtn';
    btn.type = 'button';
    btn.className = anchor.className || 'btn btn-ghost btn-sm';
    btn.innerHTML = '⏱ 時間帯ブロック';
    btn.onclick = function () { open(_today()); };
    anchor.parentNode.insertBefore(btn, anchor);
    return true;
  }

  /* ── overlay construction (once) ── */
  function _ensureOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    var o = document.createElement('div');
    o.id = OVERLAY_ID;
    o.style.cssText = 'position:fixed;inset:0;z-index:9999;display:none;align-items:flex-start;justify-content:center;background:rgba(10,15,23,.55);padding:24px 12px;overflow:auto';
    o.innerHTML =
      '<div role="dialog" aria-modal="true" style="background:#fff;color:#0b0f17;width:min(560px,94vw);max-height:90vh;overflow:auto;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);font-family:inherit">'
    +   '<div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #eef0f3">'
    +     '<strong style="font-size:15px;color:#0a1f44">時間帯ブロック管理</strong>'
    +     '<input type="date" id="hmIvDate" style="margin-left:auto;padding:6px 8px;border:1px solid #d5dae1;border-radius:8px;font:inherit">'
    +     '<button type="button" id="hmIvClose" aria-label="閉じる" style="border:0;background:transparent;font-size:20px;cursor:pointer;color:#6b7280;line-height:1">×</button>'
    +   '</div>'
    +   '<div style="padding:16px 18px">'
    +     '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">バンド概要</div>'
    +     '<div id="hmIvBands" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px"></div>'
    +     '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">この日の予約・ブロック</div>'
    +     '<div id="hmIvList" style="margin-bottom:18px"></div>'
    +     '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">ブロックを追加</div>'
    +     '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">'
    +       '<label style="font-size:12px;color:#374151">開始<br><input type="time" id="hmIvStart" step="900" style="padding:6px 8px;border:1px solid #d5dae1;border-radius:8px;font:inherit"></label>'
    +       '<label style="font-size:12px;color:#374151">終了<br><input type="time" id="hmIvEnd" step="900" style="padding:6px 8px;border:1px solid #d5dae1;border-radius:8px;font:inherit"></label>'
    +       '<label style="font-size:12px;color:#374151;flex:1 1 160px">理由（任意）<br><input type="text" id="hmIvReason" placeholder="例: 社内研修" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #d5dae1;border-radius:8px;font:inherit"></label>'
    +       '<button type="button" id="hmIvAdd" class="btn btn-primary btn-sm" style="padding:8px 14px">ブロック</button>'
    +     '</div>'
    +     '<div id="hmIvMsg" style="margin-top:10px;font-size:13px;min-height:18px"></div>'
    +   '</div>'
    + '</div>';
    document.body.appendChild(o);

    o.addEventListener('click', function (e) { if (e.target === o) close(); });
    document.getElementById('hmIvClose').onclick = close;
    document.getElementById('hmIvDate').onchange = function () { _date = this.value || _date; _load(); };
    document.getElementById('hmIvAdd').onclick = _addBlock;
  }

  function _msg(text, kind) {
    var el = document.getElementById('hmIvMsg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = kind === 'error' ? '#b91c1c' : kind === 'ok' ? '#059669' : '#6b7280';
  }

  /* ── read: bands + intervals from availability.php ── */
  function _load() {
    var d = _date;
    _msg('読み込み中…');
    document.getElementById('hmIvBands').innerHTML = '';
    document.getElementById('hmIvList').innerHTML = '<div style="color:#9ca3af;font-size:13px">読み込み中…</div>';
    fetch(_base() + '/availability.php?date=' + encodeURIComponent(d), { headers: _headers() })
      .then(function (r) { return r.json(); })
      .then(function (out) {
        if (!out || !out.ok) { _msg('空き状況を取得できませんでした', 'error'); return; }
        _renderBands(out.bands || {});
        _renderList(Array.isArray(out.intervals) ? out.intervals : []);
        _msg('');
      })
      .catch(function () { _msg('通信エラー', 'error'); });
  }

  function _renderBands(bands) {
    var host = document.getElementById('hmIvBands');
    host.innerHTML = ['am', 'pm', 'ev', 'nt'].map(function (b) {
      var reserved = bands[b] && bands[b] !== 'available';
      var bg = reserved ? '#fef2f2' : '#ecfdf5', fg = reserved ? '#b91c1c' : '#059669', br = reserved ? '#fecaca' : '#a7f3d0';
      return '<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:600;'
        + 'background:' + bg + ';color:' + fg + ';border:1px solid ' + br + '">'
        + _esc(BAND_LABEL[b]) + ' ' + (reserved ? '×' : '○') + '</span>';
    }).join('');
  }

  function _renderList(intervals) {
    var host = document.getElementById('hmIvList');
    if (!intervals.length) {
      host.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:6px 0">予約・ブロックはありません</div>';
      return;
    }
    host.innerHTML = intervals.map(function (it) {
      var isBlock = String(it.status || '') === 'admin_blocked';
      var range = _esc(_hm(it.start_at) + '–' + _hm(it.end_at));
      var tag = isBlock
        ? '<span style="font-size:11px;font-weight:700;color:#92400e;background:#fef3c7;border-radius:6px;padding:2px 7px">ブロック</span>'
        : '<span style="font-size:11px;font-weight:700;color:#1e40af;background:#dbeafe;border-radius:6px;padding:2px 7px">予約</span>';
      var name = _esc(it.customer_name || (isBlock ? '（ブロック）' : ''));
      var del = isBlock
        ? '<button type="button" class="btn btn-ghost btn-sm" data-unblock="' + _esc(it.id) + '" style="margin-left:auto;color:#b91c1c">削除</button>'
        : '<span style="margin-left:auto;font-size:11px;color:#9ca3af">読み取り専用</span>';
      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f1f3f5">'
        + '<span style="font-variant-numeric:tabular-nums;font-weight:600;font-size:13px;color:#0b0f17;min-width:96px">' + range + '</span>'
        + tag + '<span style="font-size:13px;color:#374151">' + name + '</span>' + del + '</div>';
    }).join('');
    host.querySelectorAll('[data-unblock]').forEach(function (b) {
      b.onclick = function () { _unblock(b.getAttribute('data-unblock')); };
    });
  }

  /* ── write: block / unblock via block-interval.php ── */
  function _addBlock() {
    var s = document.getElementById('hmIvStart').value;
    var e = document.getElementById('hmIvEnd').value;
    if (!s || !e) { _msg('開始と終了の時刻を入力してください', 'error'); return; }
    if (s >= e)   { _msg('終了は開始より後にしてください', 'error'); return; }
    var reason = document.getElementById('hmIvReason').value || '';
    _msg('登録中…');
    fetch(_base() + '/block-interval.php', {
      method: 'POST', headers: _headers(),
      body: JSON.stringify({ action: 'block', date: _date, start_time: s, end_time: e, reason: reason })
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        var j = res.body || {};
        if (j.ok) { document.getElementById('hmIvReason').value = ''; _msg('ブロックを追加しました', 'ok'); _load(); return; }
        if (j.error === 'slot_taken')      { _msg('この時間帯は既存の予約と重複しています', 'error'); return; }
        if (j.error === 'hourly_disabled') { _msg('時間帯予約が未有効です（hourly_enabled + 移行が必要）', 'error'); return; }
        _msg('追加できませんでした: ' + _esc(j.error || ('HTTP ' + res.status)), 'error');
      })
      .catch(function () { _msg('通信エラー', 'error'); });
  }

  function _unblock(id) {
    if (!id) return;
    _msg('削除中…');
    fetch(_base() + '/block-interval.php', {
      method: 'POST', headers: _headers(),
      body: JSON.stringify({ action: 'unblock', id: id })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) { _msg('ブロックを削除しました', 'ok'); _load(); }
        else _msg('削除できませんでした: ' + _esc((j && j.error) || 'error'), 'error');
      })
      .catch(function () { _msg('通信エラー', 'error'); });
  }

  /* ── public open / close ── */
  function open(ds) {
    _ensureOverlay();
    _date = ds || _today();
    document.getElementById('hmIvDate').value = _date;
    document.getElementById(OVERLAY_ID).style.display = 'flex';
    _load();
  }
  function close() {
    var o = document.getElementById(OVERLAY_ID);
    if (o) o.style.display = 'none';
  }

  /* ── boot: mount the trigger button when the calendar toolbar exists ── */
  function _boot() {
    if (mountButton()) return;
    var tries = 0;
    var iv = setInterval(function () { if (mountButton() || ++tries > 20) clearInterval(iv); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
  else _boot();

  return { open: open, close: close, mountButton: mountButton };
})();
