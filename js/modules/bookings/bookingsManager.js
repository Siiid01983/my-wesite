/* ══════════════════════════════════════════════════════════════
   Bookings Manager (WMC) — full CRUD over the bookings table.

   View:      #wmc-view-bookings → renders into #view-bookings-manager
   Data flow: UI → Adapter (addBooking / updateBooking / deleteBooking)
              → ApiClient → hm-api/rest.php (canonical write path).
              Reads come from Adapter.getBookings() (localStorage cache,
              refreshed by Adapter.syncFromApi()).
   Auth:      page is behind the WMC login (admin-login.php / MySQL
              admin_users); deletes additionally require the server
              admin token (X-ADMIN-TOKEN) enforced by rest.php.
   Globals used: esc(), toast(), badge() from js/utils/formatters.js.
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var BM_STATUSES = ['新規', '確認中', '確定', '完了', 'キャンセル'];
  var BM_SERVICES = [
    '当日・お急ぎ引越しプラン',
    '単身引越し',
    'カップル・ご夫婦引越し',
    '学生・新生活引越し',
    '不用品回収・処分サービス',
    '家具組立・分解',
  ];

  var _bmFilter = { q: '', status: '' };

  function _bmNewRef() {
    var d = new Date();
    var ymd = String(d.getFullYear())
      + String(d.getMonth() + 1).padStart(2, '0')
      + String(d.getDate()).padStart(2, '0');
    var rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'HM-' + ymd + '-' + rand;
  }

  function _bmList() {
    var list = (window.Adapter && Adapter.getBookings) ? (Adapter.getBookings() || []) : [];
    var q = _bmFilter.q.toLowerCase();
    return list.filter(function (b) {
      if (_bmFilter.status && (b.status || '新規') !== _bmFilter.status) return false;
      if (!q) return true;
      return [b.id, b.name, b.email, b.phone, b.service, b.fromAddr, b.toAddr, b.notes]
        .some(function (v) { return String(v || '').toLowerCase().indexOf(q) >= 0; });
    });
  }

  /* ── Main render ─────────────────────────────────────────── */
  function renderBookingsManager() {
    var host = document.getElementById('view-bookings-manager');
    if (!host) return;

    host.innerHTML =
      '<div class="panel">'
      + '<div class="panel-head" style="flex-wrap:wrap;gap:10px">'
      +   '<span class="panel-title">予約管理</span>'
      +   '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-left:auto">'
      +     '<input id="bmSearch" type="text" placeholder="検索（名前・受付番号・住所…）" value="' + esc(_bmFilter.q) + '" '
      +       'style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;min-width:200px;background:transparent;color:inherit">'
      +     '<select id="bmStatusFilter" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:transparent;color:inherit">'
      +       '<option value="">全ステータス</option>'
      +       BM_STATUSES.map(function (s) {
                return '<option value="' + esc(s) + '"' + (_bmFilter.status === s ? ' selected' : '') + '>' + esc(s) + '</option>';
              }).join('')
      +     '</select>'
      +     '<button class="btn btn-ghost btn-sm" onclick="bmRefresh()">'
      +       '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>更新'
      +     '</button>'
      +     '<button class="btn btn-primary" onclick="bmOpenForm()">'
      +       '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>新規予約を追加'
      +     '</button>'
      +   '</div>'
      + '</div>'
      + '<div id="bmTableWrap"></div>'
      + '</div>'
      + '<div id="bmModalWrap"></div>';

    var search = document.getElementById('bmSearch');
    search.addEventListener('input', function () { _bmFilter.q = this.value; _bmRenderTable(); });
    document.getElementById('bmStatusFilter').addEventListener('change', function () {
      _bmFilter.status = this.value; _bmRenderTable();
    });

    _bmRenderTable();
  }

  function _bmRenderTable() {
    var wrap = document.getElementById('bmTableWrap');
    if (!wrap) return;
    var list = _bmList();

    if (!list.length) {
      wrap.innerHTML = '<p style="padding:24px 20px;color:var(--gray-1)">'
        + (_bmFilter.q || _bmFilter.status ? '条件に一致する予約がありません。' : 'まだ予約がありません。')
        + '</p>';
      return;
    }

    var head = ['受付番号', 'お名前', '連絡先', 'サービス', '希望日', 'ステータス', '受付日時', '操作']
      .map(function (h) {
        return '<th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:700;color:var(--gray-1);white-space:nowrap">' + h + '</th>';
      }).join('');

    var rows = list.map(function (b) {
      var dt = b.createdAt ? new Date(b.createdAt).toLocaleString('ja-JP') : '—';
      var contact = esc(b.email || '') + (b.email && b.phone ? '<br>' : '') + esc(b.phone || '');
      var stBadge = (typeof badge === 'function') ? badge(b.status || '新規') : esc(b.status || '新規');
      return '<tr style="border-bottom:1px solid var(--line)">'
        + '<td style="padding:10px;font-weight:700;color:var(--blue);font-size:12px;white-space:nowrap">' + esc(b.id || '—') + '</td>'
        + '<td style="padding:10px;font-weight:600">' + esc(b.name || '—') + '</td>'
        + '<td style="padding:10px;font-size:12px">' + (contact || '—') + '</td>'
        + '<td style="padding:10px">' + esc(b.service || '—') + '</td>'
        + '<td style="padding:10px;white-space:nowrap">' + esc(b.date || '未定') + (b.time ? ' ' + esc(b.time) : '') + '</td>'
        + '<td style="padding:10px">' + stBadge + '</td>'
        + '<td style="padding:10px;font-size:12px;color:var(--gray-1);white-space:nowrap">' + dt + '</td>'
        + '<td style="padding:10px;white-space:nowrap">'
        +   '<button class="btn btn-ghost btn-sm" onclick="bmOpenForm(\'' + esc(b.id) + '\')">編集</button> '
        +   '<button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="bmDelete(\'' + esc(b.id) + '\')">削除</button>'
        + '</td>'
        + '</tr>';
    }).join('');

    wrap.innerHTML = '<div class="table-wrap" style="overflow-x:auto">'
      + '<table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<thead><tr style="border-bottom:2px solid var(--line)">' + head + '</tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>'
      + '<p style="padding:10px 12px 4px;font-size:12px;color:var(--gray-1)">' + list.length + ' 件</p>';
  }

  /* ── Refresh from API ────────────────────────────────────── */
  function bmRefresh() {
    var p = (window.Adapter && Adapter.apiReady && Adapter.syncFromApi)
      ? Adapter.syncFromApi() : Promise.resolve();
    Promise.resolve(p)
      .then(function () { _bmRenderTable(); if (typeof toast === 'function') toast('予約データを更新しました'); })
      .catch(function (e) {
        console.error('[BookingsManager] sync failed:', e);
        if (typeof toast === 'function') toast('更新に失敗しました（オフライン？）');
        _bmRenderTable();
      });
  }

  /* ── Add / Edit form (modal) ─────────────────────────────── */
  function bmOpenForm(id) {
    var b = null;
    if (id) {
      b = _bmList().length ? Adapter.getBookings().find(function (x) { return x.id === id; }) : null;
      if (!b) { if (typeof toast === 'function') toast('予約が見つかりません'); return; }
      if (!b._dbId) {
        if (typeof toast === 'function') toast('サーバー同期待ちです。「更新」を押してから編集してください');
        return;
      }
    }
    var isNew = !b;
    var f = b || { id: _bmNewRef(), status: '新規' };

    function field(label, inner) {
      return '<div style="margin-bottom:12px"><label style="display:block;font-size:12px;font-weight:600;color:var(--gray-1);margin-bottom:4px">' + label + '</label>' + inner + '</div>';
    }
    var inputStyle = 'width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:transparent;color:inherit;box-sizing:border-box';

    var wrap = document.getElementById('bmModalWrap');
    if (!wrap) return;
    wrap.innerHTML =
      '<div id="bmModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)bmCloseForm()">'
      + '<div style="background:var(--bg,#fff);color:inherit;border-radius:14px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.3)">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
      +     '<strong style="font-size:15px">' + (isNew ? '新規予約を追加' : '予約を編集 — ' + esc(f.id)) + '</strong>'
      +     '<button class="btn btn-ghost btn-sm" onclick="bmCloseForm()">✕</button>'
      +   '</div>'
      +   '<input type="hidden" id="bmfRef" value="' + esc(f.id) + '">'
      +   '<input type="hidden" id="bmfMode" value="' + (isNew ? 'new' : 'edit') + '">'
      +   field('お名前 *', '<input id="bmfName" style="' + inputStyle + '" value="' + esc(f.name || '') + '">')
      +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      +     field('メール', '<input id="bmfEmail" type="email" style="' + inputStyle + '" value="' + esc(f.email || '') + '">')
      +     field('電話', '<input id="bmfPhone" style="' + inputStyle + '" value="' + esc(f.phone || '') + '">')
      +   '</div>'
      +   field('サービス',
          '<input id="bmfService" list="bmServiceList" style="' + inputStyle + '" value="' + esc(f.service || '') + '">'
          + '<datalist id="bmServiceList">'
          + BM_SERVICES.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('')
          + '</datalist>')
      +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      +     field('希望日', '<input id="bmfDate" type="date" style="' + inputStyle + '" value="' + esc(f.date || '') + '">')
      +     field('時間帯', '<input id="bmfTime" style="' + inputStyle + '" placeholder="例: 午前 / 14:00" value="' + esc(f.time || '') + '">')
      +   '</div>'
      +   field('現住所', '<input id="bmfFrom" style="' + inputStyle + '" value="' + esc(f.fromAddr || '') + '">')
      +   field('引越し先', '<input id="bmfTo" style="' + inputStyle + '" value="' + esc(f.toAddr || '') + '">')
      +   field('ステータス',
          '<select id="bmfStatus" style="' + inputStyle + '">'
          + BM_STATUSES.map(function (s) {
              return '<option value="' + esc(s) + '"' + ((f.status || '新規') === s ? ' selected' : '') + '>' + esc(s) + '</option>';
            }).join('')
          + '</select>')
      +   field('備考', '<textarea id="bmfNotes" rows="3" style="' + inputStyle + ';resize:vertical">' + esc(f.notes || '') + '</textarea>')
      +   '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">'
      +     '<button class="btn btn-ghost" onclick="bmCloseForm()">キャンセル</button>'
      +     '<button class="btn btn-primary" onclick="bmSave()">' + (isNew ? '追加する' : '保存する') + '</button>'
      +   '</div>'
      + '</div></div>';

    var nameEl = document.getElementById('bmfName');
    if (nameEl) nameEl.focus();
  }

  function bmCloseForm() {
    var wrap = document.getElementById('bmModalWrap');
    if (wrap) wrap.innerHTML = '';
  }

  function bmSave() {
    var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    var name = v('bmfName');
    if (!name) {
      var el = document.getElementById('bmfName');
      if (el) { el.style.borderColor = 'var(--red)'; el.focus(); }
      if (typeof toast === 'function') toast('お名前は必須です');
      return;
    }
    var email = v('bmfEmail');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (typeof toast === 'function') toast('メールアドレスの形式が正しくありません');
      return;
    }

    var patch = {
      name: name, email: email, phone: v('bmfPhone'),
      service: v('bmfService'), date: v('bmfDate'), time: v('bmfTime'),
      fromAddr: v('bmfFrom'), toAddr: v('bmfTo'),
      status: v('bmfStatus') || '新規', notes: v('bmfNotes'),
    };
    var ref    = v('bmfRef');
    var isNew  = v('bmfMode') === 'new';

    if (isNew) {
      var booking = Object.assign({ id: ref, createdAt: new Date().toISOString() }, patch);
      Adapter.addBooking(booking);
      if (typeof toast === 'function') toast('予約を追加しました: ' + ref);
      // The insert is async and the local row has no _dbId yet — re-sync
      // shortly so edits/deletes on the new row reach the server.
      setTimeout(function () {
        if (Adapter.apiReady && Adapter.syncFromApi) {
          Adapter.syncFromApi().then(_bmRenderTable).catch(function () {});
        }
      }, 1500);
    } else {
      Adapter.updateBooking(ref, patch);
      if (typeof toast === 'function') toast('予約を保存しました');
    }

    bmCloseForm();
    _bmRenderTable();
  }

  /* ── Delete ──────────────────────────────────────────────── */
  function bmDelete(id) {
    var b = Adapter.getBookings().find(function (x) { return x.id === id; });
    if (!b) return;
    if (!confirm('予約「' + (b.name || id) + '（' + id + '）」を削除しますか？\nこの操作は取り消せません。')) return;
    Adapter.deleteBooking(id);
    if (typeof toast === 'function') toast('予約を削除しました');
    _bmRenderTable();
  }

  /* ── Expose (codebase idiom: onclick globals) ────────────── */
  window.renderBookingsManager = renderBookingsManager;
  window.bmRefresh   = bmRefresh;
  window.bmOpenForm  = bmOpenForm;
  window.bmCloseForm = bmCloseForm;
  window.bmSave      = bmSave;
  window.bmDelete    = bmDelete;
}());
