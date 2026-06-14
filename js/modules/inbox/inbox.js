'use strict';

/* ════════════════════════════════════════════════════════
   INBOX MODULE  (Phase 31 — Resend Inbound)

   Reads inbox_messages from Supabase and renders them as
   a list of cards inside #messages-container.

   Public API exposed on window:
     renderInbox()   — called by go('inbox') in navigation.js
   ════════════════════════════════════════════════════════ */

(function () {

  /* ── Helpers ─────────────────────────────────────────── */
  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  }

  /* ── Fetch from Supabase ──────────────────────────────── */
  async function _fetchMessages() {
    const _sb = window.SupabaseClient;
    if (!_sb) {
      console.error('[INBOX] SupabaseClient not available');
      return [];
    }

    const { data, error } = await _sb
      .from('inbox_messages')
      .select('id, sender, email, subject, body, booking_id, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[INBOX] Fetch failed:', error.message);
      return [];
    }

    return data || [];
  }

  /* ── Render ───────────────────────────────────────────── */
  function _renderMessages(messages) {
    const container = document.getElementById('messages-container');
    if (!container) return;

    if (messages.length === 0) {
      container.innerHTML = `
        <div class="empty" style="padding:60px 0;text-align:center;color:var(--gray-2)">
          <svg viewBox="0 0 24 24" width="40" height="40" style="margin-bottom:12px;opacity:.35"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>
          <p style="font-size:14px">受信メッセージはありません</p>
        </div>`;
      return;
    }

    const cards = messages.map(m => {
      const bookingTag = m.booking_id
        ? `<span style="display:inline-block;padding:2px 8px;background:rgba(37,99,235,.1);color:var(--blue);font-size:11px;font-weight:600;border-radius:4px;margin-left:8px">${_esc(m.booking_id)}</span>`
        : '';

      return `
        <div class="panel" style="margin-bottom:12px;padding:18px 20px">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px">
                <span style="font-size:14px;font-weight:600;color:var(--ink)">${_esc(m.subject || '(件名なし)')}</span>
                ${bookingTag}
              </div>
              <div style="font-size:12px;color:var(--gray-1)">
                <strong>${_esc(m.sender)}</strong>
                &lt;<a href="mailto:${_esc(m.email)}" style="color:var(--blue)">${_esc(m.email)}</a>&gt;
              </div>
            </div>
            <time style="font-size:11px;color:var(--gray-2);white-space:nowrap;flex-shrink:0">${_fmtDate(m.created_at)}</time>
          </div>
          <div style="font-size:13px;color:var(--ink-2);line-height:1.7;white-space:pre-wrap;border-top:1px solid var(--line);padding-top:10px">${_esc(m.body)}</div>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div class="panel-hd" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
        <h2 style="font-size:16px;font-weight:700;color:var(--ink)">受信トレイ <span style="font-size:12px;font-weight:400;color:var(--gray-2);margin-left:6px">${messages.length}件</span></h2>
        <button class="btn btn-ghost btn-sm" onclick="renderInbox()">
          <svg viewBox="0 0 24 24" width="14" height="14" style="margin-right:4px"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
          更新
        </button>
      </div>
      ${cards}`;
  }

  /* ── Loading / error states ───────────────────────────── */
  function _showLoading() {
    const container = document.getElementById('messages-container');
    if (!container) return;
    container.innerHTML = `
      <div style="padding:60px 0;text-align:center;color:var(--gray-2);font-size:13px">
        <div class="login-spinner" style="display:inline-block;margin-bottom:12px;border-color:var(--line);border-top-color:var(--blue)"></div>
        <p>メッセージを読み込み中…</p>
      </div>`;
  }

  /* ── Public entry point ───────────────────────────────── */
  async function renderInbox() {
    const view = document.getElementById('view-inbox');
    if (!view) return;

    _showLoading();

    const messages = await _fetchMessages();
    _renderMessages(messages);
  }

  window.renderInbox = renderInbox;

})();
