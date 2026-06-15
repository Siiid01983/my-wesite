'use strict';

/* ════════════════════════════════════════════════════════
   ADMIN BOOKINGS MODULE
   CalendarService, BookingService, booking UI rendering
   ════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════
   CALENDAR AVAILABILITY SERVICE  (data-only — no DOM calls)
   Swap Adapter.* calls for async Supabase calls here.
   ════════════════════════════════════════════════════════ */
const CalendarService = {
  getAvailability() {
    const manualOverrides = Adapter.getAvail();
    let counts = {};
    try { counts = JSON.parse(localStorage.getItem('hm_counts') || '{}'); } catch(e) {}
    const cap = Adapter.getCapacity();
    const allDates = new Set([...Object.keys(manualOverrides), ...Object.keys(counts)]);
    const result = {};
    const rank = { available: 0, limited: 1, booked: 2 };
    allDates.forEach(date => {
      const count = counts[date] || 0;
      const countStatus = count >= cap.max ? 'booked' : count >= cap.limited ? 'limited' : null;
      const manual = manualOverrides[date] || null;
      const effective = (!countStatus || (manual && rank[manual] >= rank[countStatus]))
        ? manual : countStatus;
      if (effective) result[date] = effective;
    });
    return result;
  },

  updateAvailability(date, status) {
    Adapter.setDate(date, status);
    this.saveAvailability();
    document.dispatchEvent(new CustomEvent('calendar:updated', {
      detail: { date, status, availability: this.getAvailability() }
    }));
  },

  setBlockedDates(dates, status) {
    dates.forEach(date => Adapter.setDate(date, status));
    this.saveAvailability();
    document.dispatchEvent(new CustomEvent('calendar:blocked', {
      detail: { dates, status, availability: this.getAvailability() }
    }));
  },

  setCapacity(max, limited) {
    Adapter.saveCapacity({ max, limited });
    BookingService.recomputeAll();
    document.dispatchEvent(new CustomEvent('calendar:capacity-changed', {
      detail: { max, limited }
    }));
  },

  saveAvailability() {
    /* Supabase hook point:
       await supabase.from('availability').upsert(this.getAvailability()) */
  }
};

/* ════════════════════════════════════════════════════════
   BOOKING SERVICE  (data-only — no DOM calls)
   Single source of truth: hm_counts drives availability.
   hm_admin_avail is manual override only (more restrictive wins).
   hm_booked is kept in sync for the public calendar on index.html.
   ════════════════════════════════════════════════════════ */
