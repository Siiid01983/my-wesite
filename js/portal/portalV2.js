'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   Customer Portal V2 — Phase 2  (Steps 2–6)

   Modules: Profile Summary (5) · Booking History (2) · Booking Details (3) ·
   Rebook (4/4.1) · Messaging (6). All additive & non-invasive:
     • no changes to VIEWS, render(), navigation, PortalAuth, chat.php backend,
       Booking Engine, slot-lock, create-booking.php, cards, or timeline logic
     • renders into its OWN #pv2-panel appended AFTER #content (survives render())
     • visible only on the overview view (MutationObserver mirrors the nav)

   Flag OFF (CUSTOMER_PORTAL_V2_ENABLED !== true): fully dormant — one diagnostic
   line, no DOM, no listeners, no network. Portal stays byte-for-byte identical.
   ════════════════════════════════════════════════════════════════════════════ */
window.PortalV2 = (function () {

  var PER = 10;
  var _page = 1, _total = 0, _session = null, _panel = null, _obs = null;
  var _detail = null, _rebookPayload = null;
  var _msgBookingId = '', _pvPending = [];   // chat attachments (customer)

  function isEnabled() { return window.CUSTOMER_PORTAL_V2_ENABLED === true; }
  function _base()     { return (window.API_BASE || '').replace(/\/+$/, ''); }
  function _key()      { return { 'X-API-KEY': window.API_KEY || '' }; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _readSession() {
    try { return (window.PortalAuth && PortalAuth.getSession && PortalAuth.getSession()) || null; }
    catch (e) { return null; }
  }

  var STATUS = {
    pending:{l:'新規',c:'warn'}, checking:{l:'確認中',c:'warn'},
    confirmed:{l:'確定',c:'confirmed'}, completed:{l:'完了',c:'confirmed'}, cancelled:{l:'キャンセル',c:'cancel'},
    '新規':{l:'新規',c:'warn'},'確認中':{l:'確認中',c:'warn'},
    '確定':{l:'確定',c:'confirmed'},'完了':{l:'完了',c:'confirmed'},'キャンセル':{l:'キャンセル',c:'cancel'}
  };
  function statusJp(st) { return (STATUS[st] || { l: st || '新規' }).l; }
  function badge(st) { var m = STATUS[st] || { l:(st||'新規'), c:'warn' }; return '<span class="badge ' + m.c + '">' + esc(m.l) + '</span>'; }
  function fmtDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s||'')); return m ? (m[1]+'年'+(+m[2])+'月'+(+m[3])+'日') : (s ? esc(s) : '—'); }
  function fmtCreated(s) {
    if (!s) return '—';
    var d = new Date(String(s).replace(' ', 'T')); if (isNaN(d)) return esc(s);
    var p = function (n){ return String(n).padStart(2,'0'); };
    return d.getFullYear()+'/'+p(d.getMonth()+1)+'/'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
  }
  // Scheduled-time label from start_at/end_at (calendar source of truth).
  function _schedTime(startAt, endAt) {
    if (!startAt) return '';
    var hm = function (s) { var m = /(\d{1,2}):(\d{2})/.exec(String(s).slice(10)); return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : ''; };
    var s = hm(startAt), e = endAt ? hm(endAt) : '';
    return s ? (e ? s + '〜' + e : s) : '';
  }
  function parseExtras(notes) {
    var n = String(notes || ''); var idx = n.indexOf('[HM_EXTRAS]');
    var user = (idx >= 0 ? n.slice(0, idx) : n).replace(/\s+$/, '');
    var block = idx >= 0 ? n.slice(idx) : '';
    var f = function (k){ var m = new RegExp('^'+k+':\\s*(.+)$','m').exec(block); return m ? m[1].trim() : ''; };
    return { user: user.trim(), from: f('from'), to: f('to'), time: f('time'), service: f('service'),
             items: f('items'), pref1: f('pref1'), pref2: f('pref2') };
  }

  /* ── PROFILE (Step 5) ─────────────────────────────────────────────────────── */
  function _pf(k, v) { return '<div class="pv2-pf"><span class="pv2-pf-k">' + esc(k) + '</span><span class="pv2-pf-v">' + (v ? esc(v) : '—') + '</span></div>'; }
  async function renderProfile() {
    var host = _panel && _panel.querySelector('.pv2-profile-body'); if (!host) return;
    host.innerHTML = '<div class="pv2-note">読み込み中…</div>';
    var s = _session, out = null;
    try {
      var res = await fetch(_base() + '/customer-profile.php?email=' + encodeURIComponent(s.email) +
                            '&reference=' + encodeURIComponent(s.ref), { headers: _key() });
      out = await res.json();
    } catch (e) { out = null; }
    host = _panel && _panel.querySelector('.pv2-profile-body'); if (!host) return;
    if (!out || !out.ok || !out.data) {
      host.innerHTML = '<div class="pv2-note pv2-err">プロフィール情報を取得できません</div>'; return;
    }
    var d = out.data;
    host.innerHTML =
      '<div class="pv2-prof-card">' +
        '<div class="pv2-prof-title">お客様プロフィール</div>' +
        '<div class="pv2-prof-name">' + esc(d.name || '—') + '</div>' +
        '<div class="pv2-prof-grid">' +
          _pf('メール',       d.email) +
          _pf('ご利用回数',   (d.total_bookings != null ? d.total_bookings + '回' : '—')) +
          _pf('初回ご利用',   fmtDate(d.first_booking_date)) +
          _pf('最終ご利用',   fmtDate(d.last_booking_date)) +
        '</div>' +
      '</div>';
  }

  /* ── HISTORY (Step 2) ─────────────────────────────────────────────────────── */
  async function _fetchPage(p) {
    var s = _session; if (!s || !s.email || !s.ref) return null;
    var url = _base() + '/customer-bookings.php?email=' + encodeURIComponent(s.email) +
              '&reference=' + encodeURIComponent(s.ref) + '&page=' + p + '&per=' + PER;
    var res = await fetch(url, { headers: _key() }); return await res.json();
  }
  function _rowsHtml(items) {
    return items.map(function (b) {
      return '<tr class="pv2-row" data-ref="' + esc(b.ref) + '" tabindex="0" role="button">' +
          '<td data-label="予約番号"><span class="pv2-ref">' + esc(b.ref) + '</span></td>' +
          '<td data-label="引越し日">' + fmtDate(b.date) + '</td>' +
          '<td data-label="サービス">' + (b.service ? esc(b.service) : '—') + '</td>' +
          '<td data-label="ステータス">' + badge(b.status) + '</td>' +
          '<td data-label="受付日">' + (b.created ? fmtCreated(b.created).slice(0,10) : '—') + '</td>' +
        '</tr>';
    }).join('');
  }
  function _pagerHtml() {
    var pages = Math.max(1, Math.ceil(_total / PER));
    return '<div class="pv2-pager">' +
      '<button class="pv2-pg pv2-prev" ' + (_page<=1?'disabled':'') + '>前へ</button>' +
      '<span class="pv2-pg-info">' + _page + ' / ' + pages + '（全' + _total + '件）</span>' +
      '<button class="pv2-pg pv2-next" ' + (_page>=pages?'disabled':'') + '>次へ</button></div>';
  }
  function _histBody() { return _panel ? _panel.querySelector('.pv2-hist-body') : null; }
  async function renderHistory(p) {
    if (!_panel) return;
    _page = Math.max(1, p || _page);
    var body = _histBody(); if (body) body.innerHTML = '<div class="pv2-note">読み込み中…</div>';
    var out = null; try { out = await _fetchPage(_page); } catch (e) { out = null; }
    body = _histBody(); if (!body) return;
    if (!out || !out.ok || !out.data) { body.innerHTML = '<div class="pv2-note pv2-err">ご利用履歴を読み込めませんでした。</div>'; return; }
    _total = (out.data.total | 0); var items = out.data.items || [];
    if (_total === 0 || items.length === 0) {
      body.innerHTML = '<div class="pv2-empty"><p class="pv2-empty-msg">まだご利用履歴はありません</p>' +
        '<a class="pv2-cta" href="index.html">無料見積もり依頼</a></div>'; return;
    }
    body.innerHTML = '<table class="pv2-table"><thead><tr>' +
      '<th>予約番号</th><th>引越し日</th><th>サービス</th><th>ステータス</th><th>受付日</th>' +
      '</tr></thead><tbody>' + _rowsHtml(items) + '</tbody></table>' + _pagerHtml();
  }

  /* ── DETAILS (Step 3) ─────────────────────────────────────────────────────── */
  function _timelineHtml(status) {
    var jp = statusJp(status);
    if (jp === 'キャンセル') return '<div class="timeline"><div class="tl-item">ご予約受付</div><div class="tl-item cur">ご予約はキャンセルされました</div></div>';
    var steps = ['ご予約受付','内容確認中','ご予約確定','完了'];
    var cur = jp === '新規' ? 0 : jp === '確認中' ? 1 : jp === '確定' ? 2 : jp === '完了' ? 3 : 0;
    return '<div class="timeline">' + steps.map(function (t, i) {
      return '<div class="' + (i < cur ? 'tl-item tl-done' : i === cur ? 'tl-item cur' : 'tl-item tl-pending') + '">' + t + '</div>';
    }).join('') + '</div>';
  }
  function _field(k, v) { return '<div class="pv2-f"><span class="pv2-f-k">' + esc(k) + '</span><span class="pv2-f-v">' + (v ? esc(v) : '—') + '</span></div>'; }
  function _mountDetail() {
    if (document.getElementById('pv2-detail')) return document.getElementById('pv2-detail');
    var m = document.createElement('div'); m.id = 'pv2-detail'; m.className = 'pv2 pv2-modal'; m.setAttribute('hidden', '');
    m.innerHTML = '<div class="pv2-modal-backdrop"></div><div class="pv2-modal-card" role="dialog" aria-modal="true" aria-label="予約詳細">' +
      '<div class="pv2-modal-head"><h3 class="pv2-modal-title">予約詳細</h3><button class="pv2-modal-close" aria-label="閉じる">×</button></div>' +
      '<div class="pv2-modal-body"></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      if (e.target.classList.contains('pv2-modal-backdrop') || e.target.classList.contains('pv2-modal-close')) _closeDetail();
      else if (e.target.classList.contains('pv2-rebook')) _rebook();
    });
    return m;
  }
  function _closeDetail() { if (_detail) { _detail.setAttribute('hidden', ''); document.body.style.overflow = ''; } }
  async function _openDetail(ref) {
    _detail = _mountDetail();
    var bodyEl = _detail.querySelector('.pv2-modal-body');
    bodyEl.innerHTML = '<div class="pv2-note">読み込み中…</div>';
    _detail.removeAttribute('hidden'); document.body.style.overflow = 'hidden';
    var isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(ref);
    var qs = (isUuid ? 'id=' : 'ref=') + encodeURIComponent(ref);
    var out = null;
    try { var res = await fetch(_base() + '/get-booking.php?' + qs, { headers: _key() }); out = await res.json(); } catch (e) { out = null; }
    if (!out || !out.ok || !out.data) { bodyEl.innerHTML = '<div class="pv2-note pv2-err">予約詳細を読み込めませんでした。</div>'; return; }
    var r = out.data, ex = parseExtras(r.notes);
    var svc = (r.service_id && String(r.service_id).trim()) || ex.service || '';
    var refM = /^ref:\s*(\S+)/m.exec(String(r.notes || '')); var refDisp = refM ? refM[1] : (r.id || '');
    _rebookPayload = { service: svc, fromAddr: ex.from, toAddr: ex.to, notes: ex.user, items: r.items || null };
    bodyEl.innerHTML =
      '<div class="pv2-d-status">' + badge(r.status) + '</div>' +
      '<div class="pv2-fields">' +
        _field('予約番号', refDisp) + _field('引越し日', fmtDate(r.booking_date)) + _field('時間帯', _schedTime(r.start_at, r.end_at) || ex.time) +
        _field('サービス', svc) + _field('お名前', r.customer_name) + _field('メール', r.customer_email) +
        _field('電話番号', r.customer_phone) + _field('現住所/作業場所', ex.from) + _field('引越し先', ex.to) +
        _field('受付日', (r.created_at ? fmtCreated(r.created_at).slice(0,10) : '—')) +
      '</div>' +
      // T5 — the two requested date/time options. Columns first, then the notes
      // pref1/pref2 fallback (survives migration-gated column stripping).
      ((window.HMFmt && HMFmt.preferredOptions({
        preferred_start_1: r.preferred_start_1, preferred_start_2: r.preferred_start_2,
        extra: { pref1: ex.pref1, pref2: ex.pref2 }, date: r.booking_date, time: ex.time
      })) || '') +
      // T4 — furniture as icon + name + quantity-badge cards. Column → notes items:.
      (function () {
        var it = (Array.isArray(r.items) && r.items.length) ? r.items
               : (ex.items ? ex.items.split('|').filter(Boolean) : []);
        return (window.HMFmt && it.length)
          ? '<div class="pv2-d-notes"><div class="pv2-f-k">お荷物</div>' + HMFmt.furnitureGrid(it) + '</div>' : '';
      })() +
      (ex.user ? '<div class="pv2-d-notes"><div class="pv2-f-k">ご要望・メモ</div><p>' + esc(ex.user) + '</p></div>' : '') +
      '<div class="pv2-d-tl"><div class="pv2-f-k">進捗</div>' + _timelineHtml(r.status) + '</div>' +
      '<div class="pv2-d-actions"><button class="pv2-rebook">同じ内容で再予約</button></div>';
  }

  /* ── REBOOK (Step 4/4.1) — additive handoff; original booking never modified ─ */
  function _rebook() {
    var p = _rebookPayload || {};
    try {
      sessionStorage.setItem('hm_rebook_prefill', JSON.stringify({
        service: p.service || '', fromAddr: p.fromAddr || '', toAddr: p.toAddr || '',
        notes: p.notes || '', items: p.items || null, ts: Date.now()
      }));
    } catch (e) {}
    window.location.href = 'index.html';
  }

  /* ── MESSAGING (Step 6) — uses existing chat.php backend, no new tables ─────── */
  async function renderMessages() {
    var host = _panel && _panel.querySelector('.pv2-msg-body'); if (!host) return;
    host.innerHTML = '<div class="pv2-note">読み込み中…</div>';
    var out = null;
    try {
      var res = await fetch(_base() + '/chat.php?action=list', {
        method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, _key()),
        body: JSON.stringify({ email: _session.email, reference: _session.ref })
      });
      out = await res.json();
    } catch (e) { out = null; }
    host = _panel && _panel.querySelector('.pv2-msg-body'); if (!host) return;
    if (!out || !out.ok || !out.data) { host.innerHTML = '<div class="pv2-note pv2-err">メッセージを読み込めませんでした。</div>'; return; }
    _msgBookingId = String(out.data.booking_id || '');   // needed to scope attachment uploads
    var msgs = out.data.messages || [];
    var listHtml = msgs.length
      ? '<div class="pv2-msg-list">' + msgs.map(function (m) {
          var mine = m.sender_type === 'customer' || m.direction === 'in' || m.direction === 'inbound';
          return '<div class="pv2-bubble ' + (mine ? 'mine' : 'them') + '">' +
            '<div class="pv2-bubble-meta">' + esc(m.sender_name || (mine ? 'あなた' : 'Hello Moving')) + ' · ' + fmtCreated(m.created || m.created_at) + '</div>' +
            _pvAttHtml(m.attachments) +
            (m.text || m.body ? '<div class="pv2-bubble-text">' + esc(m.text || m.body || '') + '</div>' : '') + '</div>';
        }).join('') + '</div>'
      : '<div class="pv2-empty"><p class="pv2-empty-msg">まだメッセージはありません</p></div>';
    host.innerHTML = listHtml +
      '<div class="pv2-msg-compose">' +
        '<div class="pv2-msg-pending" style="display:none"></div>' +
        '<div class="pv2-msg-row">' +
          '<button class="pv2-msg-attach" type="button" title="添付（Attach）">📎</button>' +
          '<input class="pv2-msg-file" type="file" accept="image/*,application/pdf,.doc,.docx" multiple hidden>' +
          '<textarea class="pv2-msg-input" rows="2" placeholder="メッセージを入力…"></textarea>' +
          '<button class="pv2-msg-send">送信</button>' +
        '</div>' +
      '</div>';
    _pvRenderPending();
    var listEl = host.querySelector('.pv2-msg-list'); if (listEl) listEl.scrollTop = listEl.scrollHeight;
  }
  // Attachments come from chat.php with a ready signed `url`.
  function _pvAttHtml(atts) {
    if (!atts || !atts.length) return '';
    return '<div class="pv2-atts">' + atts.map(function (a) {
      if (/^image\//.test(a.mime || '')) return '<a class="pv2-att-img" href="' + esc(a.url) + '" target="_blank" rel="noopener"><img src="' + esc(a.url) + '" alt="' + esc(a.name) + '"></a>';
      return '<a class="pv2-att-file" href="' + esc(a.url) + '" target="_blank" rel="noopener" download>' + esc(a.name) + '</a>';
    }).join('') + '</div>';
  }
  function _pvRenderPending() {
    var host = _panel && _panel.querySelector('.pv2-msg-pending'); if (!host) return;
    host.innerHTML = _pvPending.map(function (a, i) {
      return '<span class="pv2-pchip">' + esc(a.name) + (a.uploading ? ' …' : '<button type="button" data-pvrm="' + i + '">×</button>') + '</span>';
    }).join('');
    host.style.display = _pvPending.length ? 'flex' : 'none';
  }
  function _pvUpload(files) {
    var sb = window.api;
    if (!sb || !sb.storage || !_msgBookingId || !files) return;
    Array.prototype.slice.call(files).forEach(function (f) {
      if (_pvPending.length >= 10) return;
      var tok = { name: f.name, uploading: true }; _pvPending.push(tok); _pvRenderPending();
      var dot = (f.name || '').lastIndexOf('.'); var ext = dot > 0 ? f.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'dat';
      var path = _msgBookingId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      sb.storage.from('chat').upload(path, f, { contentType: f.type, upsert: false }).then(function (res) {
        var i = _pvPending.indexOf(tok);
        if (res && res.error) { if (i >= 0) _pvPending.splice(i, 1); _pvRenderPending(); return; }
        if (i >= 0) _pvPending[i] = { path: path, name: f.name, mime: f.type || '', size: f.size || 0 };
        _pvRenderPending();
      });
    });
  }
  async function _sendMessage() {
    var host = _panel && _panel.querySelector('.pv2-msg-body'); var ta = host && host.querySelector('.pv2-msg-input');
    if (!ta) return;
    var text = ta.value.trim();
    var atts = _pvPending.filter(function (a) { return a.path && !a.uploading; });
    if ((!text && !atts.length) || _pvPending.some(function (a) { return a.uploading; })) return;
    ta.disabled = true;
    try {
      await fetch(_base() + '/chat.php?action=send', {
        method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, _key()),
        body: JSON.stringify({ email: _session.email, reference: _session.ref, message: text,
          attachments: atts.map(function (a) { return { path: a.path, name: a.name, mime: a.mime, size: a.size }; }) })
      });
    } catch (e) {}
    _pvPending = [];
    await renderMessages();
  }

  /* ── Mount / visibility (additive) ────────────────────────────────────────── */
  function _mount() {
    if (document.getElementById('pv2-panel')) return document.getElementById('pv2-panel');
    var content = document.getElementById('content'); if (!content || !content.parentNode) return null;
    var panel = document.createElement('div'); panel.id = 'pv2-panel'; panel.className = 'pv2 pv2-panel';
    panel.innerHTML =
      '<section class="pv2-profile"><div class="pv2-profile-body"></div></section>' +
      '<section class="pv2-history"><div class="pv2-hist-head"><h2 class="pv2-hist-title">ご利用履歴</h2></div><div class="pv2-hist-body"></div></section>' +
      '<section class="pv2-messages"><div class="pv2-hist-head"><h2 class="pv2-hist-title">メッセージ</h2></div><div class="pv2-msg-body"></div></section>';
    content.parentNode.insertBefore(panel, content.nextSibling);
    return panel;
  }
  function _activeView() { var a = document.querySelector('.p-nav-item.active'); return a ? (a.getAttribute('data-view') || 'overview') : 'overview'; }
  function _syncVisibility() { if (_panel) _panel.style.display = (_activeView() === 'overview') ? '' : 'none'; }
  function _observeNav() {
    var items = document.querySelectorAll('.p-nav-item'); if (!items.length) return;
    _obs = new MutationObserver(_syncVisibility);
    _obs.observe(items[0].parentNode, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  function _bindPanel() {
    _panel.addEventListener('click', function (e) {
      var t = e.target;
      if (t.classList && t.classList.contains('pv2-prev') && !t.disabled) { renderHistory(_page - 1); return; }
      if (t.classList && t.classList.contains('pv2-next') && !t.disabled) { renderHistory(_page + 1); return; }
      if (t.classList && t.classList.contains('pv2-msg-send')) { _sendMessage(); return; }
      if (t.closest && t.closest('.pv2-msg-attach')) { var f = _panel.querySelector('.pv2-msg-file'); if (f) f.click(); return; }
      var rm = t.closest ? t.closest('.pv2-pchip [data-pvrm]') : null;
      if (rm) { _pvPending.splice(+rm.getAttribute('data-pvrm'), 1); _pvRenderPending(); return; }
      var row = t.closest ? t.closest('.pv2-row') : null;
      if (row && row.getAttribute('data-ref')) _openDetail(row.getAttribute('data-ref'));
    });
    _panel.addEventListener('change', function (e) {
      var f = e.target.closest && e.target.closest('.pv2-msg-file');
      if (!f) return;
      _pvUpload(f.files); f.value = '';
    });
    _panel.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var row = e.target.closest ? e.target.closest('.pv2-row') : null;
      if (row && row.getAttribute('data-ref')) { e.preventDefault(); _openDetail(row.getAttribute('data-ref')); }
    });
  }

  function init() {
    if (!isEnabled()) {
      console.info('[PortalV2] dormant — CUSTOMER_PORTAL_V2_ENABLED=false; existing portal unchanged (no DOM/style applied).');
      return;
    }
    console.info('[PortalV2] enabled — Profile + History + Details + Rebook + Messaging active.');
    _session = _readSession();
    if (!_session || !_session.email || !_session.ref) { console.info('[PortalV2] no portal session — modules not rendered.'); return; }
    _panel = _mount();
    if (!_panel) { console.warn('[PortalV2] mount point (#content) not found.'); return; }
    _bindPanel(); _observeNav(); _syncVisibility();
    renderProfile(); renderHistory(1); renderMessages();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { isEnabled: isEnabled, init: init, renderProfile: renderProfile, renderHistory: renderHistory, renderMessages: renderMessages, openDetail: _openDetail };
})();
