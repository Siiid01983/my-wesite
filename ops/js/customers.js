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
        '<div class="ops-row-title">' + U.esc(c.name || t('customers.unnamed')) + t('common.honorific') + '</div>' +
        '<div class="ops-row-sub">' + U.esc(c.email || c.phone || '') + '</div>' +
      '</div>' +
      '<div class="ops-row-end">' +
        '<span class="ops-badge-status st-confirm">' + c.total + t('customers.bookingCountUnit') + '</span>' +
        '<span class="ops-row-meta">' + t('customers.lastPrefix') + ' ' + U.fmtDate(c.last.date) + '</span>' +
      '</div>' +
    '</div>';
  }

  function emptyState() {
    return '<div class="ops-empty">' + UI.icon('customers') +
      '<h3>' + (state.q ? t('customers.notFound') : t('customers.empty')) + '</h3>' +
      '<p>' + (state.q ? t('bookings.emptyFilteredSub') : t('customers.emptySub')) + '</p>' +
      (!state.q ? '<a class="ops-btn ghost" href="index.html">' + t('dashboard.backToDashboard') + '</a>' : '') +
    '</div>';
  }

  function errorState() {
    return '<div class="ops-empty">' + UI.icon('empty') +
      '<h3>' + t('customers.errorTitle') + '</h3>' +
      '<p>' + t('bookings.errorSub') + '</p>' +
      '<button class="ops-btn" id="cust-retry" style="margin-top:14px">' + t('common.retry') + '</button>' +
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
        '<input id="ops-q" type="search" placeholder="' + t('customers.searchPh') + '" autocomplete="off" />' +
      '</div>' +
      '<div class="ops-muted" style="font-size:.78rem;font-weight:600;margin:0 2px 10px">' + t('customers.count', { n: state.customers.length }) + '</div>' +
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
      '<h2>' + U.esc(c.name || t('customers.unnamed')) + t('common.honorific') + '</h2>' +
      '<div class="ops-muted" style="margin:0 0 14px;font-size:.86rem">' + U.esc(c.email || c.phone || '') + '</div>' +

      '<div class="ops-stat-grid" style="margin-bottom:14px">' +
        '<div class="ops-stat"><div class="ops-stat-num">' + c.total + '</div><div class="ops-stat-label">' + t('customers.bookingCount') + '</div></div>' +
        '<div class="ops-stat"><div class="ops-stat-num" style="font-size:1.15rem;padding-top:8px">' + U.fmtDate(c.last.date) + '</div><div class="ops-stat-label">' + t('customers.lastBooking') + '</div></div>' +
      '</div>' +

      '<div class="ops-card" style="margin:0 0 4px;padding:4px 14px">' +
        kv(t('bookings.email'), c.email) +
        kv(t('bookings.phone'), c.phone) +
        kv(t('customers.favoriteService'), c.favorite) +
        kv(t('customers.firstBooking'), U.fmtDateFull(c.first.date)) +
        kv(t('customers.lastBooking'), U.fmtDateFull(c.last.date)) +
      '</div>' +

      '<div class="ops-section-title" style="margin:16px 2px 8px">' + t('customers.history') + '（' + c.total + '）</div>' +
      '<div id="cust-hist"></div>' +

      '<div class="ops-btn-row" style="margin-top:16px">' +
        (c.phone ? '<a class="ops-btn ghost" href="tel:' + U.esc(c.phone) + '">' + UI.icon('phone') + t('bookings.call') + '</a>' : '') +
        '<a class="ops-btn ghost" href="chat.html?booking=' + encodeURIComponent(latest.dbId) + '&ref=' + encodeURIComponent(latest.ref) + '">' + UI.icon('chat') + t('bookings.chat') + '</a>' +
      '</div>' +
      '<div class="ops-btn-row" style="margin-top:8px">' +
        '<a class="ops-btn ghost" href="bookings.html?ref=' + encodeURIComponent(latest.ref) + '">' + UI.icon('bookings') + t('customers.viewBookings') + '</a>' +
        '<button class="ops-btn sage" data-act="rebook">' + UI.icon('calendar') + t('customers.rebook') + '</button>' +
      '</div>';

    profileSheet.open(html);
    renderHistory();
    var rb = profileSheet.el.querySelector('[data-act="rebook"]');
    if (rb) rb.addEventListener('click', function () { rebook(c); });
  }

  function historyRow(b) {
    return '<div class="ops-row tap" data-bk="' + U.esc(b.dbId) + '" style="margin-bottom:8px">' +
      '<div class="ops-row-main">' +
        '<div class="ops-row-title" style="font-size:.9rem">' + U.esc(b.service || t('common.booking')) + '</div>' +
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
        ? '<button class="ops-btn ghost cust-more" id="cust-more">' + t('common.more') + '（' + (c.bookings.length - state.histShown) + '）</button>'
        : '');
    host.querySelectorAll('[data-bk]').forEach(function (r) {
      r.addEventListener('click', function () { openBookingDetail(r.getAttribute('data-bk')); });
    });
    var more = host.querySelector('#cust-more');
    if (more) more.addEventListener('click', function () { state.histShown += HIST_PER; renderHistory(); });
  }

  /* ── Booking-details sheet (incl. mandatory inventory) ────────────────────── */
  function inventoryHtml(items) {
    if (!items || !items.length) return '<p class="cust-none">' + t('furniture.none') + '</p>';
    return '<div class="cust-chips">' + items.map(function (it) {
      return '<span class="cust-chip">' + U.esc(it) + '</span>';
    }).join('') + '</div>';
  }

  function openBookingDetail(dbId) {
    var b = state.cur.bookings.filter(function (x) { return String(x.dbId) === String(dbId); })[0];
    if (!b) return;

    var html =
      '<h2>' + t('customers.detailTitle') + '</h2>' +
      '<div class="ops-muted" style="margin:0 0 6px;font-size:.86rem">' + t('bookings.receiptNo') + ' ' + U.esc(b.ref) + ' · ' + UI.statusBadge(b.status) + '</div>' +

      section(t('customers.customerInfo'), kv(t('customers.name'), (b.name || '') && b.name + t('common.honorific')) + kv(t('bookings.phone'), b.phone) + kv(t('bookings.email'), b.email)) +

      section(t('customers.movingInfo'),
        kv(t('bookings.receiptNo'), b.ref) +
        kv(t('bookings.service'), b.service) +
        kv(t('bookings.moveDate'), U.fmtDateFull(b.date)) +
        (b.time ? kv(t('bookings.timeSlot'), b.time) : '') +
        kv(t('common.status'), t('status.' + Ops.toDbStatus(b.status)))) +

      section(t('customers.addresses'), (kv(t('customers.currentAddr'), Ops.addrText(b, 'from')) + kv(t('customers.destAddr'), Ops.addrText(b, 'to'))) || '<p class="cust-none" style="margin:6px 0">' + t('customers.noAddr') + '</p>') +
      Ops.addrExtraHtml(b) +

      ((b.notes || b.internalNotes)
        ? section(t('customers.memo'), kv(t('customers.custMemo'), b.notes) + kv(t('customers.internalMemo'), b.internalNotes))
        : '') +

      '<div class="ops-section-title" style="margin:16px 2px 8px">' + t('furniture.title') + '</div>' +
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
    UI.toast(t('customers.rebookOpening'));
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
    UI.mountChrome({ active: 'customers', title: t('customers.title') });
    profileSheet = UI.sheet();
    detailSheet = UI.sheet();
    load();
  });
})();