const BookingService = {
  _occupies(bk) {
    return !!(bk && bk.date && bk.status !== 'キャンセル');
  },

  getCounts() {
    try { return JSON.parse(localStorage.getItem('hm_counts') || '{}'); } catch(e) { return {}; }
  },

  computeStatus(date) {
    const cap = Adapter.getCapacity();
    const count = (this.getCounts()[date] || 0);
    if (count >= cap.max) return 'booked';
    if (count >= cap.limited) return 'limited';
    return 'available';
  },

  _adjustCount(date, delta) {
    if (!date) return;
    const counts = this.getCounts();
    counts[date] = Math.max(0, (counts[date] || 0) + delta);
    if (counts[date] === 0) delete counts[date];
    try { localStorage.setItem('hm_counts', JSON.stringify(counts)); } catch(e) {}
  },

  _syncDate(date) {
    if (!date) return 'available';
    const status = this.computeStatus(date);
    /* Sync hm_booked so the public calendar on index.html reflects the same state */
    try {
      const booked = new Set(JSON.parse(localStorage.getItem('hm_booked') || '[]'));
      if (status === 'booked') booked.add(date); else booked.delete(date);
      localStorage.setItem('hm_booked', JSON.stringify([...booked]));
    } catch(e) {}
    return status;
  },

  recordBooking(bk) {
    if (!this._occupies(bk)) return;
    this._adjustCount(bk.date, 1);
    const status = this._syncDate(bk.date);
    document.dispatchEvent(new CustomEvent('booking:created', { detail: { booking: bk, status } }));
    document.dispatchEvent(new CustomEvent('calendar:updated', {
      detail: { date: bk.date, status, source: 'booking' }
    }));
  },

  releaseBooking(bk) {
    if (!this._occupies(bk)) return;
    this._adjustCount(bk.date, -1);
    const status = this._syncDate(bk.date);
    document.dispatchEvent(new CustomEvent('booking:updated', { detail: { booking: bk, status } }));
    document.dispatchEvent(new CustomEvent('calendar:updated', {
      detail: { date: bk.date, status, source: 'booking' }
    }));
  },

  getBookings() { return Adapter.getBookings(); },

  // id + patch object — replaces the old (prev, next) signature.
  // Supabase hook point: await adapter.update(id, patch) here.
  updateBooking(id, patch) {
    const prev = Adapter.getBookings().find(b => b.id === id);
    if (!prev) return null;
    Adapter.updateBooking(id, patch);
    const next = { ...prev, ...patch };
    const dateChanged  = prev.date   !== next.date;
    const activeChanged = this._occupies(prev) !== this._occupies(next);
    if (dateChanged || activeChanged) {
      if (this._occupies(prev)) this._adjustCount(prev.date, -1);
      if (this._occupies(next))  this._adjustCount(next.date,  1);
      [...new Set([prev.date, next.date].filter(Boolean))].forEach(date => {
        const status = this._syncDate(date);
        document.dispatchEvent(new CustomEvent('calendar:updated', {
          detail: { date, status, source: 'booking' }
        }));
      });
    }
    document.dispatchEvent(new CustomEvent('booking:updated', {
      detail: { bookingId: id, move_date: next.date, status: next.status }
    }));
    return next;
  },

  // Sets status to キャンセル, releases the calendar slot, dispatches booking:cancelled.
  // Supabase hook point: await adapter.update(id, { status: 'キャンセル' }) here.
  cancelBooking(id) {
    const bk = Adapter.getBookings().find(b => b.id === id);
    if (!bk) return null;
    Adapter.updateBooking(id, { status: 'キャンセル' });
    if (this._occupies(bk)) {
      this._adjustCount(bk.date, -1);
      const status = this._syncDate(bk.date);
      document.dispatchEvent(new CustomEvent('calendar:updated', {
        detail: { date: bk.date, status, source: 'booking' }
      }));
    }
    document.dispatchEvent(new CustomEvent('booking:cancelled', {
      detail: { bookingId: id, move_date: bk.date, status: 'キャンセル' }
    }));
    return { ...bk, status: 'キャンセル' };
  },

  recomputeAll() {
    /* Called when capacity thresholds change — re-sync hm_booked for every counted date */
    const counts = this.getCounts();
    Object.keys(counts).forEach(date => this._syncDate(date));
    document.dispatchEvent(new CustomEvent('calendar:updated', { detail: { source: 'recompute' } }));
  },

  /* Rebuild hm_counts from hm_admin_bookings on first load.
     Supabase hook point: replace with a server-side count query. */
  bootstrap() {
    const existing = this.getCounts();
    if (Object.keys(existing).length > 0) return; // already populated
    const counts = {};
    Adapter.getBookings().forEach(bk => {
      if (this._occupies(bk)) counts[bk.date] = (counts[bk.date] || 0) + 1;
    });
    try { localStorage.setItem('hm_counts', JSON.stringify(counts)); } catch(e) {}
    Object.keys(counts).forEach(date => this._syncDate(date));
  }
};

/* Expose so healthCheck.js can verify registration */
window.BookingService  = BookingService;
window.CalendarService = CalendarService;

/* ════════════════════════════════════════════════════════
   CALENDAR MANAGEMENT
   ════════════════════════════════════════════════════════ */

