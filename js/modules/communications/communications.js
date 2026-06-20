'use strict';

/* ════════════════════════════════════════════════════════
   COMMUNICATIONS MODULE  (Phase 29 — API integration)

   Source of truth: public.communications (API)
   No localStorage. In-memory cache for synchronous helpers.

   Globals:
     window.CommModule   — UI + CRUD
     window.EmailService — Phase 6 abstraction layer
   ════════════════════════════════════════════════════════ */

(function () {

  const FROM_EMAIL = 'booking@hello-moving.com';

  /* ── In-memory cache (runtime only, not persisted) ───── */
  const _byBooking = new Map();   // bookingId  → row[]
  const _byEmail   = new Map();   // norm email → row[]
  let   _stats     = new Map();   // norm email → { count, lastContact }

  /* ── Row mapper ──────────────────────────────────────── */
  function _map(r) {
    return {
      id:             r.id,
      booking_id:     r.booking_id     || null,
      customer_email: r.customer_email || '',
      sender_email:   r.sender_email   || FROM_EMAIL,
      subject:        r.subject        || '',
      message:        r.message        || '',
      direction:      r.direction      || 'outbound',
      created_at:     r.created_at     || new Date().toISOString(),
      created_by:     r.created_by     || 'admin',
      /* Phase 30 — email delivery status (null on old rows without column) */
      email_status:   r.email_status   || null,
      email_error:    r.email_error    || null,
      sent_at:        r.sent_at        || null,
    };
  }

  /* ── Cache helpers ───────────────────────────────────── */
  function _cacheEntry(entry) {
    if (entry.booking_id) {
      const arr = _byBooking.get(entry.booking_id) || [];
      if (!arr.find(x => x.id === entry.id)) {
        arr.unshift(entry);
        arr.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
        _byBooking.set(entry.booking_id, arr);
      }
    }
    const norm = (entry.customer_email || '').toLowerCase().trim();
    if (norm) {
      const arr = _byEmail.get(norm) || [];
      if (!arr.find(x => x.id === entry.id)) {
        arr.unshift(entry);
        arr.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
        _byEmail.set(norm, arr);
      }
      const s = _stats.get(norm) || { count: 0, lastContact: null };
      s.count = (_byEmail.get(norm) || []).length;
      s.lastContact = (_byEmail.get(norm) || [])[0]?.created_at || null;
      _stats.set(norm, s);
    }
  }

  /* ── booking_id column is text (after phase29b migration). Pass string directly. */
  function _safeBookingId(id) {
    if (!id) return null;
    return String(id);
  }

  /* ── API insert ─────────────────────────────────── */
  async function _insert(payload) {
    payload = { ...payload, booking_id: _safeBookingId(payload.booking_id) };
    const _api = window.api;

    /* ── Step 0: verify client ── */
    console.group('[COMMUNICATIONS] Insert attempt');
    console.log('DataClient:', _api ? 'OK (' + (window.API_BASE || 'url unknown') + ')' : 'NULL — check env.js');

    if (!_api) {
      console.error('[COMMUNICATIONS] Insert failed: ApiClient is null');
      console.groupEnd();
      throw new Error('ApiClient not available');
    }

    /* ── Step 1: log payload ── */
    console.log('[COMMUNICATIONS] Insert payload:', JSON.parse(JSON.stringify(payload)));

    /* ── Step 2: execute insert, capture full response ── */
    const response = await _api
      .from('communications')
      .insert(payload)
      .select('*')
      .single();

    const { data, error, status, statusText } = response;

    console.log('[COMMUNICATIONS] Insert response:');
    console.log('  data       :', data);
    console.log('  error      :', error);
    console.log('  status     :', status);
    console.log('  statusText :', statusText);

    if (error) {
      console.error('[COMMUNICATIONS] Insert failed:', error.code, error.message, error.details, error.hint);
      console.groupEnd();
      throw error;
    }

    if (!data) {
      /* RLS WITH CHECK silently blocked — no error but no row returned */
      const rlsErr = new Error('Insert returned null data — RLS policy likely blocking write (no INSERT policy for anon role)');
      console.error('[COMMUNICATIONS]', rlsErr.message);
      console.groupEnd();
      throw rlsErr;
    }

    console.log('[COMMUNICATIONS] Insert success — id:', data.id);

    /* ── Step 3: immediate verification SELECT ── */
    const verifyRes = await _api
      .from('communications')
      .select('id, booking_id, customer_email, direction, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    console.log('[COMMUNICATIONS] Verification SELECT (top 5):');
    console.log('  data  :', verifyRes.data);
    console.log('  error :', verifyRes.error);
    console.log('  status:', verifyRes.status);

    console.groupEnd();
    return _map(data);
  }

  /* ── API fetch — by booking ─────────────────────── */
  async function _fetchForBooking(bookingId) {
    const _api = window.api;
    const safeId = _safeBookingId(bookingId);
    if (!_api || !safeId) return [];

    const { data, error } = await _api
      .from('communications')
      .select('*')
      .eq('booking_id', safeId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[COMMUNICATIONS] Fetch booking failed:', error.message);
      return [];
    }

    const rows = (data || []).map(_map);
    _byBooking.set(bookingId, rows);
    return rows;
  }

  /* ── API fetch — by email ───────────────────────── */
  async function _fetchForEmail(email) {
    const _api = window.api;
    if (!_api || !email) return [];
    const norm = email.toLowerCase().trim();

    const { data, error } = await _api
      .from('communications')
      .select('*')
      .eq('customer_email', norm)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[COMMUNICATIONS] Fetch email failed:', error.message);
      return [];
    }

    const rows = (data || []).map(_map);
    _byEmail.set(norm, rows);
    if (rows.length) {
      _stats.set(norm, {
        count:       rows.length,
        lastContact: rows[0].created_at,
      });
    }
    return rows;
  }

  /* ── Prefetch aggregate stats for customer table ─────── */
  async function prefetchStats() {
    const _api = window.api;
    if (!_api) return;

    const { data, error } = await _api
      .from('communications')
      .select('customer_email, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[COMMUNICATIONS] prefetchStats failed:', error.message);
      return;
    }

    const map = new Map();
    (data || []).forEach(r => {
      const norm = (r.customer_email || '').toLowerCase().trim();
      if (!norm) return;
      if (!map.has(norm)) map.set(norm, { count: 0, lastContact: null });
      const s = map.get(norm);
      s.count++;
      if (!s.lastContact || r.created_at > s.lastContact) s.lastContact = r.created_at;
    });
    _stats = map;
  }

  /* ── Synchronous query helpers (use in-memory cache) ─── */
  function getByBooking(bookingId) {
    return _byBooking.get(bookingId) || [];
  }

  function getByEmail(email) {
    const norm = (email || '').toLowerCase().trim();
    return norm ? (_byEmail.get(norm) || []) : [];
  }

  function getLastContact(email) {
    const norm = (email || '').toLowerCase().trim();
    return _stats.get(norm)?.lastContact || null;
  }

  function getCount(email) {
    const norm = (email || '').toLowerCase().trim();
    return _stats.get(norm)?.count || 0;
  }

  /* ── State ───────────────────────────────────────────── */
  let _activeBookingId  = null;
  let _activeEmail      = null;

  /* ── Reply Modal — open (from booking detail) ────────── */
  function openReply(bookingId, toEmail, toName, bookingRef, service, date) {
    if (!toEmail) { toast('このお客様のメールアドレスが登録されていません'); return; }
    _activeBookingId = bookingId || null;
    _activeEmail     = (toEmail || '').toLowerCase().trim();

    _setText('replyModalTitle', `返信 — ${esc(bookingRef || bookingId || toName || toEmail)}`);
    _setVal('replyTo',        toEmail);
    _setVal('replyFrom',      FROM_EMAIL);
    _setVal('replySubject',   `[Hello Moving] ご予約について — ${bookingRef || bookingId || ''}`);
    _setVal('replyMessage',
      `${toName || 'お客様'}様\n\nHello Movingです。\nこの度はお問い合わせいただきありがとうございます。\n\n予約番号：${bookingRef || bookingId || ''}\n` +
      (service ? `サービス：${service}\n` : '') +
      (date    ? `引越し日：${date}\n`    : '') + '\n');

    document.getElementById('replyMessage')?.focus();
    document.getElementById('replyModal').classList.add('open');
  }

  /* ── Reply Modal — open (quick reply from customer view) */
  function openQuickReply(email, name, contextLabel) {
    if (!email) { toast('メールアドレスが登録されていません'); return; }
    _activeBookingId = null;
    _activeEmail     = (email || '').toLowerCase().trim();

    _setText('replyModalTitle', `メッセージ送信 — ${esc(contextLabel || name || email)}`);
    _setVal('replyTo',      email);
    _setVal('replyFrom',    FROM_EMAIL);
    _setVal('replySubject', '[Hello Moving] ご連絡');
    _setVal('replyMessage', `${name || 'お客様'}様\n\nHello Movingです。\n\n`);

    document.getElementById('replyMessage')?.focus();
    document.getElementById('replyModal').classList.add('open');
  }

  /* ── Reply Modal — close ─────────────────────────────── */
  function closeReply() {
    document.getElementById('replyModal').classList.remove('open');
  }

  /* ── Send ────────────────────────────────────────────── */
  async function send() {
    const to        = (_val('replyTo')      || '').trim();
    const fromEmail = (_val('replyFrom')    || FROM_EMAIL).trim();
    const subject   = (_val('replySubject') || '').trim();
    const message   = (_val('replyMessage') || '').trim();

    if (!to)      { toast('宛先メールアドレスが必要です'); return; }
    if (!message) { toast('メッセージ本文を入力してください'); return; }

    const btn = document.getElementById('replySendBtn');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }

    const payload = {
      booking_id:     _activeBookingId || null,
      customer_email: to.toLowerCase().trim(),
      sender_email:   fromEmail,
      subject:        subject || null,
      message:        message,
      direction:      'outbound',
      created_at:     new Date().toISOString(),
      created_by:     'admin',
      email_status:   'pending',
    };

    /* Snapshot context — modal closes before async delivery resolves */
    const snapBookingId = _activeBookingId;
    const snapEmail     = _activeEmail;

    try {
      /* Step 1: save communication record (always, regardless of email outcome) */
      const entry = await _insert(payload);
      _cacheEntry(entry);

      /* Step 2: close modal + toast immediately — record is safe */
      toast('保存しました。メール送信中...');
      closeReply();

      /* Step 3: attempt email delivery asynchronously — does not block UI */
      _deliverAndUpdate(entry, fromEmail).then(() => {
        if (snapBookingId) renderTimeline(snapBookingId, 'detailCommHistory');
        const custEl = document.getElementById('custCommHistory');
        if (custEl && snapEmail) renderCustomerTimeline(snapEmail, 'custCommHistory');
      });

    } catch (err) {
      toast('保存に失敗しました — コンソールを確認してください');
    } finally {
      if (btn) {
        btn.disabled  = false;
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" style="vertical-align:middle;margin-right:4px"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>送信';
      }
    }
  }

  /* ── Delivery + status update (called after insert) ─────
     Communication record is always already saved before this runs.
     A failure here only affects email_status — data is never lost.
     ─────────────────────────────────────────────────────── */
  async function _deliverAndUpdate(entry, fromEmail) {
    try {
      const result = await EmailService._deliver({
        communication_id: entry.id,
        from_account:     _emailToAccount(fromEmail || entry.sender_email),
        to:               entry.customer_email,
        subject:          entry.subject,
        message:          entry.message,
        booking_id:       entry.booking_id || '',
      });
      if (result.ok) {
        await _updateEmailStatus(entry.id, 'sent', null, new Date().toISOString());
        console.log('[COMMUNICATIONS] Email delivered — comm id:', entry.id, 'from:', result.from);
      } else {
        const errMsg = result.error || 'Delivery failed';
        await _updateEmailStatus(entry.id, 'failed', errMsg, null);
        console.warn('[COMMUNICATIONS] Email delivery failed — comm id:', entry.id, 'reason:', errMsg);
        toast('保存済み。メール送信失敗 — 履歴から再送できます');
      }
    } catch (err) {
      const errMsg = err.message || 'Network error';
      await _updateEmailStatus(entry.id, 'failed', errMsg, null);
      console.error('[COMMUNICATIONS] Delivery exception — comm id:', entry.id, err);
      toast('保存済み。メール送信失敗 — 履歴から再送できます');
    }
  }

  /* ── Map email address → PHP from_account key ───────── */
  function _emailToAccount(email) {
    const local = (email || '').toLowerCase().split('@')[0];
    if (local === 'support') return 'support';
    if (local === 'contact') return 'contact';
    return 'booking';
  }

  /* ── Update email_status in API ────────────────── */
  async function _updateEmailStatus(commId, status, errorMsg, sentAt) {
    const _api = window.api;
    if (!_api || !commId) return;

    const patch = { email_status: status };
    if (errorMsg !== null) patch.email_error = errorMsg;
    if (sentAt   !== null) patch.sent_at = sentAt;

    const { error } = await _api
      .from('communications')
      .update(patch)
      .eq('id', commId);

    if (error) console.warn('[COMMUNICATIONS] email_status update failed:', error.message);

    /* Also update in-memory caches */
    for (const arr of [..._byBooking.values(), ..._byEmail.values()]) {
      const row = arr.find(r => r.id === commId);
      if (row) {
        row.email_status = status;
        if (errorMsg !== null) row.email_error = errorMsg;
        if (sentAt   !== null) row.sent_at = sentAt;
      }
    }
  }

  /* ── Resend failed email ─────────────────────────────── */
  async function resendEmail(commId) {
    const _api = window.api;
    if (!_api) { toast('API接続がありません'); return; }

    const { data, error } = await _api
      .from('communications')
      .select('*')
      .eq('id', commId)
      .single();

    if (error || !data) { toast('記録が見つかりません'); return; }

    toast('再送中...');
    await _updateEmailStatus(commId, 'pending', null, null);
    await _deliverAndUpdate(_map(data), data.sender_email);

    /* Refresh whichever timeline is currently visible */
    if (data.booking_id) renderTimeline(data.booking_id, 'detailCommHistory');
    const custEl = document.getElementById('custCommHistory');
    if (custEl && data.customer_email) renderCustomerTimeline(data.customer_email, 'custCommHistory');
  }

  /* ── Booking Communication Timeline ─────────────────── */
  async function renderTimeline(bookingId, containerId) {
    const el = document.getElementById(containerId || 'detailCommHistory');
    if (!el) return;

    el.innerHTML = _buildLoading();

    const rows = await _fetchForBooking(bookingId);
    el.innerHTML = _buildTimeline(rows, 'コミュニケーション履歴', false);
  }

  /* ── Customer Communication Timeline (CRM modal) ─────── */
  async function renderCustomerTimeline(email, containerId) {
    const el = document.getElementById(containerId);
    if (!el || !email) return;

    el.innerHTML = _buildLoading();

    const rows = await _fetchForEmail(email);
    el.innerHTML = _buildTimeline(rows.slice(0, 20), 'コミュニケーション履歴', true);
  }

  /* ── Email status badge ──────────────────────────────── */
  function _emailStatusBadge(c) {
    const st = c.email_status;
    if (!st || st === 'pending') {
      return `<span style="font-size:10px;font-weight:600;color:#92400e;background:#fffbeb;padding:2px 7px;border-radius:10px;border:1px solid #fde68a">送信待ち</span>`;
    }
    if (st === 'sent') {
      const sentLabel = c.sent_at ? fmtDT(c.sent_at) : '';
      return `<span style="font-size:10px;font-weight:600;color:#047857;background:#ecfdf5;padding:2px 7px;border-radius:10px;border:1px solid #a7f3d0" title="${esc(sentLabel)}">配信済み</span>`;
    }
    if (st === 'failed') {
      return `<span style="font-size:10px;font-weight:600;color:#b91c1c;background:#fef2f2;padding:2px 7px;border-radius:10px;border:1px solid #fecaca">配信失敗</span>`;
    }
    return '';
  }

  /* ── Timeline HTML ───────────────────────────────────── */
  function _buildLoading() {
    return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line-2)">
      <div style="font-size:12px;color:var(--gray-2);padding:6px 0">読み込み中...</div>
    </div>`;
  }

  function _buildTimeline(rows, label, compact) {
    const countBadge = `<span style="font-weight:400;color:var(--gray-2);font-size:11px">${rows.length}件</span>`;
    const header = `<div style="font-size:12px;font-weight:600;color:var(--gray-1);margin-bottom:8px">${esc(label)} ${countBadge}</div>`;

    if (!rows.length) {
      return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line-2)">
        ${header}<div style="font-size:12px;color:var(--gray-2);padding:4px 0">履歴がありません</div>
      </div>`;
    }

    const items = rows.map(c => {
      const isOut  = c.direction !== 'inbound';
      const dirBadge = isOut
        ? `<span style="font-size:10px;font-weight:600;color:#059669;background:#f0fdf4;padding:2px 7px;border-radius:10px;border:1px solid #bbf7d0">送信</span>`
        : `<span style="font-size:10px;font-weight:600;color:#2563eb;background:#eff6ff;padding:2px 7px;border-radius:10px;border:1px solid #bfdbfe">受信</span>`;
      const bg = isOut ? 'var(--bg-2,#f9fafb)' : '#f0f4ff';

      if (compact) {
        return `<div style="padding:8px 10px;border:1px solid var(--line);border-radius:7px;margin-bottom:6px;background:${bg}">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
            ${dirBadge}
            <span style="font-size:11px;font-weight:600;color:var(--ink);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.subject || '（件名なし）')}</span>
            <span style="font-size:10px;color:var(--gray-2);flex-shrink:0">${fmtDT(c.created_at)}</span>
          </div>
          <div style="font-size:11px;color:var(--gray-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.message)}</div>
        </div>`;
      }

      const emailStatusBadge = isOut ? _emailStatusBadge(c) : '';

      return `<div style="padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;background:${bg}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap">
          ${dirBadge}
          ${emailStatusBadge}
          <span style="font-size:11px;font-weight:600;color:var(--ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.subject || '（件名なし）')}</span>
          <span style="font-size:10px;color:var(--gray-2);flex-shrink:0">${fmtDT(c.created_at)}</span>
        </div>
        <div style="font-size:11px;color:var(--gray-1);margin-bottom:6px">
          ${isOut ? esc(c.sender_email) + ' → ' + esc(c.customer_email) : esc(c.customer_email) + ' → ' + esc(c.sender_email)}
        </div>
        <div style="font-size:12px;color:var(--ink);white-space:pre-wrap;line-height:1.5;padding-top:6px;border-top:1px solid var(--line-2)">${esc(c.message)}</div>
        ${isOut && c.email_status === 'failed' ? `<div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--line-2);display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:11px;color:#b91c1c;flex:1">${esc(c.email_error || 'メール送信失敗')}</span><button onclick="CommModule.resendEmail(${c.id})" style="font-size:11px;padding:3px 10px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;color:#b91c1c;cursor:pointer;white-space:nowrap">再送信</button></div>` : ''}
      </div>`;
    }).join('');

    const maxH = compact ? '160px' : '260px';
    return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line-2)">
      ${header}
      <div style="max-height:${maxH};overflow-y:auto">${items}</div>
    </div>`;
  }

  /* ── DOM helpers ─────────────────────────────────────── */
  function _setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
  function _setVal(id, v)     { const el = document.getElementById(id); if (el) el.value = v; }
  function _val(id)           { return document.getElementById(id)?.value || ''; }

  /* ── Console diagnostic — call CommModule.diagnose() ─── */
  async function diagnose() {
    const _api = window.api;
    console.group('[COMMUNICATIONS] Full diagnostic');

    console.log('API_BASE        :', window.API_BASE || '(not set)');
    console.log('DataClient      :', _api ? 'OK' : 'NULL');

    if (!_api) {
      console.error('Cannot continue — ApiClient is null. Check js/config/env.js.');
      console.groupEnd();
      return;
    }

    /* 1. Verify table is reachable and readable */
    console.log('\n--- SELECT test ---');
    const selRes = await _api
      .from('communications')
      .select('id, booking_id, customer_email, direction, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    console.log('SELECT data  :', selRes.data);
    console.log('SELECT error :', selRes.error);
    console.log('SELECT status:', selRes.status, selRes.statusText);

    /* 2. Try a probe insert with a clearly fake booking */
    const probe = {
      booking_id:     '__DIAG_TEST__',
      customer_email: 'diag@hello-moving.com',
      sender_email:   FROM_EMAIL,
      subject:        '[DIAG] probe insert',
      message:        'Diagnostic test — safe to delete',
      direction:      'outbound',
      created_at:     new Date().toISOString(),
      created_by:     'diagnose()',
    };
    console.log('\n--- INSERT probe ---');
    console.log('Payload:', probe);

    const insRes = await _api
      .from('communications')
      .insert(probe)
      .select('*')
      .single();

    console.log('INSERT data      :', insRes.data);
    console.log('INSERT error     :', insRes.error);
    console.log('INSERT status    :', insRes.status);
    console.log('INSERT statusText:', insRes.statusText);

    if (insRes.error) {
      console.error('INSERT FAILED:', insRes.error.code, insRes.error.message);
      if (insRes.error.code === '42501') console.error('→ RLS is blocking INSERT. Run the migration SQL to add anon INSERT policy.');
      if (insRes.error.code === '42P01') console.error('→ Table does not exist. Run the migration SQL first.');
    } else if (!insRes.data) {
      console.error('INSERT returned null data — RLS WITH CHECK blocking write silently.');
    } else {
      console.log('INSERT OK — row id:', insRes.data.id);

      /* 3. Verify it appears in a fresh SELECT */
      const verRes = await _api
        .from('communications')
        .select('id, customer_email, created_at')
        .eq('id', insRes.data.id)
        .single();
      console.log('\n--- Verify row visible ---');
      console.log('Verify data :', verRes.data);
      console.log('Verify error:', verRes.error);
      if (verRes.data) console.log('✅ Row is visible in the database — write path works.');
      else console.error('❌ Row not returned in SELECT — RLS SELECT policy missing.');

      /* 4. Clean up — remove the probe row so it does not persist */
      console.log('\n--- Cleanup probe row ---');
      const delRes = await _api
        .from('communications')
        .delete()
        .eq('id', insRes.data.id);
      console.log('DELETE error :', delRes.error);
      console.log('DELETE status:', delRes.status);
      if (delRes.error) {
        console.error('❌ Probe row NOT deleted — remove id', insRes.data.id, 'manually.');
        if (delRes.error.code === '42501') console.error('→ RLS is blocking DELETE. No anon DELETE policy.');
      } else {
        console.log('🧹 Probe row deleted — id', insRes.data.id);
      }
    }

    console.groupEnd();
  }

  /* ── Public API ──────────────────────────────────────── */
  window.CommModule = {
    openReply,
    openQuickReply,
    closeReply,
    send,
    renderTimeline,
    renderCustomerTimeline,
    prefetchStats,
    getByBooking,
    getByEmail,
    getLastContact,
    getCount,
    resendEmail,
    diagnose,
  };

  /* ── EmailService — delivery via Resend Edge Function ─── */
  window.EmailService = {
    FROM_EMAIL,

    async send({ to, from, subject, message, bookingId, direction, createdBy }) {
      return _insert({
        booking_id:     bookingId || null,
        customer_email: (to || '').toLowerCase().trim(),
        sender_email:   from || FROM_EMAIL,
        subject:        subject  || null,
        message:        message  || '',
        direction:      direction || 'outbound',
        created_at:     new Date().toISOString(),
        created_by:     createdBy || 'admin',
      });
    },

    /* Sends email via the PHP API (hm-api/send-email.php) */
    async _deliver(record) {
      const url = (window.API_BASE || '').replace(/\/$/, '') + '/send-email.php';

      console.log('[COMMUNICATIONS] _deliver → API:', url);
      console.log('[COMMUNICATIONS] _deliver payload:', record);

      try {
        const res = await fetch(url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        });

        const result = await res.json().catch(() => ({
          ok:    false,
          error: `Edge Function returned non-JSON (HTTP ${res.status})`,
        }));

        console.log('[COMMUNICATIONS] _deliver response:', res.status, result);
        return result;    /* { ok, from, messageId } or { ok, error } */

      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)) || 'fetch failed';
        console.error('[COMMUNICATIONS] _deliver fetch error:', msg);
        return { ok: false, error: msg };
      }
    },
  };

})();
