/* ════════════════════════════════════════════════════════════════════════════
   bookings.js — M2 Bookings (/ops/bookings.html)

   List (newest-first, infinite scroll) · search · status filters · detail sheet
   (read-only) · quick actions (call / chat / calendar slot) · guided status change.
   Reads via rest.php (bookings); the ONLY write is a status change, exactly as the
   admin panel performs it. No booking-engine, slot, or pricing logic is touched.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, Api = Ops.Api;

  var PAGE = 20;
  var state = { all: [], filter: 'all', q: '', shown: PAGE, error: false };
  var sheet, io;

  var FILTERS = [
    { key: 'all', label: 'bookings.f.all' },
    { key: '新規', label: 'bookings.f.new' },
    { key: '確認中', label: 'bookings.f.checking' },
    { key: '確定', label: 'bookings.f.confirmed' },
    { key: '完了', label: 'bookings.f.completed' },
    { key: 'キャンセル', label: 'bookings.f.cancelled' },
  ];

  // Guided forward transitions; Cancel is allowed from any non-cancelled status.
  var NEXT = { '新規': ['確認中'], '確認中': ['確定'], '確定': ['完了'], '完了': [], 'キャンセル': [] };

  function apply() {
    var q = state.q.trim().toLowerCase();
    return state.all.filter(function (b) {
      if (state.filter !== 'all' && b.status !== state.filter) return false;
      if (!q) return true;
      return (b.ref + ' ' + b.name + ' ' + b.phone + ' ' + b.email).toLowerCase().indexOf(q) >= 0;
    });
  }

  function card(b) {
    return '<div class="ops-row tap bk-card" data-open="' + U.esc(b.dbId) + '">' +
      '<div class="ops-avatar">' + U.initials(b.name) + '</div>' +
      '<div class="ops-row-main">' +
        '<div class="bk-ref">' + U.esc(b.ref) + '</div>' +
        '<div class="bk-name">' + U.esc(b.name) + t('common.honorific') + '</div>' +
        '<div class="bk-meta">' + U.fmtDate(b.date) + ' · ' + U.esc(b.service || t('common.booking')) + '</div>' +
      '</div>' +
      '<div class="ops-row-end">' + UI.statusBadge(b.status) + '</div>' +
    '</div>';
  }

  function renderList() {
    var host = document.getElementById('ops-list');
    if (!host) return;
    var list = apply();
    if (!list.length) { host.innerHTML = emptyState(); bindEmpty(host); return; }
    var slice = list.slice(0, state.shown);
    host.innerHTML = slice.map(card).join('') +
      (state.shown < list.length ? '<div class="bk-sentinel" id="bk-more"><div class="ops-spin" style="margin:0 auto;display:block"></div></div>' : '');
    host.querySelectorAll('[data-open]').forEach(function (r) { r.addEventListener('click', function () { openDetail(r.getAttribute('data-open')); }); });
    observeMore();
  }

  function observeMore() {
    if (io) io.disconnect();
    var sentinel = document.getElementById('bk-more');
    if (!sentinel) return;
    io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { state.shown += PAGE; renderList(); }
    }, { rootMargin: '200px' });
    io.observe(sentinel);
  }

  function emptyState() {
    return '<div class="ops-empty">' + UI.icon('bookings') +
      '<h3>' + t('bookings.empty') + '</h3>' +
      '<p>' + (state.q || state.filter !== 'all' ? t('bookings.emptyFilteredSub') : t('bookings.emptySub')) + '</p>' +
      (!state.q && state.filter === 'all' ? '<a class="ops-btn ghost" href="index.html">' + t('dashboard.backToDashboard') + '</a>' : '') +
    '</div>';
  }
  function bindEmpty() { /* anchor navigates natively */ }

  function errorState() {
    return '<div class="bk-error">' + UI.icon('empty') +
      '<h3>' + t('bookings.errorTitle') + '</h3>' +
      '<p>' + t('bookings.errorSub') + '</p>' +
      '<button class="ops-btn" id="bk-retry">' + t('common.retry') + '</button>' +
    '</div>';
  }

  function renderShell() {
    var el = document.getElementById('ops-content');
    el.innerHTML =
      '<div class="ops-search">' + UI.icon('search') +
        '<input id="ops-q" type="search" placeholder="' + t('bookings.searchPh') + '" autocomplete="off" />' +
      '</div>' +
      '<div class="ops-filters" id="ops-filters">' +
        FILTERS.map(function (f) {
          var count = f.key === 'all' ? state.all.length : state.all.filter(function (b) { return b.status === f.key; }).length;
          return '<button class="ops-chip' + (state.filter === f.key ? ' active' : '') + '" data-f="' + f.key + '">' + t(f.label) + ' (' + count + ')</button>';
        }).join('') +
      '</div>' +
      '<div id="ops-list"></div>';

    var q = document.getElementById('ops-q');
    q.value = state.q;
    q.addEventListener('input', U.debounce(function () { state.q = q.value; state.shown = PAGE; renderList(); }, 200));
    el.querySelector('#ops-filters').querySelectorAll('[data-f]').forEach(function (c) {
      c.addEventListener('click', function () { state.filter = c.getAttribute('data-f'); state.shown = PAGE; renderShell(); });
    });
    renderList();
  }

  function kv(k, v) { return v ? '<div class="ops-kv"><span class="k">' + k + '</span><span class="v">' + U.esc(v) + '</span></div>' : ''; }

  function openDetail(dbId) {
    var b = state.all.filter(function (x) { return String(x.dbId) === String(dbId); })[0];
    if (!b) return;

    var addr = (b.fromAddr ? kv(t('bookings.from'), b.fromAddr) : '') + (b.toAddr ? kv(t('bookings.to'), b.toAddr) : '');
    var items = (b.items && b.items.length) ? kv(t('bookings.items'), b.items.join('、')) : '';

    var nexts = (NEXT[b.status] || []).slice();
    var trans = nexts.map(function (s) { return '<button class="ops-btn sage" data-st="' + s + '">' + t('bookings.changeTo', { s: t('status.' + Ops.toDbStatus(s)) }) + '</button>'; }).join('');
    if (b.status !== 'キャンセル') trans += '<button class="ops-btn danger" data-st="キャンセル">' + t('bookings.makeCancel') + '</button>';
    if (!trans) trans = '<p class="ops-muted" style="font-size:.82rem;text-align:center;margin:6px 0">' + t('bookings.noMoreStatus') + '</p>';

    var html =
      '<h2>' + U.esc(b.name) + t('common.honorific') + '</h2>' +
      '<div class="ops-muted" style="margin:0 0 14px;font-size:.86rem">' + t('bookings.receiptNo') + ' ' + U.esc(b.ref) + ' · ' + UI.statusBadge(b.status) + '</div>' +

      '<div class="ops-card" style="margin:0 0 14px;padding:4px 14px">' +
        kv(t('bookings.moveDate'), U.fmtDateFull(b.date)) +
        (b.time ? kv(t('bookings.timeSlot'), b.time) : '') +
        kv(t('bookings.service'), b.service) +
        (b.workers ? kv(t('bookings.workers'), b.workers) : '') +
        addr + items +
        kv(t('bookings.email'), b.email) +
        kv(t('bookings.phone'), b.phone) +
        (b.notes ? kv(t('bookings.notes'), b.notes) : '') +
        kv(t('bookings.receivedAt'), U.fmtDateFull(b.createdAt)) +
      '</div>' +

      '<div class="ops-section-title" style="margin:4px 2px 8px">' + t('bookings.quickActions') + '</div>' +
      '<div class="bk-quick">' +
        '<a class="ops-btn ghost"' + (b.phone ? ' href="tel:' + U.esc(b.phone) + '"' : ' disabled') + '>' + UI.icon('phone') + t('bookings.call') + '</a>' +
        '<a class="ops-btn ghost" href="chat.html?booking=' + encodeURIComponent(b.dbId) + '&ref=' + encodeURIComponent(b.ref) + '">' + UI.icon('chat') + t('bookings.chat') + '</a>' +
        '<a class="ops-btn ghost"' + (b.date ? ' href="calendar.html?date=' + encodeURIComponent(b.date) + '"' : ' disabled') + '>' + UI.icon('calendar') + t('bookings.slot') + '</a>' +
      '</div>' +

      '<div class="ops-section-title" style="margin:16px 2px 8px">' + t('bookings.statusChange') + '</div>' +
      '<div class="bk-trans">' + trans + '</div>';

    sheet.open(html);
    sheet.el.querySelectorAll('.bk-trans [data-st]').forEach(function (btn) {
      btn.addEventListener('click', function () { changeStatus(b, btn.getAttribute('data-st')); });
    });
  }

  function changeStatus(b, newStatus) {
    if (b.status === newStatus) return;
    if (newStatus === 'キャンセル' && !confirm(t('bookings.cancelConfirm', { name: b.name }))) return;
    var prev = b.status, prevRaw = b.statusRaw;
    b.status = newStatus; b.statusRaw = Ops.toDbStatus(newStatus);   // optimistic
    renderList(); openDetail(b.dbId); UI.toast(t('common.updating'));
    Api.updateBookingStatus(b.dbId, newStatus).then(function (res) {
      if (res.error) {
        b.status = prev; b.statusRaw = prevRaw;                      // rollback
        renderList(); openDetail(b.dbId);
        UI.toast(t('common.saveFailed') + '：' + (res.error.message || ''));
      } else {
        UI.toast(t('bookings.updated', { name: b.name, s: t('status.' + Ops.toDbStatus(newStatus)) }));
      }
    });
  }

  function load() {
    var el = document.getElementById('ops-content');
    el.innerHTML = UI.skeleton(6);
    state.error = false;
    Api.listBookings().then(function (r) {
      if (r.error && !(r.data && r.data.length)) {
        state.error = true;
        el.innerHTML = errorState();
        var rt = document.getElementById('bk-retry');
        if (rt) rt.addEventListener('click', load);
        return;
      }
      state.all = r.data || [];
      state.shown = PAGE;
      Ops.Notify.syncBookings(state.all);
      UI.setBell(Ops.Notify.unreadCount());
      renderShell();
      var ref = new URLSearchParams(location.search).get('ref');
      if (ref) { var m = state.all.filter(function (b) { return b.ref === ref; })[0]; if (m) openDetail(m.dbId); }
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: 'bookings', title: t('bookings.title') });
    sheet = UI.sheet();
    load();
  });
})();