function _renderBookingsUI() {
  const filter = document.getElementById('bkFilter')?.value || '';
  const q      = (document.getElementById('bkSearch')?.value || '').toLowerCase();
  const all    = BookingService.getBookings();

  let bk = all;
  if (filter) bk = bk.filter(b => b.status === filter);
  if (q) bk = bk.filter(b =>
    (b.name||'').toLowerCase().includes(q) ||
    (b.email||'').toLowerCase().includes(q) ||
    (b.id||'').toLowerCase().includes(q)
  );

  const statsEl = document.getElementById('bkStatsBar');
  if (statsEl) {
    const count = st => all.filter(b => b.status === st).length;
    statsEl.innerHTML =
      `<span>合計 <strong>${all.length}</strong> 件</span>` +
      `<span>新規 <strong>${count('新規')}</strong></span>` +
      `<span>確認中 <strong>${count('確認中')}</strong></span>` +
      `<span>確定 <strong>${count('確定')}</strong></span>` +
      `<span>完了 <strong>${count('完了')}</strong></span>` +
      `<span>キャンセル <strong>${count('キャンセル')}</strong></span>` +
      `<span style="margin-left:auto">表示中 <strong>${bk.length}</strong> 件</span>`;
  }

  document.getElementById('bookingsWrap').innerHTML =
    bk.length ? buildTable(bk, false) : emptyHTML('該当する予約がありません');
  _renderBkBulkBar();
  _updateHeaderCheckbox();
}

function renderBookings() {
  _renderBookingsUI();
  if (Adapter.supabaseReady) {
    _dpSync('bookings', null, () => Adapter.syncBookings(), 'view-bookings', _renderBookingsUI);
  }
}

