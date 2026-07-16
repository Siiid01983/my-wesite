/* ════════════════════════════════════════════════════════════════════════════
   customers.js — M3 Customers (/ops/customers.html)

   READ-ONLY. Derives a customer directory from the bookings table (grouped by
   email, falling back to phone) — the same lazy-computation approach as
   hm-api/customer-profile.php, but admin-scoped across all customers. No writes.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, Api = Ops.Api;

  var state = { customers: [], q: '' };
  var sheet;

  function buildCustomers(bookings) {
    var map = {};
    bookings.forEach(function (b) {
      var key = (b.email || '').toLowerCase() || ('tel:' + b.phone) || ('name:' + b.name);
      if (!key) return;
      if (!map[key]) map[key] = { key: key, name: b.name, email: b.email, phone: b.phone, bookings: [] };
      var c = map[key];
      c.bookings.push(b);
      if (!c.name && b.name) c.name = b.name;
      if (!c.email && b.email) c.email = b.email;
      if (!c.phone && b.phone) c.phone = b.phone;
    });
    var list = Object.keys(map).map(function (k) {
      var c = map[k];
      c.bookings.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      c.total = c.bookings.length;
      c.last = c.bookings[0];
      c.first = c.bookings[c.bookings.length - 1];
      // Favorite service = most frequent among this customer's bookings.
      var freq = {}; var fav = ''; var best = 0;
      c.bookings.forEach(function (b) { if (!b.service) return; freq[b.service] = (freq[b.service] || 0) + 1; if (freq[b.service] > best) { best = freq[b.service]; fav = b.service; } });
      c.favorite = fav;
      return c;
    });
    // Sort by most recent activity.
    list.sort(function (a, b) { return (b.last.date || '').localeCompare(a.last.date || ''); });
    return list;
  }

  function apply() {
    var q = state.q.trim().toLowerCase();
    if (!q) return state.customers;
    return state.customers.filter(function (c) {
      return ((c.name || '') + ' ' + (c.email || '') + ' ' + (c.phone || '')).toLowerCase().indexOf(q) >= 0;
    });
  }

  function row(c) {
    return '<div class="ops-row tap" data-open="' + U.esc(c.key) + '">' +
      '<div class="ops-avatar">' + U.initials(c.name) + '</div>' +
      '<div class="ops-row-main">' +
        '<div class="ops-row-title">' + U.esc(c.name || '（名称未設定）') + '様</div>' +
        '<div class="ops-row-sub">' + (c.email ? U.esc(c.email) : U.esc(c.phone || '')) + '</div>' +
      '</div>' +
      '<div class="ops-row-end"><span class="ops-badge-status st-confirm">' + c.total + '件</span>' +
        '<span class="ops-row-meta">最終 ' + U.fmtDate(c.last.date) + '</span></div>' +
    '</div>';
  }

  function renderList() {
    var host = document.getElementById('ops-list');
    if (!host) return;
    var list = apply();
    host.innerHTML = list.length
      ? list.map(row).join('')
      : UI.empty('顧客が見つかりません', state.q ? '検索条件を変えてお試しください' : '予約が入ると顧客が表示されます', 'customers');
    host.querySelectorAll('[data-open]').forEach(function (r) {
      r.addEventListener('click', function () { openProfile(r.getAttribute('data-open')); });
    });
  }

  function renderShell() {
    var el = document.getElementById('ops-content');
    el.innerHTML =
      '<div class="ops-search">' + UI.icon('search') +
        '<input id="ops-q" type="search" placeholder="名前・メール・電話で検索" autocomplete="off" />' +
      '</div>' +
      '<div class="ops-muted" style="font-size:.78rem;font-weight:600;margin:0 2px 10px">' + state.customers.length + ' 名の顧客</div>' +
      '<div id="ops-list"></div>';
    var q = document.getElementById('ops-q');
    q.value = state.q;
    q.addEventListener('input', U.debounce(function () { state.q = q.value; renderList(); }, 200));
    renderList();
  }

  function kv(k, v) { return v ? '<div class="ops-kv"><span class="k">' + k + '</span><span class="v">' + U.esc(v) + '</span></div>' : ''; }

  function historyRow(b) {
    return '<a class="ops-row tap" href="bookings.html?ref=' + encodeURIComponent(b.ref) + '" style="margin-bottom:8px">' +
      '<div class="ops-row-main">' +
        '<div class="ops-row-title" style="font-size:.9rem">' + U.esc(b.service || 'ご予約') + '</div>' +
        '<div class="ops-row-sub">' + U.fmtDate(b.date) + ' · ' + U.esc(b.ref) + '</div>' +
      '</div>' +
      '<div class="ops-row-end">' + UI.statusBadge(b.status) + '</div>' +
    '</a>';
  }

  function openProfile(key) {
    var c = state.customers.filter(function (x) { return x.key === key; })[0];
    if (!c) return;
    var latest = c.last;
    var html =
      '<h2>' + U.esc(c.name || '（名称未設定）') + '様</h2>' +
      '<div class="ops-muted" style="margin:0 0 14px;font-size:.86rem">' + (c.email ? U.esc(c.email) : U.esc(c.phone || '')) + '</div>' +

      '<div class="ops-stat-grid" style="margin-bottom:14px">' +
        '<div class="ops-stat"><div class="ops-stat-num">' + c.total + '</div><div class="ops-stat-label">予約回数</div></div>' +
        '<div class="ops-stat"><div class="ops-stat-num" style="font-size:1.15rem;padding-top:8px">' + U.fmtDate(c.last.date) + '</div><div class="ops-stat-label">最終予約</div></div>' +
      '</div>' +

      '<div class="ops-card" style="margin:0 0 14px;padding:4px 14px">' +
        kv('メール', c.email) +
        kv('電話', c.phone) +
        kv('よく使うサービス', c.favorite) +
        kv('初回予約', U.fmtDateFull(c.first.date)) +
        kv('最終予約', U.fmtDateFull(c.last.date)) +
      '</div>' +

      '<div class="ops-section-title" style="margin:4px 2px 8px">予約履歴</div>' +
      c.bookings.map(historyRow).join('') +

      '<div class="ops-btn-row" style="margin-top:14px">' +
        (c.phone ? '<a class="ops-btn ghost" href="tel:' + U.esc(c.phone) + '">' + UI.icon('phone') + '電話</a>' : '') +
        '<a class="ops-btn" href="chat.html?booking=' + encodeURIComponent(latest.dbId) + '&ref=' + encodeURIComponent(latest.ref) + '">' + UI.icon('chat') + 'チャット</a>' +
      '</div>';
    sheet.open(html);
  }

  function load() {
    var el = document.getElementById('ops-content');
    el.innerHTML = UI.skeleton(6);
    Api.listBookings().then(function (r) {
      state.customers = buildCustomers(r.data || []);
      renderShell();
      if (r.error && !state.customers.length) {
        el.insertAdjacentHTML('afterbegin', '<div class="ops-card" style="border-color:var(--st-cancel);color:var(--st-cancel);font-size:.85rem">データの取得に失敗しました。</div>');
      }
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: 'customers', title: '顧客' });
    sheet = UI.sheet();
    load();
  });
})();
