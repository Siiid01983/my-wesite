/* ════════════════════════════════════════════════════════════════════════════
   bookings.js — M2 Bookings (/ops/bookings.html)

   List · search · filter by status · view detail · change status · open chat ·
   call customer. Reads via rest.php (bookings); the ONLY write is a status change
   (bookings.status), which the admin panel already performs the same way — no
   booking-engine, slot, or pricing logic is touched.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, Api = Ops.Api;

  var state = { all: [], filter: 'all', q: '' };
  var sheet;

  var FILTERS = [
    { key: 'all', label: 'すべて' },
    { key: '新規', label: '新規' },
    { key: '確認中', label: '確認中' },
    { key: '確定', label: '確定' },
    { key: '完了', label: '完了' },
    { key: 'キャンセル', label: 'キャンセル' },
  ];

  function apply() {
    var q = state.q.trim().toLowerCase();
    return state.all.filter(function (b) {
      if (state.filter !== 'all' && b.status !== state.filter) return false;
      if (!q) return true;
      return (b.name + ' ' + b.ref + ' ' + b.email + ' ' + b.phone + ' ' + b.service + ' ' + b.date).toLowerCase().indexOf(q) >= 0;
    });
  }

  function row(b) {
    return '<div class="ops-row tap" data-open="' + U.esc(b.dbId) + '">' +
      '<div class="ops-avatar">' + U.initials(b.name) + '</div>' +
      '<div class="ops-row-main">' +
        '<div class="ops-row-title">' + U.esc(b.name) + '様</div>' +
        '<div class="ops-row-sub">' + U.esc(b.service || 'ご予約') + ' · ' + U.fmtDate(b.date) + (b.time ? ' ' + U.esc(b.time) : '') + '</div>' +
      '</div>' +
      '<div class="ops-row-end">' + UI.statusBadge(b.status) + '<span class="ops-row-meta">' + U.esc(b.ref) + '</span></div>' +
    '</div>';
  }

  function renderList() {
    var list = apply();
    var host = document.getElementById('ops-list');
    if (!host) return;
    host.innerHTML = list.length
      ? list.map(row).join('')
      : UI.empty('該当する予約がありません', state.q ? '検索条件を変えてお試しください' : 'まだ予約がありません', 'bookings');
    host.querySelectorAll('[data-open]').forEach(function (r) {
      r.addEventListener('click', function () { openDetail(r.getAttribute('data-open')); });
    });
  }

  function renderShell() {
    var el = document.getElementById('ops-content');
    el.innerHTML =
      '<div class="ops-search">' + UI.icon('search') +
        '<input id="ops-q" type="search" placeholder="名前・受付番号・電話で検索" autocomplete="off" />' +
      '</div>' +
      '<div class="ops-filters" id="ops-filters">' +
        FILTERS.map(function (f) {
          var count = f.key === 'all' ? state.all.length : state.all.filter(function (b) { return b.status === f.key; }).length;
          return '<button class="ops-chip' + (state.filter === f.key ? ' active' : '') + '" data-f="' + f.key + '">' + f.label + ' (' + count + ')</button>';
        }).join('') +
      '</div>' +
      '<div id="ops-list"></div>';

    var q = document.getElementById('ops-q');
    q.value = state.q;
    q.addEventListener('input', U.debounce(function () { state.q = q.value; renderList(); }, 200));
    document.getElementById('ops-filters').querySelectorAll('[data-f]').forEach(function (c) {
      c.addEventListener('click', function () { state.filter = c.getAttribute('data-f'); renderShell(); });
    });
    renderList();
  }

  function kv(k, v) { return v ? '<div class="ops-kv"><span class="k">' + k + '</span><span class="v">' + U.esc(v) + '</span></div>' : ''; }

  function openDetail(dbId) {
    var b = state.all.filter(function (x) { return String(x.dbId) === String(dbId); })[0];
    if (!b) return;

    var addr = '';
    if (b.fromAddr || b.toAddr) {
      addr = (b.fromAddr ? '<div class="ops-kv"><span class="k">出発</span><span class="v">' + U.esc(b.fromAddr) + '</span></div>' : '') +
             (b.toAddr ? '<div class="ops-kv"><span class="k">到着</span><span class="v">' + U.esc(b.toAddr) + '</span></div>' : '');
    }
    var items = b.items && b.items.length ? '<div class="ops-kv"><span class="k">荷物</span><span class="v">' + U.esc(b.items.join('、')) + '</span></div>' : '';

    var statusChips = Ops.STATUSES.map(function (s) {
      return '<button class="ops-chip' + (b.status === s ? ' active' : '') + '" data-st="' + s + '">' + s + '</button>';
    }).join('');

    var html =
      '<h2>' + U.esc(b.name) + '様</h2>' +
      '<div class="ops-muted" style="margin:0 0 14px;font-size:.86rem">受付番号 ' + U.esc(b.ref) + ' · ' + UI.statusBadge(b.status) + '</div>' +

      '<div class="ops-card" style="margin:0 0 14px;padding:4px 14px">' +
        kv('引越し日', U.fmtDateFull(b.date)) +
        (b.time ? kv('時間帯', b.time) : '') +
        kv('サービス', b.service) +
        (b.workers ? kv('作業員', b.workers) : '') +
        addr + items +
        kv('メール', b.email) +
        kv('電話', b.phone) +
        (b.notes ? kv('備考', b.notes) : '') +
        kv('受付日時', U.fmtDateFull(b.createdAt)) +
      '</div>' +

      '<div class="ops-section-title" style="margin:4px 2px 8px">ステータス変更</div>' +
      '<div class="ops-filters" id="ops-st" style="margin-bottom:16px">' + statusChips + '</div>' +

      '<div class="ops-btn-row">' +
        (b.phone ? '<a class="ops-btn ghost" href="tel:' + U.esc(b.phone) + '">' + UI.icon('phone') + '電話</a>' : '') +
        '<a class="ops-btn" href="chat.html?booking=' + encodeURIComponent(b.dbId) + '&ref=' + encodeURIComponent(b.ref) + '">' + UI.icon('chat') + 'チャット</a>' +
      '</div>';

    sheet.open(html);
    sheet.el.querySelectorAll('#ops-st [data-st]').forEach(function (c) {
      c.addEventListener('click', function () { changeStatus(b, c.getAttribute('data-st')); });
    });
  }

  function changeStatus(b, newStatus) {
    if (b.status === newStatus) return;
    var prev = b.status;
    b.status = newStatus; b.statusRaw = Ops.toDbStatus(newStatus);   // optimistic
    renderList();
    openDetail(b.dbId);
    UI.toast('更新中…');
    Api.updateBookingStatus(b.dbId, newStatus).then(function (res) {
      if (res.error) {
        b.status = prev; b.statusRaw = Ops.toDbStatus(prev);   // rollback
        renderList(); openDetail(b.dbId);
        UI.toast('更新に失敗しました：' + (res.error.message || ''));
      } else {
        UI.toast(b.name + '様を「' + newStatus + '」に変更しました');
      }
    });
  }

  function load() {
    var el = document.getElementById('ops-content');
    el.innerHTML = UI.skeleton(6);
    Api.listBookings().then(function (r) {
      state.all = r.data || [];
      Ops.Notify.syncBookings(state.all);
      UI.setBell(Ops.Notify.unreadCount());
      renderShell();
      if (r.error && !state.all.length) {
        el.insertAdjacentHTML('afterbegin', '<div class="ops-card" style="border-color:var(--st-cancel);color:var(--st-cancel);font-size:.85rem">データの取得に失敗しました。</div>');
      }
      // Deep-link: ?ref= opens that booking.
      var ref = new URLSearchParams(location.search).get('ref');
      if (ref) {
        var m = state.all.filter(function (b) { return b.ref === ref; })[0];
        if (m) openDetail(m.dbId);
      }
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: 'bookings', title: '予約管理' });
    sheet = UI.sheet();
    load();
  });
})();