function buildTable(bk, compact) {
  const chk = id => !compact ? `<td style="width:36px;text-align:center;padding:8px 4px">
    <input type="checkbox" id="bkCb_${esc(id)}" ${_bkBulkSel.has(id)?'checked':''}
      onchange="_bkToggleRow('${esc(id)}')"
      style="width:14px;height:14px;accent-color:var(--blue);cursor:pointer" />
  </td>` : '';

  const rows = bk.map(b => `<tr>
    ${chk(b.id)}
    <td class="td-mono" style="font-size:11px">${esc(b.id||'—')}</td>
    <td><strong>${esc(b.name||'—')}</strong>${!compact&&b.email?`<br><span class="td-sm">${esc(b.email)}</span>`:''}</td>
    <td>${fmtD(b.date)}</td>
    <td>${badge(b.status||'新規')}</td>
    ${!compact?`<td class="td-sm">${fmtDT(b.createdAt)}</td>`:''}
    <td>
      <div style="display:flex;gap:4px;align-items:center">
        <button class="btn btn-ghost btn-sm btn-icon" onclick="openDetail('${esc(b.id)}')" title="詳細"><svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></button>
        <select class="sel" style="font-size:11px;padding:4px 20px 4px 6px" onchange="quickStatus('${esc(b.id)}',this.value)">
          <option ${b.status==='新規'?'selected':''}>新規</option>
          <option ${b.status==='確認中'?'selected':''}>確認中</option>
          <option ${b.status==='確定'?'selected':''}>確定</option>
          <option ${b.status==='完了'?'selected':''}>完了</option>
          <option ${b.status==='キャンセル'?'selected':''}>キャンセル</option>
        </select>
        <button class="btn btn-danger btn-sm btn-icon" onclick="delBooking('${esc(b.id)}')" title="削除"><svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
      </div>
    </td>
  </tr>`).join('');

  const selectAllTh = !compact ? `<th style="width:36px;text-align:center;padding:8px 4px">
    <input type="checkbox" id="bkSelectAll" title="全選択／解除"
      onchange="_bkToggleAll()"
      style="width:14px;height:14px;accent-color:var(--blue);cursor:pointer" />
  </th>` : '';

  return `<table><thead><tr>
    ${selectAllTh}
    <th>予約番号</th><th>お客様名</th><th>引越し日</th><th>ステータス</th>
    ${!compact?'<th>受付日時</th>':''}
    <th>操作</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

/* emptyHTML() promoted to js/utils/dom.js (shared by admin + Website CMS). */

function quickStatus(id, status) {
  if (status === 'キャンセル') {
    BookingService.cancelBooking(id);
  } else {
    BookingService.updateBooking(id, { status });
  }
  toast('ステータスを更新しました');
  renderDash();
}

function delBooking(id) {
  if (!confirm('この予約を削除しますか？')) return;
  const bk = BookingService.getBookings().find(b => b.id === id);
  Adapter.deleteBooking(id);
  if (bk) BookingService.releaseBooking(bk);
  toast('削除しました');
  renderBookings(); renderDash();
}

function filterToday() {
  document.getElementById('bkSearch').value = '';
  document.getElementById('bkFilter').value = '';
  go('bookings');
}

/* ── Auto-refresh Reservation Management on BookingService events ── */
['booking:created', 'booking:updated', 'booking:cancelled'].forEach(evt => {
  document.addEventListener(evt, () => {
    if (document.getElementById('view-bookings').classList.contains('active')) renderBookings();
    renderDash();
  });
});

/* ════════════════════════════════════════════════════════
   BULK OPERATIONS
   ════════════════════════════════════════════════════════ */
let _bkBulkSel = new Set();

function _visibleBookingIds() {
  const filter = document.getElementById('bkFilter')?.value || '';
  const q      = (document.getElementById('bkSearch')?.value || '').toLowerCase();
  return BookingService.getBookings()
    .filter(b => !filter || b.status === filter)
    .filter(b => !q ||
      (b.name||'').toLowerCase().includes(q) ||
      (b.email||'').toLowerCase().includes(q) ||
      (b.id||'').toLowerCase().includes(q))
    .map(b => b.id);
}

function _bkToggleRow(id) {
  if (_bkBulkSel.has(id)) _bkBulkSel.delete(id); else _bkBulkSel.add(id);
  const cb = document.getElementById('bkCb_' + id);
  if (cb) cb.checked = _bkBulkSel.has(id);
  _updateHeaderCheckbox();
  _renderBkBulkBar();
}

function _bkToggleAll() {
  const cb  = document.getElementById('bkSelectAll');
  const ids = _visibleBookingIds();
  if (cb && cb.checked) ids.forEach(id => _bkBulkSel.add(id));
  else                  ids.forEach(id => _bkBulkSel.delete(id));
  _renderBkBulkBar();
  _renderBookingsUI();
}

function _updateHeaderCheckbox() {
  const cb      = document.getElementById('bkSelectAll');
  if (!cb) return;
  const visible = _visibleBookingIds();
  const all     = visible.length > 0 && visible.every(id => _bkBulkSel.has(id));
  const some    = visible.some(id => _bkBulkSel.has(id));
  cb.checked       = all;
  cb.indeterminate = some && !all;
}

function _renderBkBulkBar() {
  const el = document.getElementById('bkBulkBar');
  if (!el) return;
  const n = _bkBulkSel.size;
  if (n === 0) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = `
    <span style="font-size:13px;font-weight:600;color:var(--blue);flex-shrink:0">${n}件選択中</span>
    <span style="color:var(--line);font-size:18px;flex-shrink:0;line-height:1">|</span>
    <span style="font-size:12px;color:var(--gray-1);flex-shrink:0;white-space:nowrap">ステータス変更：</span>
    <select class="sel" id="bkBulkStatus" style="font-size:12px">
      <option value="新規">新規</option>
      <option value="確認中">確認中</option>
      <option value="確定">確定</option>
      <option value="完了">完了</option>
      <option value="キャンセル">キャンセル</option>
    </select>
    <button class="btn btn-primary btn-sm" onclick="_bkApplyStatus()">適用</button>
    <button class="btn btn-danger btn-sm" onclick="_bkDeleteSelected()">
      <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>削除
    </button>
    <button class="btn btn-ghost btn-sm" onclick="_bkClearSelection()" style="margin-left:auto">✕ 選択解除</button>`;
}

function _bkApplyStatus() {
  const status = document.getElementById('bkBulkStatus')?.value;
  if (!status) return;
  const ids = [..._bkBulkSel];
  ids.forEach(id => {
    if (status === 'キャンセル') BookingService.cancelBooking(id);
    else BookingService.updateBooking(id, { status });
  });
  _bkBulkSel.clear();
  toast(`${ids.length}件を「${status}」に変更しました`);
  renderBookings(); renderDash();
}

function _bkDeleteSelected() {
  const n = _bkBulkSel.size;
  if (!confirm(`選択した${n}件の予約を削除しますか？この操作は取り消せません。`)) return;
  [..._bkBulkSel].forEach(id => {
    const bk = BookingService.getBookings().find(b => b.id === id);
    Adapter.deleteBooking(id);
    if (bk) BookingService.releaseBooking(bk);
  });
  _bkBulkSel.clear();
  toast(`${n}件を削除しました`);
  renderBookings(); renderDash();
}

function _bkClearSelection() {
  _bkBulkSel.clear();
  _renderBkBulkBar();
  _renderBookingsUI();
}

/* ════════════════════════════════════════════════════════
   ADD / EDIT MODAL
   ════════════════════════════════════════════════════════ */
let _editId = null;

function openAdd() {
  _editId = null;
  document.getElementById('editModalTitle').textContent = '予約を追加';
  ['mName','mEmail','mFrom','mTo','mNotes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('mSvc').value = '単身引越し';
  document.getElementById('mStatus').value = '新規';
  document.getElementById('mDate').value = todayStr();
  document.getElementById('mTime').value = '午前 8:00〜12:00';
  document.getElementById('editModal').classList.add('open');
}

function openEdit(id) {
  const b = BookingService.getBookings().find(b => b.id === id); if (!b) return;
  _editId = id;
  document.getElementById('editModalTitle').textContent = '予約を編集';
  document.getElementById('mName').value = b.name||'';
  document.getElementById('mEmail').value = b.email||'';
  document.getElementById('mSvc').value = b.service||'単身引越し';
  document.getElementById('mStatus').value = b.status||'新規';
  document.getElementById('mDate').value = b.date||'';
  document.getElementById('mTime').value = b.time||'';
  document.getElementById('mFrom').value = b.fromAddr||'';
  document.getElementById('mTo').value = b.toAddr||'';
  document.getElementById('mNotes').value = b.notes||'';
  document.getElementById('editModal').classList.add('open');
  closeDetail();
}

function closeEdit() { document.getElementById('editModal').classList.remove('open'); }

/* ── Customer email via Resend Edge Function ─────────────── */
async function _sendBookingEmail(b, trigger) {
  if (!b.email) return;   /* no recipient — skip silently */

  const url = (window.SUPABASE_URL || '').replace(/\/$/, '') + '/functions/v1/send-email';
  const key = window.SUPABASE_ANON_KEY || '';

  const messages = {
    newBooking: `${b.name || 'お客様'}様\n\nこの度はHello Movingにご連絡いただき、誠にありがとうございます。\n以下の内容でご予約を受け付けました。\n\nサービス：${b.service || '—'}\n引越し日：${b.date || '未定'}\n\n担当者より改めてご連絡差し上げます。\nご不明な点がございましたら、お気軽にご連絡ください。\n\nHello Moving 予約担当`,
    statusConfirmed: `${b.name || 'お客様'}様\n\nご予約が正式に確定いたしました。\n\nサービス：${b.service || '—'}\n引越し日：${b.date || '—'}\n受付番号：${b.id}\n\n当日はどうぞよろしくお願いいたします。\n\nHello Moving 予約担当`,
    statusComplete:  `${b.name || 'お客様'}様\n\nこの度は Hello Moving をご利用いただき、誠にありがとうございました。\n\nサービス：${b.service || '—'}\n受付番号：${b.id}\n\nご不明な点やご意見がございましたら、お気軽にお申し付けください。\nまたのご利用を心よりお待ちしております。\n\nHello Moving`,
  };

  const subjects = {
    newBooking:      `[Hello Moving] ご予約を受け付けました — ${b.id}`,
    statusConfirmed: `[Hello Moving] ご予約確定のお知らせ — ${b.id}`,
    statusComplete:  `[Hello Moving] ご利用ありがとうございました — ${b.id}`,
  };

  const from_account = trigger === 'statusComplete' ? 'support' : 'booking';

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${key}`,
        'apikey':        key,
      },
      body: JSON.stringify({
        from_account,
        to:         b.email,
        subject:    subjects[trigger],
        message:    messages[trigger],
        booking_id: b.id,
      }),
    });
    const result = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (result.ok) {
      console.log(`[send-email] ${trigger} → ${b.email} OK`, result.messageId);
    } else {
      console.error(`[send-email] ${trigger} → ${b.email} FAILED`, result.error);
      toast(`メール送信エラー: ${result.error}`);
    }
  } catch (err) {
    console.error(`[send-email] ${trigger} fetch error`, err.message);
  }
}

