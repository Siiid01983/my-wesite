'use strict';

/* ════════════════════════════════════════════════════════
   CUSTOMER PORTAL MANAGEMENT  (顧客ポータル管理)

   Admin-only view of portal customers, assembled ENTIRELY from existing data —
   no new customer-account architecture, no new tables, no duplication:

     • Profile   → derived customers (bookings + hm_data['hm_customers'])
                   via the existing customers module (_syncCustomers/Adapter).
     • Bookings  → Adapter.getBookings() filtered to the customer.
     • Messages  → communications table via the existing CommModule.
     • Files     → storage.php private buckets via PortalDocs / PortalPhotos
                   (booking-scoped: media/customer-documents/<id>/...).

   The portal has NO customer accounts (login is email + booking reference). So
   Reset Password / Disable-Enable Account / Login History are shown as
   READ-ONLY notices only — nothing here touches portal.html, auth.php, or the
   booking-reference login.

   Role protection: administrators only. `go('portal-users')` is gated by
   navigation.js `_ADMIN_ONLY`; render() re-checks defensively.
   ════════════════════════════════════════════════════════ */
(function () {

  let _cache     = new Map();   // custId → enriched customer (for the detail open)
  let _active    = null;        // currently open customer
  let _activeBookingId = null;  // the ONE booking reference the hub is scoped to
  let _activeIds = [];          // scoped booking ids (HM-ref + uuid) for file scoping
  let _fcache    = {};          // index → file row (download handler lookup)

  /* ── Safe wrappers over shared globals (defensive on load order) ─────────── */
  function _esc(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }
  function _fmtDT(s) { return (typeof fmtDT === 'function') ? fmtDT(s) : (s || '—'); }
  function _fmtD(s)  { return (typeof fmtD  === 'function') ? fmtD(s)  : (s || '—'); }
  function _empty(m) {
    if (typeof emptyHTML === 'function') return emptyHTML(m);
    return `<div class="empty" style="padding:24px;text-align:center;color:var(--gray-2)"><p>${_esc(m)}</p></div>`;
  }
  function _toast(m) { try { if (typeof toast === 'function') toast(m); } catch (_) {} }
  function _isAdmin() {
    try { return !window.Auth || typeof Auth.getRole !== 'function' || Auth.getRole() === 'admin'; }
    catch (_) { return true; }
  }
  function _key(b) {
    if (typeof _custKey === 'function') return _custKey(b);
    const email = (b.email || '').trim().toLowerCase();
    return email ? email : 'nomail_' + (b.name || '').trim().toLowerCase();
  }

  /* ── Data assembly (reuse only — no persistence beyond existing modules) ─── */
  function _customers() {
    try {
      if (typeof _syncCustomers === 'function') return _syncCustomers();
      if (window.Adapter && Adapter.getCustomers) return Adapter.getCustomers();
    } catch (_) {}
    return [];
  }
  function _bookings() {
    try { return (window.Adapter && Adapter.getBookings) ? Adapter.getBookings() : []; }
    catch (_) { return []; }
  }

  function _enriched() {
    const custs    = _customers();
    const bookings = _bookings();
    const byKey    = new Map();
    bookings.forEach(b => {
      const k = _key(b);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(b);
    });
    return custs.map(c => {
      const bks   = (byKey.get(c._key) || []).slice().sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1);
      const phone = c.phone || (bks.find(b => b.phone) || {}).phone || '';
      return Object.assign({}, c, { phone, bkCount: bks.length, bookings: bks, latestBk: bks[0] || null });
    }).sort((a, b) => (b.registeredAt || '') > (a.registeredAt || '') ? 1 : -1);
  }

  /* ── Main view ───────────────────────────────────────────────────────────── */
  function _wrap()  { return document.getElementById('portalUsersWrap'); }

  function _statusBadge(c) {
    if (c.deleted)    return `<span class="badge badge-cancel" title="CRMで削除済み / soft-deleted">停止中</span>`;
    if (c.bkCount > 0) return `<span class="badge badge-confirmed">利用中</span>`;
    return `<span class="badge badge-done">予約なし</span>`;
  }

  function render() {
    const wrap = _wrap();
    if (!wrap) return;
    if (!_isAdmin()) {
      wrap.innerHTML = `<div class="empty" style="padding:40px;text-align:center">
        <div style="font-size:40px;line-height:1">🔒</div>
        <p style="margin-top:8px;color:var(--gray-1);font-weight:600">管理者のみアクセス可能</p>
        <p style="color:var(--gray-2);font-size:13px">Administrator access only</p></div>`;
      const sb = document.getElementById('puStatsBar'); if (sb) sb.innerHTML = '';
      return;
    }

    const list = _enriched();
    _cache = new Map(list.map(c => [c.id, c]));

    const q = (document.getElementById('puSearch')?.value || '').toLowerCase().trim();
    const view = q ? list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.id || '').toLowerCase().includes(q)
    ) : list;

    const sb = document.getElementById('puStatsBar');
    if (sb) sb.innerHTML =
      `<span>合計 <strong>${list.length}</strong> 名</span>` +
      `<span>予約あり <strong>${list.filter(c => c.bkCount > 0).length}</strong> 名</span>` +
      `<span>表示中 <strong>${view.length}</strong> 件</span>`;

    if (!view.length) { wrap.innerHTML = _empty('該当する顧客がいません'); return; }

    const rows = view.map(c => {
      const init = (c.name || '?').trim().charAt(0) || '?';
      return `<tr style="cursor:pointer" onclick="PortalUsers.open('${_esc(c.id)}')">
        <td><div style="display:flex;align-items:center;gap:9px">
          <div class="cust-avatar" style="width:28px;height:28px;font-size:12px;border-radius:7px">${_esc(init)}</div>
          <strong>${_esc(c.name || '—')}</strong></div></td>
        <td class="td-sm">${_esc(c.email || '—')}</td>
        <td class="td-sm">${_esc(c.phone || '—')}</td>
        <td>${_statusBadge(c)}</td>
        <td><span class="badge ${c.bkCount > 0 ? 'badge-confirmed' : 'badge-done'}">${c.bkCount}件</span></td>
        <td><span style="font-size:11px;color:var(--gray-2)" title="ログイン履歴は記録されていません / Not tracked">—</span></td>
        <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();PortalUsers.open('${_esc(c.id)}')">詳細</button></td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `<table>
      <thead><tr>
        <th>お客様名</th><th>メール</th><th>電話番号</th><th>アカウント状態</th><th>予約数</th><th>最終ログイン</th><th>操作</th>
      </tr></thead>
      <tbody>${rows}</tbody></table>`;

    /* Message counts enrich nothing in the table (kept to the spec's 6 columns),
       but warm the CommModule cache so the detail timeline opens instantly. */
    if (window.CommModule && CommModule.prefetchStats) CommModule.prefetchStats().catch(() => {});
  }

  function filter() { render(); }

  /* ── Detail panel ────────────────────────────────────────────────────────── */
  function _section(titleHTML, inner) {
    return `<div style="margin-top:14px">
      <div style="font-size:12px;font-weight:700;color:var(--gray-1);margin-bottom:6px">${titleHTML}</div>${inner}</div>`;
  }

  function _profileHTML(c) {
    const row = (l, v) => `<div class="cust-detail-row">
      <span class="cust-detail-label">${l}</span>
      <span class="cust-detail-val">${_esc(v || '—')}</span></div>`;
    return row('メール / Email', c.email) +
           row('電話番号 / Phone', c.phone) +
           row('郵便番号 / Postal', c.postalCode) +
           row('住所 / Address', c.address) +
           row('登録日時 / Registered', _fmtDT(c.registeredAt));
  }

  function _bookingsHTML(c) {
    if (!c.bookings.length) return _section('予約 / Bookings', _empty('予約がありません'));
    const rows = c.bookings.map(b => `<tr>
      <td class="td-mono" style="font-size:11px">${_esc(b.id || '—')}</td>
      <td style="font-size:12px;white-space:nowrap">${_fmtD(b.date)}</td>
      <td style="font-size:12px">${_esc(b.service || '—')}</td>
      <td>${typeof badge === 'function' ? badge(b.status || '新規') : _esc(b.status || '新規')}</td>
      <td><button class="btn btn-ghost btn-sm btn-icon" title="予約詳細"
            onclick="PortalUsers.close();if(typeof openDetail==='function')openDetail('${_esc(b.id)}')">
        <svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
      </button></td>
    </tr>`).join('');
    return _section(`予約 / Bookings <span style="font-weight:400;color:var(--gray-2)">${c.bookings.length}件</span>`,
      `<div class="table-wrap" style="max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:10px">
        <table><thead><tr><th>予約番号</th><th>日付</th><th>サービス</th><th>状態</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`);
  }

  /* Both ids a single booking can be keyed by in storage (HM reference + uuid). */
  function _bookingScopeIds(b) {
    return [...new Set([b && b.id, b && b._dbId]
      .filter(v => v != null && v !== '')
      .map(String))];
  }

  /* Compact booking-reference picker shown above the bookings table. Changing it
     scopes the messages + files sections to ONE reference, so a multi-booking
     customer's data is never mixed. Hidden when there are 0–1 bookings (nothing
     to disambiguate — the hub auto-scopes to the single/none booking). */
  function _bookingSelectorHTML(c) {
    if (!c.bookings || c.bookings.length < 2) return '';
    const opts = c.bookings.map(b =>
      `<option value="${_esc(b.id)}">${_esc(b.id)} · ${_esc(_fmtD(b.date))} · ${_esc(b.service || '—')}</option>`
    ).join('');
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:700;color:var(--gray-1)">表示中の予約 / Booking</span>
      <select id="puBookingSel" class="sel" style="font-size:12px;max-width:100%" onchange="PortalUsers.selectBooking(this.value)">${opts}</select>
      <span style="font-size:11px;color:var(--gray-2)">メッセージ・ファイルをこの予約番号で絞り込み</span>
    </div>`;
  }

  /* Scope the unified hub (messages + files) to a SINGLE booking reference, so a
     multi-booking customer's records are never mixed across references. Falls back
     to the customer-email message timeline ONLY when the customer has no booking
     at all (nothing to scope by). */
  function _selectBooking(bookingId) {
    if (!_active) return;
    const b = (_active.bookings || []).find(x => String(x.id) === String(bookingId))
            || _active.latestBk || null;
    _activeBookingId = b ? b.id : null;
    _activeIds = b ? _bookingScopeIds(b) : [];

    /* Messages — scoped to THIS booking reference (communications.booking_id). */
    const comm = document.getElementById('puCommHistory');
    if (comm) {
      if (window.CommModule && CommModule.renderTimeline && _activeBookingId) {
        CommModule.renderTimeline(_activeBookingId, 'puCommHistory');
      } else if (window.CommModule && CommModule.renderCustomerTimeline && _active.email) {
        CommModule.renderCustomerTimeline(_active.email, 'puCommHistory');   // no booking → email fallback
      } else {
        comm.innerHTML = _section('メッセージ / Messages', _empty('メッセージはありません'));
      }
    }

    /* Files — booking-scoped list/download already key off _activeIds. */
    _fcache = {};
    _renderFiles();

    const sel = document.getElementById('puBookingSel');
    if (sel && _activeBookingId != null) sel.value = String(_activeBookingId);
  }

  /* Read-only notices — the three features the portal has no data for. */
  function _accessHTML() {
    const row = (jp, en, note) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 12px;border-top:1px solid var(--line-2);font-size:12px">
      <span style="color:var(--gray-1)">${jp} <span style="color:var(--gray-2);font-weight:400">· ${en}</span></span>
      <span style="color:var(--gray-2);font-style:italic;text-align:right">${note}</span></div>`;
    return _section('アカウント操作 / Account actions',
      `<div style="border:1px solid var(--line);border-radius:10px;overflow:hidden">
        ${row('パスワードリセット', 'Reset Password', '利用不可（ポータルは予約番号ログイン）<br>Not available (Portal uses booking-reference login)')}
        ${row('アカウント停止 / 有効化', 'Disable / Enable', '利用不可（顧客アカウント機能なし）<br>Not available (No customer account system)')}
        ${row('ログイン履歴', 'Login History', '記録されていません<br>Not tracked')}
      </div>`);
  }

  function open(id) {
    if (!_isAdmin()) { _toast('権限がありません'); return; }
    const c = _cache.get(id) || _enriched().find(x => x.id === id);
    if (!c) return;
    _active = c;
    _activeBookingId = null;
    _activeIds = [];

    document.getElementById('puAvatar').textContent = (c.name || '?').trim().charAt(0) || '?';
    document.getElementById('puName').textContent   = c.name || '—';
    document.getElementById('puId').textContent     = c.id || '';
    document.getElementById('puProfile').innerHTML  = _profileHTML(c);
    document.getElementById('puBookings').innerHTML = _bookingSelectorHTML(c) + _bookingsHTML(c);
    document.getElementById('puAccess').innerHTML   = _accessHTML();

    /* Scope the hub to ONE booking reference (default: the latest). _selectBooking
       renders the per-booking message timeline AND the booking-scoped file list. */
    _fcache = {};
    const _defId = (c.latestBk && c.latestBk.id) || (c.bookings[0] && c.bookings[0].id) || null;
    _selectBooking(_defId);

    const sendBtn = document.getElementById('puSendBtn');
    if (sendBtn) {
      sendBtn.style.display = c.email ? '' : 'none';
      sendBtn.onclick = () => {
        if (!window.CommModule) { _toast('メッセージ機能が利用できません'); return; }
        /* Tag the reply with the CURRENTLY SELECTED booking so it lands in that
           reference's timeline (keeps the per-booking isolation consistent).
           Falls back to a customer-level reply when no booking is selected. */
        const sb = _activeBookingId
          ? (_active.bookings || []).find(x => String(x.id) === String(_activeBookingId))
          : null;
        if (sb && CommModule.openReply) {
          CommModule.openReply(sb.id, c.email, c.name, sb.id, sb.service, sb.date);
        } else if (CommModule.openQuickReply) {
          CommModule.openQuickReply(c.email, c.name, c.name);
        } else {
          _toast('メッセージ機能が利用できません');
        }
      };
    }

    document.getElementById('puModal').classList.add('open');
  }

  function close() {
    const m = document.getElementById('puModal');
    if (m) m.classList.remove('open');
  }

  /* ── Files (reuse PortalDocs / PortalPhotos — booking-scoped, signed URLs) ── */
  function _docLabel(s)   { return ({ estimates:'見積書', contracts:'契約書', attachments:'添付' })[s] || s || '書類'; }
  function _photoLabel(c) { return ({ room:'部屋', furniture:'家具', special:'特別品' })[c] || c || '写真'; }
  function _fmtSize(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  async function _renderFiles() {
    const el = document.getElementById('puFiles');
    if (!el) return;
    const title = 'アップロードファイル / Files';
    if (!window.PortalDocs && !window.PortalPhotos) {
      el.innerHTML = _section(title, _empty('ファイル機能が利用できません')); return;
    }
    el.innerHTML = _section(title, `<div style="font-size:12px;color:var(--gray-2);padding:4px 0">読み込み中... / Loading...</div>`);

    const files = [];
    try {
      if (window.PortalDocs && PortalDocs.list) {
        const d = await PortalDocs.list(_activeIds);
        (d.all || []).forEach(f => files.push({ name: f.name, path: f.path, kind: 'doc', label: _docLabel(f.section), size: f.size, at: f.uploadedAt }));
      }
    } catch (_) {}
    try {
      if (window.PortalPhotos && PortalPhotos.list) {
        const p = await PortalPhotos.list(_activeIds);
        Object.keys(p || {}).forEach(cat => (p[cat] || []).forEach(f =>
          files.push({ name: f.name, path: f.path, kind: 'photo', label: _photoLabel(cat), size: f.size, at: f.uploadedAt, url: f.url })));
      }
    } catch (_) {}

    files.sort((a, b) => (b.at || '') > (a.at || '') ? 1 : -1);

    if (!files.length) { el.innerHTML = _section(title, _empty('アップロードされたファイルはありません')); return; }

    const rows = files.map((f, i) => {
      _fcache[i] = f;
      return `<tr>
        <td style="font-size:12px;word-break:break-all">${_esc(f.name)}</td>
        <td><span class="badge badge-done">${_esc(f.label)}</span></td>
        <td style="font-size:11px;color:var(--gray-2);white-space:nowrap">${_fmtSize(f.size)}</td>
        <td style="font-size:11px;color:var(--gray-2);white-space:nowrap">${f.at ? _fmtDT(f.at) : '—'}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="PortalUsers.download(${i})">ダウンロード</button></td>
      </tr>`;
    }).join('');

    el.innerHTML = _section(`${title} <span style="font-weight:400;color:var(--gray-2)">${files.length}件</span>`,
      `<div class="table-wrap" style="max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:10px">
        <table><thead><tr><th>ファイル名</th><th>種別</th><th>サイズ</th><th>日時</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`);
  }

  async function download(i) {
    const f = _fcache[i];
    if (!f) return;
    let url = null;
    try {
      if (f.kind === 'photo' && window.PortalPhotos) url = f.url || await PortalPhotos.signedUrl(_activeIds, f.path);
      else if (window.PortalDocs) url = await PortalDocs.getDownloadUrl(_activeIds, f.path);
    } catch (_) {}
    if (url) window.open(url, '_blank', 'noopener');
    else _toast('ファイルを取得できませんでした');
  }

  /* ── Exports ─────────────────────────────────────────────────────────────── */
  window.PortalUsers = { render, filter, open, close, download, selectBooking: _selectBooking };
  window.renderPortalUsers = render;   // navigation.js go('portal-users') calls this
})();
