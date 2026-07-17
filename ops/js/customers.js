/* ════════════════════════════════════════════════════════════════════════════
   customers.js — M3 Customers (/ops/customers.html)

   Customer directory · live search · profile sheet · paginated booking history ·
   booking-details sheet (incl. the mandatory 搬送家具・荷物一覧 inventory) ·
   quick actions (chat / view bookings / rebook).

   READ-ONLY. The admin directory is derived from the bookings table via the
   existing rest.php read (Api.listBookings) — the same underlying source that
   customer_profiles / customer-profile.php compute from. Those endpoints are
   ownership-gated single-customer public reads (email+reference) and cannot
   enumerate customers, so they can't back an admin directory. No writes, no new
   tables. Rebook reuses the Portal V2 handoff (hm_rebook_prefill → rebook-receiver
   → openBookingApp); the BA overlay / Booking Engine are never modified.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, Api = Ops.Api;

  var HIST_PER = 10;
  var state = { customers: [], q: '', error: false, cur: null, histShown: HIST_PER };
  var profileSheet, detailSheet;

  /* ── Build a customer directory from bookings (group by email → phone → name) ─ */
  function buildCustomers(bookings) {
    var map = {};
    bookings.forEach(function (b) {
      var key = (b.email || '').toLowerCase() || (b.phone ? 'tel:' + b.phone : '') || (b.name ? 'name:' + b.name : '');
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
      var freq = {}, fav = '', best = 0;
      c.bookings.forEach(function (b) {
        if (!b.service) return;
        freq[b.service] = (freq[b.service] || 0) + 1;
        if (freq[b.service] > best) { best = freq[b.service]; fav = b.service; }
      });
      c.favorite = fav;
      return c;
    });
    list.sort(function (a, b) { return (b.last.date || '').localeCompare(a.last.date || ''); });  // newest activity first
    return list;
  }

  function byKey(key) { return state.customers.filter(function (x) { return x.key === key; })[0]; }

  function apply() {
    var q = state.q.trim().toLowerCase();
    if (!q) return state.customers;
    return state.customers.filter(function (c) {
      return ((c.name || '') + ' ' + (c.email || '') + ' ' + (c.phone || '')).toLowerCase().indexOf(q) >= 0;
    });
  }

  /* ── List ─────────────────────────────────────────────────────────────────── */
  function row(c) {
    return '<div class="ops-row tap" data-open="' + U.esc(c.key) + '">' +
      '<div class="ops-avatar">' + U.initials(c.name) + '</div>' +
      '<div class="ops-row-main">' +
        '<div class="ops-row-title">' + U.esc(c.name || '（名称未設定）') + '様</div>' +
        '<div class="ops-row-sub">' + U.esc(c.email || c.phone || '') + '</div>' +
      '</div>' +
      '<div class="ops-row-end">' +
        '<span class="ops-badge-status st-confirm">' + c.total + '件</span>' +
        '<span class="ops-row-meta">最終 ' + U.fmtDate(c.last.date) + '</span>' +
      '</div>' +
    '</div>';
  }

  function emptyState() {
    return '<div class="ops-empty">' + UI.icon('customers') +
      '<h3>顧客情報がありません</h3>' +
      '<p>' + (state.q ? '検索条件を変えてお試しください' : '予約が入ると顧客が表示されます') + '</p>' +
      (!state.q ? '<a class="ops-btn ghost" href="index.html">ダッシュボードへ戻る</a>' : '') +
    '</div>';
  }

  function errorState() {
    return '<div class="ops-empty">' + UI.icon('empty') +
      '<h3>顧客情報を取得できません</h3>' +
      '<p>接続を確認して、もう一度お試しください。</p>' +
      '<button class="ops-btn" id="cust-retry" style="margin-top:14px">再試行</button>' +
    '</div>';
  }

  function renderList() {
    var host = document.getElementById('ops-list');
    if (!host) return;
    var list = apply();
    host.innerHTML = list.length ? list.map(row).join('') : emptyState();
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
  function section(title, body) { return '<div class="ops-section-title" style="margin:16px 2px 8px">' + title + '</div><div class="ops-card" style="margin:0;padding:4px 14px">' + body + '</div>'; }

  /* ── Profile sheet ────────────────────────────────────────────────────────── */
  function openProfile(key) {
    var c = byKey(key);
    if (!c) return;
    state.cur = c;
    state.histShown = HIST_PER;
    renderProfile();
  }

  function renderProfile() {
    var c = state.cur;
    var latest = c.last;
    var html =
      '<h2>' + U.esc(c.name || '（名称未設定）') + '様</h2>' +
      '<div class="ops-muted" style="margin:0 0 14px;font-size:.86rem">' + U.esc(c.email || c.phone || '') + '</div>' +

      '<div class="ops-stat-grid" style="margin-bottom:14px">' +
        '<div class="ops-stat"><div class="ops-stat-num">' + c.total + '</div><div class="ops-stat-label">予約回数</div></div>' +
        '<div class="ops-stat"><div class="ops-stat-num" style="font-size:1.15rem;padding-top:8px">' + U.fmtDate(c.last.date) + '</div><div class="ops-stat-label">最終予約</div></div>' +
      '</div>' +

      '<div class="ops-card" style="margin:0 0 4px;padding:4px 14px">' +
        kv('メール', c.email) +
        kv('電話', c.phone) +
        kv('よく使うサービス', c.favorite) +
        kv('初回予約', U.fmtDateFull(c.first.date)) +
        kv('最終予約', U.fmtDateFull(c.last.date)) +
      '</div>' +

      '<div class="ops-section-title" style="margin:16px 2px 8px">予約履歴（' + c.total + '）</div>' +
      '<div id="cust-hist"></div>' +

      '<div class="ops-btn-row" style="margin-top:16px">' +
        (c.phone ? '<a class="ops-btn ghost" href="tel:' + U.esc(c.phone) + '">' + UI.icon('phone') + '電話</a>' : '') +
        '<a class="ops-btn ghost" href="chat.html?booking=' + encodeURIComponent(latest.dbId) + '&ref=' + encodeURIComponent(latest.ref) + '">' + UI.icon('chat') + 'チャット</a>' +
      '</div>' +
      '<div class="ops-btn-row" style="margin-top:8px">' +
        '<a class="ops-btn ghost" href="bookings.html?ref=' + encodeURIComponent(latest.ref) + '">' + UI.icon('bookings') + '予約を見る</a>' +
        '<button class="ops-btn sage" data-act="rebook">' + UI.icon('calendar') + '再予約</button>' +
      '</div>';

    profileSheet.open(html);
    renderHistory();
    var rb = profileSheet.el.querySelector('[data-act="rebook"]');
    if (rb) rb.addEventListener('click', function () { rebook(c); });
  }

  function historyRow(b) {
    return '<div class="ops-row tap" data-bk="' + U.esc(b.dbId) + '" style="margin-bottom:8px">' +
      '<div class="ops-row-main">' +
        '<div class="ops-row-title" style="font-size:.9rem">' + U.esc(b.service || 'ご予約') + '</div>' +
        '<div class="ops-row-sub">' + U.fmtDate(b.date) + ' · ' + U.esc(b.ref) + '</div>' +
      '</div>' +
      '<div class="ops-row-end">' + UI.statusBadge(b.status) + '</div>' +
    '</div>';
  }

  function renderHistory() {
    var c = state.cur;
    var host = profileSheet.el.querySelector('#cust-hist');
    if (!host) return;
    var slice = c.bookings.slice(0, state.histShown);
    host.innerHTML = slice.map(historyRow).join('') +
      (state.histShown < c.bookings.length
        ? '<button class="ops-btn ghost cust-more" id="cust-more">もっと見る（残り' + (c.bookings.length - state.histShown) + '件）</button>'
        : '');
    host.querySelectorAll('[data-bk]').forEach(function (r) {
      r.addEventListener('click', function () { openBookingDetail(r.getAttribute('data-bk')); });
    });
    var more = host.querySelector('#cust-more');
    if (more) more.addEventListener('click', function () { state.histShown += HIST_PER; renderHistory(); });
  }

  /* ── Booking-details sheet (incl. mandatory inventory) ────────────────────── */
  function inventoryHtml(items) {
    if (!items || !items.length) return '<p class="cust-none">家具情報はありません</p>';
    return '<div class="cust-chips">' + items.map(function (it) {
      return '<span class="cust-chip">' + U.esc(it) + '</span>';
    }).join('') + '</div>';
  }

  function openBookingDetail(dbId) {
    var b = state.cur.bookings.filter(function (x) { return String(x.dbId) === String(dbId); })[0];
    if (!b) return;

    var html =
      '<h2>予約詳細</h2>' +
      '<div class="ops-muted" style="margin:0 0 6px;font-size:.86rem">受付番号 ' + U.esc(b.ref) + ' · ' + UI.statusBadge(b.status) + '</div>' +

      section('お客様情報', kv('お名前', (b.name || '') && b.name + '様') + kv('電話', b.phone) + kv('メール', b.email)) +

      section('引越し情報',
        kv('受付番号', b.ref) +
        kv('サービス', b.service) +
        kv('引越し日', U.fmtDateFull(b.date)) +
        (b.time ? kv('時間帯', b.time) : '') +
        kv('ステータス', b.status)) +

      section('住所', (kv('現住所', b.fromAddr) + kv('引越し先', b.toAddr)) || '<p class="cust-none" style="margin:6px 0">住所情報はありません</p>') +

      ((b.notes || b.internalNotes)
        ? section('メモ', kv('お客様メモ', b.notes) + kv('社内メモ', b.internalNotes))
        : '') +

      '<div class="ops-section-title" style="margin:16px 2px 8px">搬送家具・荷物一覧</div>' +
      inventoryHtml(b.items);

    detailSheet.open(html);
  }

  /* ── Rebook — Portal V2 handoff (never modifies the BA overlay) ───────────── */
  function rebook(c) {
    var latest = c.last;
    try {
      sessionStorage.setItem('hm_rebook_prefill', JSON.stringify({
        service: latest.service || '',
        fromAddr: latest.fromAddr || '',
        toAddr: latest.toAddr || '',
        notes: latest.notes || '',
        items: (latest.items && latest.items.length) ? latest.items : null,
        ts: Date.now(),
      }));
    } catch (e) {}
    UI.toast('再予約画面を開いています…');
    location.href = '../index.html';
  }

  /* ── Load ─────────────────────────────────────────────────────────────────── */
  function load() {
    var el = document.getElementById('ops-content');
    el.innerHTML = UI.skeleton(6);
    state.error = false;
    Api.listBookings().then(function (r) {
      if (r.error && !(r.data && r.data.length)) {
        state.error = true;
        el.innerHTML = errorState();
        var rt = document.getElementById('cust-retry');
        if (rt) rt.addEventListener('click', load);
        return;
      }
      state.customers = buildCustomers(r.data || []);
      renderShell();
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: 'customers', title: '顧客' });
    profileSheet = UI.sheet();
    detailSheet = UI.sheet();
    load();
  });
})();