function saveBooking() {
  const name = document.getElementById('mName').value.trim();
  if (!name) { alert('お客様名を入力してください'); return; }
  const existing = _editId ? BookingService.getBookings().find(b => b.id === _editId) : null;
  const b = {
    id: _editId || genId(),
    name,
    email: document.getElementById('mEmail').value.trim(),
    service: document.getElementById('mSvc').value,
    status: document.getElementById('mStatus').value,
    date: document.getElementById('mDate').value,
    time: document.getElementById('mTime').value,
    fromAddr: document.getElementById('mFrom').value.trim(),
    toAddr: document.getElementById('mTo').value.trim(),
    notes: document.getElementById('mNotes').value.trim(),
    createdAt: existing?.createdAt || new Date().toISOString()
  };
  if (_editId) {
    const prev = BookingService.getBookings().find(x => x.id === _editId);
    BookingService.updateBooking(_editId, b);
    toast('予約を更新しました');
    if (prev && prev.status !== b.status) {
      if (b.status === '確定') {
        sendLineNotif(`✅ 予約確定\n${b.name}様 (${b.id})\nサービス: ${b.service}\n日程: ${b.date}`,'statusConfirmed');
        sendEmailNotif({ subject:`[Hello Moving] 予約確定 - ${b.name}様`, trigger_type:'予約確定', ...bkEmailParams(b) },'statusConfirmed');
        _sendBookingEmail(b, 'statusConfirmed');
      }
      if (b.status === '完了') {
        sendLineNotif(`🎉 引越し完了\n${b.name}様 (${b.id})\nサービス: ${b.service}`,'statusComplete');
        sendEmailNotif({ subject:`[Hello Moving] 引越し完了 - ${b.name}様`, trigger_type:'引越し完了', ...bkEmailParams(b) },'statusComplete');
        _sendBookingEmail(b, 'statusComplete');
      }
    }
  } else {
    Adapter.addBooking(b);
    BookingService.recordBooking(b);
    toast('予約を追加しました');
    sendLineNotif(`📅 新規予約\n${b.name}様\nサービス: ${b.service}\n日程: ${b.date || '未定'}\nID: ${b.id}`,'newBooking');
    sendEmailNotif({ subject:`[Hello Moving] 新規予約 - ${b.name}様`, trigger_type:'新規予約', ...bkEmailParams(b) },'newBooking');
    _sendBookingEmail(b, 'newBooking');
  }
  closeEdit(); renderBookings(); renderDash();
}

