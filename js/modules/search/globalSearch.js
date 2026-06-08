'use strict';

/* ════════════════════════════════════════════════════════
   GLOBAL SEARCH — Phase 22B
   Command-palette style search across bookings, quotes, reviews
   and customers.  Open with Ctrl+K or the topbar search button.

   No backend calls — searches locally cached Adapter data.
   Results are grouped by type; click navigates to the relevant view.
   ════════════════════════════════════════════════════════ */

window.GlobalSearch = (function () {

  var _activeIndex = -1;

  /* ── CSS ── */

  function _injectCSS() {
    if (document.getElementById('globalSearchCSS')) return;
    var s = document.createElement('style');
    s.id = 'globalSearchCSS';
    s.textContent =
      '#gsOverlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;' +
        'display:flex;align-items:flex-start;justify-content:center;padding-top:80px}' +
      '#gsBox{background:var(--bg);border:1px solid var(--line);border-radius:14px;' +
        'width:100%;max-width:560px;max-height:70vh;display:flex;flex-direction:column;' +
        'box-shadow:0 24px 60px rgba(0,0,0,.3);overflow:hidden}' +
      '#gsInputWrap{display:flex;align-items:center;gap:10px;padding:14px 16px;' +
        'border-bottom:1px solid var(--line);flex-shrink:0}' +
      '#gsInput{flex:1;border:none;background:transparent;font-size:15px;color:var(--ink);' +
        'outline:none;font-family:inherit}' +
      '#gsInput::placeholder{color:var(--gray-2)}' +
      '#gsResults{overflow-y:auto;padding:8px 0}' +
      '.gs-group-label{font-size:11px;font-weight:600;text-transform:uppercase;' +
        'letter-spacing:.07em;color:var(--gray-2);padding:8px 16px 4px}' +
      '.gs-result{display:flex;align-items:center;gap:12px;padding:9px 16px;cursor:pointer;' +
        'transition:background .1s}' +
      '.gs-result:hover,.gs-result.active{background:var(--bg-soft)}' +
      '.gs-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;' +
        'justify-content:center;flex-shrink:0;font-size:14px}' +
      '.gs-icon-booking{background:rgba(37,99,235,.1);color:var(--blue)}' +
      '.gs-icon-quote{background:rgba(245,158,11,.1);color:var(--yellow)}' +
      '.gs-icon-review{background:rgba(139,92,246,.1);color:#8b5cf6}' +
      '.gs-icon-customer{background:rgba(16,185,129,.1);color:var(--green)}' +
      '.gs-icon-crm{background:rgba(245,158,11,.12);color:#92400e}' +
      '.gs-main{flex:1;min-width:0}' +
      '.gs-primary{font-size:13px;font-weight:500;color:var(--ink);white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis}' +
      '.gs-secondary{font-size:11px;color:var(--gray-1);margin-top:2px;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis}' +
      '.gs-empty{padding:32px 16px;text-align:center;color:var(--gray-2);font-size:13px}' +
      '.gs-hint{padding:10px 16px;border-top:1px solid var(--line-2);font-size:11px;' +
        'color:var(--gray-2);display:flex;gap:12px;flex-shrink:0}' +
      '.gs-hint kbd{background:var(--bg-soft-2);border:1px solid var(--line);border-radius:4px;' +
        'padding:1px 5px;font-family:monospace;font-size:10px}';
    document.head.appendChild(s);
  }

  /* ── Topbar button (injected once) ── */

  function _injectBtn() {
    if (document.getElementById('gsTopbarBtn')) return;
    var actions = document.querySelector('.topbar-actions');
    if (!actions) return;
    var btn = document.createElement('button');
    btn.id        = 'gsTopbarBtn';
    btn.className = 'btn btn-ghost btn-sm';
    btn.style.cssText = 'gap:6px';
    btn.setAttribute('onclick', 'GlobalSearch.open()');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="13" height="13">' +
        '<path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16' +
          'c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5' +
          ' 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>' +
      '</svg>検索';
    /* Insert as first child so it sits left of "予約を追加" */
    actions.insertBefore(btn, actions.firstChild);
  }

  /* ── Keyboard shortcut (Ctrl+K / Cmd+K) ── */

  function _initShortcut() {
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (document.getElementById('gsOverlay')) close();
        else open();
      }
    });
  }

  /* ── Search logic ── */

  function _norm(s) { return String(s || '').toLowerCase(); }

  function _matches(fields, q) {
    return fields.some(function (f) { return _norm(f).indexOf(q) !== -1; });
  }

  function _search(query) {
    var q = _norm(query.trim());
    if (!q) return [];
    var results = [];

    /* Bookings */
    if (window.Adapter || window.BookingService) {
      var bks = window.BookingService ? BookingService.getBookings() : Adapter.getBookings();
      bks.forEach(function (b) {
        if (_matches([b.id, b.name, b.email, b.service, b.fromAddr, b.toAddr, b.status], q)) {
          results.push({ type: 'booking', id: b.id, primary: b.id + ' — ' + (b.name || '—'),
            secondary: (b.service || '') + '　' + (b.date || '') + '　' + (b.status || '') });
        }
      });
    }

    /* Quotes */
    if (window.Adapter && typeof Adapter.getQuotes === 'function') {
      Adapter.getQuotes().forEach(function (q2) {
        if (_matches([q2.id, q2.name, q2.email, q2.service], q)) {
          results.push({ type: 'quote', id: q2.id, primary: q2.id + ' — ' + (q2.name || '—'),
            secondary: (q2.service || '') + '　' + (q2.email || '') });
        }
      });
    }

    /* Reviews */
    if (window.Adapter && typeof Adapter.getReviews === 'function') {
      Adapter.getReviews().forEach(function (r) {
        if (_matches([r.name, r.comment || r.body || '', r.id], q)) {
          results.push({ type: 'review', id: r.id, primary: r.name || '—',
            secondary: '★'.repeat(r.rating || 5) + '　' + ((r.comment || r.body || '').slice(0, 60)) });
        }
      });
    }

    /* CRM Profiles — search by name, email, phone, tag */
    if (window.CustomerProfiles) {
      CustomerProfiles.getAll().forEach(function (p) {
        var tags = (p.tags || []).join(' ');
        if (_matches([p.name, p.email, p.phone, tags], q)) {
          var statusLabel = p.status === 'vip' ? '✦ VIP' : p.status === 'returning' ? '常連' : '新規';
          results.push({
            type:      'crm',
            id:        p.id,
            primary:   p.name || '—',
            secondary: (p.email || '') + '　' + statusLabel +
                       (p.tags && p.tags.length ? '　[' + p.tags.slice(0, 3).join(', ') + ']' : ''),
          });
        }
      });
    } else if (window.Adapter || window.BookingService) {
      /* Legacy fallback when CRM module not loaded */
      var seen  = {};
      var bks2  = window.BookingService ? BookingService.getBookings() : Adapter.getBookings();
      bks2.forEach(function (b) {
        var key = _norm(b.email || b.name || b.id);
        if (!seen[key] && _matches([b.name, b.email, b.phone], q)) {
          seen[key] = true;
          results.push({ type: 'customer', id: b.email || b.id,
            primary: b.name || '—', secondary: b.email || '' });
        }
      });
    }

    return results.slice(0, 40);
  }

  /* ── Render results ── */

  var _ICONS = {
    booking:  { cls: 'gs-icon-booking',  svg: '<path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>' },
    quote:    { cls: 'gs-icon-quote',    svg: '<path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>' },
    review:   { cls: 'gs-icon-review',  svg: '<path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>' },
    customer: { cls: 'gs-icon-customer', svg: '<path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>' },
    crm:      { cls: 'gs-icon-crm',      svg: '<path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>' },
  };

  var _LABELS = { booking: '予約', quote: '見積り', review: 'レビュー', customer: '顧客', crm: 'CRM顧客' };
  var _VIEWS  = { booking: 'bookings', quote: 'quotes', review: 'reviews', customer: 'customers', crm: 'crm' };

  function _renderResults(results) {
    var wrap = document.getElementById('gsResults');
    if (!wrap) return;
    _activeIndex = -1;

    if (!results.length) {
      wrap.innerHTML = '<div class="gs-empty">一致する結果が見つかりませんでした</div>';
      return;
    }

    /* Group by type */
    var groups = {};
    results.forEach(function (r) {
      if (!groups[r.type]) groups[r.type] = [];
      groups[r.type].push(r);
    });

    var html = '';
    ['booking', 'quote', 'review', 'crm', 'customer'].forEach(function (type) {
      var items = groups[type];
      if (!items || !items.length) return;
      var icon = _ICONS[type];
      html += '<div class="gs-group-label">' + _LABELS[type] + ' (' + items.length + '件)</div>';
      items.slice(0, 5).forEach(function (item) {
        html += '<div class="gs-result" data-type="' + type + '" data-id="' + _escAttr(item.id) + '" ' +
          'onclick="GlobalSearch._navigate(\'' + type + '\',\'' + _escAttr(item.id) + '\')">' +
          '<div class="gs-icon ' + icon.cls + '">' +
            '<svg viewBox="0 0 24 24" width="16" height="16">' + icon.svg + '</svg>' +
          '</div>' +
          '<div class="gs-main">' +
            '<div class="gs-primary">' + _escHTML(item.primary) + '</div>' +
            '<div class="gs-secondary">' + _escHTML(item.secondary) + '</div>' +
          '</div></div>';
      });
    });

    wrap.innerHTML = html;
  }

  function _escHTML(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _escAttr(s) { return String(s||'').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }

  /* ── Keyboard navigation within results ── */

  function _onKeydown(e) {
    var items = document.querySelectorAll('#gsResults .gs-result');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _activeIndex = Math.min(_activeIndex + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _activeIndex = Math.max(_activeIndex - 1, 0);
    } else if (e.key === 'Enter' && _activeIndex >= 0) {
      e.preventDefault();
      items[_activeIndex].click();
      return;
    } else {
      return;
    }

    items.forEach(function (el, i) { el.classList.toggle('active', i === _activeIndex); });
    if (items[_activeIndex]) items[_activeIndex].scrollIntoView({ block: 'nearest' });
  }

  /* ── Navigate to result ── */

  function _navigate(type, id) {
    close();
    var view = _VIEWS[type];
    if (!view || typeof go !== 'function') return;

    if (type === 'booking') {
      go('bookings');
      if (typeof openDetail === 'function') setTimeout(function () { openDetail(id); }, 60);
    } else if (type === 'crm') {
      go('crm');
      if (window.CRMUI) setTimeout(function () { CRMUI.select(id); }, 80);
    } else if (type === 'customer') {
      go('customers');
    } else if (type === 'quote') {
      go('quotes');
    } else if (type === 'review') {
      go('reviews');
    }
  }

  /* ── Public API ── */

  function open() {
    if (document.getElementById('gsOverlay')) return;
    _injectCSS();

    var overlay = document.createElement('div');
    overlay.id = 'gsOverlay';
    overlay.innerHTML =
      '<div id="gsBox">' +
        '<div id="gsInputWrap">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" style="flex-shrink:0;color:var(--gray-2)">' +
            '<path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16' +
              'c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5' +
              ' 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>' +
          '</svg>' +
          '<input id="gsInput" type="text" placeholder="予約・顧客・レビューを検索…" autocomplete="off" />' +
          '<button class="btn btn-ghost btn-sm" onclick="GlobalSearch.close()" ' +
            'style="flex-shrink:0;padding:4px 8px;font-size:11px">ESC</button>' +
        '</div>' +
        '<div id="gsResults"><div class="gs-empty">検索キーワードを入力してください</div></div>' +
        '<div class="gs-hint">' +
          '<span><kbd>↑↓</kbd> 選択</span>' +
          '<span><kbd>Enter</kbd> 開く</span>' +
          '<span><kbd>Esc</kbd> 閉じる</span>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var input = document.getElementById('gsInput');
    if (input) {
      input.focus();
      input.addEventListener('input', function () {
        var q = input.value;
        if (q.trim().length < 1) {
          document.getElementById('gsResults').innerHTML =
            '<div class="gs-empty">検索キーワードを入力してください</div>';
          return;
        }
        _renderResults(_search(q));
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else _onKeydown(e);
      });
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
  }

  function close() {
    var el = document.getElementById('gsOverlay');
    if (el) el.remove();
    _activeIndex = -1;
  }

  function init() {
    _injectCSS();
    _initShortcut();
    /* Inject topbar button after DOM is ready */
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _injectBtn);
    } else {
      _injectBtn();
    }
  }

  return {
    open:      open,
    close:     close,
    _navigate: _navigate,
    init:      init,
  };

}());

GlobalSearch.init();