/* ════════════════════════════════════════════════════════
   DETAIL MODAL
   ════════════════════════════════════════════════════════ */
function openDetail(id) {
  const b = BookingService.getBookings().find(b => b.id === id); if (!b) return;
  document.getElementById('detailRef').textContent = b.id;
  const r = (l,v) => `<div style="display:flex;padding:8px 0;border-bottom:1px solid var(--line-2);gap:12px"><span style="font-size:12px;color:var(--gray-1);font-weight:500;width:110px;flex-shrink:0">${l}</span><span style="font-size:13px;color:var(--ink);flex:1">${esc(String(v||'—'))}</span></div>`;
  const itemsRow = (b.items && b.items.length)
    ? `<div style="display:flex;padding:8px 0;border-bottom:1px solid var(--line-2);gap:12px">
        <span style="font-size:12px;color:var(--gray-1);font-weight:500;width:110px;flex-shrink:0">お荷物</span>
        <span style="font-size:13px;color:var(--ink);flex:1;display:flex;flex-wrap:wrap;gap:4px;align-items:center">
          ${b.items.map(i => `<span style="display:inline-block;background:var(--bg-2,#f8f9fa);border:1px solid var(--line,#e5e7eb);border-radius:4px;padding:2px 8px;font-size:11px">${esc(i)}</span>`).join('')}
          ${b.workers ? `<span style="font-size:11px;color:var(--gray-1);margin-left:4px">作業員 ${esc(b.workers)}</span>` : ''}
        </span>
      </div>`
    : '';
  document.getElementById('detailBody').innerHTML =
    `<div style="margin-bottom:12px">${badge(b.status||'新規')}</div>` +
    r('サービス',b.service) + r('引越し日',fmtD(b.date)) + r('希望時間帯',b.time) +
    r('お客様名',b.name) + r('メール',b.email) +
    r('引越し元',b.fromAddr) + r('引越し先',b.toAddr) +
    itemsRow +
    r('備考',b.notes) + r('受付日時',fmtDT(b.createdAt));
  document.getElementById('detailPdfBtn').onclick   = () => downloadPDFBooking(id);
  document.getElementById('detailPrintBtn').onclick = () => printBooking(id);
  document.getElementById('detailInvBtn').onclick   = () => InvoiceManager.openModal(id);
  document.getElementById('detailReplyBtn').onclick = () => {
    if (window.CommModule) {
      CommModule.openReply(b.id, b.email, b.name, b.id, b.service, b.date);
    }
  };
  document.getElementById('detailEditBtn').onclick  = () => openEdit(id);
  document.getElementById('detailCrmBtn').onclick   = () => {
    closeDetail();
    if (window.CustomerProfiles && window.CRMUI) {
      var profiles = CustomerProfiles.getAll();
      var email = (b.email || '').toLowerCase().trim();
      var name  = (b.name  || '').toLowerCase().trim();
      var found = profiles.find(p =>
        (email && p.email && p.email.toLowerCase() === email) ||
        (!email && name && p.name && p.name.toLowerCase() === name)
      );
      if (found) { go('crm'); setTimeout(() => CRMUI.select(found.id), 80); return; }
    }
    go('crm');
  };
  document.getElementById('detailDelBtn').onclick   = () => { if(confirm('削除しますか？')){ const _bk=BookingService.getBookings().find(b=>b.id===id); Adapter.deleteBooking(id); BookingService.releaseBooking(_bk); closeDetail(); renderBookings(); renderDash(); toast('削除しました'); }};
  document.getElementById('detailModal').classList.add('open');
  if (window.CommModule) CommModule.renderTimeline(b.id, 'detailCommHistory');
}
function closeDetail() { document.getElementById('detailModal').classList.remove('open'); }

function printBooking(id) {
  const b = BookingService.getBookings().find(b => b.id === id); if (!b) return;
  const e = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const STATUS_COLOR = {
    '新規':'#2563eb','確認中':'#b45309','確定':'#059669','完了':'#4b5563','キャンセル':'#b91c1c'
  };
  const STATUS_BG = {
    '新規':'#eff6ff','確認中':'#fffbeb','確定':'#f0fdf4','完了':'#f9fafb','キャンセル':'#fef2f2'
  };
  const st = b.status || '新規';

  const row = (label, value) => `
    <tr>
      <td style="width:130px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;padding:9px 14px;border-bottom:1px solid #f0f2f5;vertical-align:top;white-space:nowrap">${e(label)}</td>
      <td style="font-size:13px;color:#0b0f17;padding:9px 14px;border-bottom:1px solid #f0f2f5">${e(value||'—')}</td>
    </tr>`;

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>予約確認書 ${e(b.id)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Hiragino Sans','Meiryo','Yu Gothic',sans-serif;font-size:13px;color:#0b0f17;background:#fff;padding:32px 36px}
@media print{body{padding:0}@page{margin:16mm 14mm;size:A4 portrait}}
</style></head><body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #0a1f44;margin-bottom:24px">
  <div style="display:flex;align-items:center;gap:12px">
    <div style="width:40px;height:40px;border-radius:10px;background:#1D9E75;color:#fff;font-size:20px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">H</div>
    <div>
      <div style="font-size:17px;font-weight:700;color:#0a1f44;line-height:1.2">Hello Moving</div>
      <div style="font-size:10px;color:#6b7280;margin-top:1px">ハローム―ビング</div>
    </div>
  </div>
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:700;color:#0a1f44">予約確認書</div>
    <div style="font-size:12px;color:#6b7280;margin-top:3px;font-variant-numeric:tabular-nums">${e(b.id)}</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:2px">出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
  </div>
</div>

<div style="display:inline-flex;align-items:center;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;background:${STATUS_BG[st]||'#f9fafb'};color:${STATUS_COLOR[st]||'#374151'};border:1px solid ${STATUS_COLOR[st]||'#d1d5db'}33;margin-bottom:20px">
  ${e(st)}
</div>

<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:28px">
  ${row('サービス',    b.service)}
  ${row('引越し日',    fmtD(b.date))}
  ${row('希望時間帯',  b.time)}
  ${row('お客様名',    b.name)}
  ${row('メールアドレス', b.email)}
  ${row('引越し元住所', b.fromAddr)}
  ${row('引越し先住所', b.toAddr)}
  ${(b.items && b.items.length) ? row('お荷物', b.items.join(' ／ ') + (b.workers ? `　作業員 ${e(b.workers)}` : '')) : ''}
  ${row('備考・ご要望', b.notes)}
  ${row('受付日時',    fmtDT(b.createdAt))}
</table>

<div style="background:#f8f9fa;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;font-size:11px;color:#6b7280;line-height:1.8;margin-bottom:28px">
  <div style="font-weight:700;color:#374151;margin-bottom:6px;font-size:12px">ご確認事項</div>
  <div>・ご予約内容に変更がある場合は、引越し日の3日前までにご連絡ください。</div>
  <div>・キャンセルポリシーについては別途ご案内の通りです。</div>
  <div>・当日のスタッフ到着時間は前後する場合がございます。</div>
</div>

<div style="display:flex;justify-content:space-between;align-items:flex-end;padding-top:14px;border-top:1px solid #e5e7eb">
  <div style="font-size:10px;color:#9ca3af;line-height:1.7">
    <div>Hello Moving — 引越し専門サービス</div>
    <div>このドキュメントは管理システムから自動生成されました</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#6b7280;line-height:1.7">
    <div style="font-weight:600;color:#0b0f17">Hello Moving</div>
    <div>contact@hello-moving.com</div>
  </div>
</div>

<script>window.onload=function(){setTimeout(function(){window.print();},350);window.onafterprint=function(){window.close();}}<\/script>
</body></html>`;

  const w = window.open('','_blank','width=780,height=680');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}

async function downloadPDFBooking(id) {
  const h = _capturePrintHtml(() => printBooking(id));
  if (h) await _pdfDownload(h, `予約確認書_${id}.pdf`);
}