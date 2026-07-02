'use strict';

/* ════════════════════════════════════════════════════════
   INBOX MODULE — Email Center Phase 1

   Reads inbox_messages and renders them as cards inside
   #messages-container, each with a Reply action. Replies are
   sent through the existing SMTP gateway (send-email.php →
   EmailService.php), logged in `communications` (log_comm:true),
   and threaded via In-Reply-To / References.

   Reuses: window.api (rest.php), window.API_BASE/API_KEY,
   window.toast. No new email system.

   Public API on window:
     renderInbox()                — called by go('inbox')
     inboxOpenReply(id)           — open the reply modal
     inboxSendReply()             — send the composed reply
     inboxCloseReply()            — close the modal
   ════════════════════════════════════════════════════════ */

(function () {

  var _byId = {};                                   // id → message (lookup for reply)
  var MAILBOXES = ['booking@hello-moving.com', 'support@hello-moving.com', 'contact@hello-moving.com'];

  /* ── Helpers ─────────────────────────────────────────── */
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  }
  // mailbox address → send-email.php from_account key
  function _accountForMailbox(mailbox) {
    var local = String(mailbox || '').toLowerCase().split('@')[0];
    if (local === 'booking' || local === 'support' || local === 'contact') return local;
    return 'support';   // safe default when the inbound mailbox is unknown (pre-IMAP rows)
  }

  /* ── Fetch from API (select * → resilient before the migration runs) ── */
  async function _fetchMessages() {
    var _api = window.api;
    if (!_api) { console.error('[INBOX] ApiClient not available'); return []; }
    var res = await _api.from('inbox_messages').select('*')
      .order('created_at', { ascending: false }).limit(200);
    if (res.error) { console.error('[INBOX] Fetch failed:', res.error.message); return []; }
    return res.data || [];
  }

  /* ── Render ───────────────────────────────────────────── */
  function _renderMessages(messages) {
    var container = document.getElementById('messages-container');
    if (!container) return;

    _byId = {};
    messages.forEach(function (m) { _byId[m.id] = m; });

    if (!messages.length) {
      container.innerHTML =
        '<div class="empty" style="padding:60px 0;text-align:center;color:var(--gray-2)">' +
        '<svg viewBox="0 0 24 24" width="40" height="40" style="margin-bottom:12px;opacity:.35"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>' +
        '<p style="font-size:14px">受信メッセージはありません</p></div>';
      return;
    }

    var cards = messages.map(function (m) {
      var bookingTag = m.booking_id
        ? '<span style="display:inline-block;padding:2px 8px;background:rgba(37,99,235,.1);color:var(--blue);font-size:11px;font-weight:600;border-radius:4px;margin-left:8px">' + _esc(m.booking_id) + '</span>'
        : '';
      var mailboxTag = m.mailbox
        ? '<span style="display:inline-block;padding:2px 8px;background:var(--bg-soft-2);color:var(--gray-1);font-size:11px;border-radius:4px;margin-left:8px">→ ' + _esc(m.mailbox) + '</span>'
        : '';
      // Prefer the plain-text body; fall back to legacy `body`.
      var bodyText = (m.body_text != null && m.body_text !== '') ? m.body_text : (m.body || '');
      // Prefer IMAP-parsed sender name + mail Date; fall back to legacy fields.
      var senderName = (m.sender_name != null && m.sender_name !== '') ? m.sender_name : m.sender;
      var whenIso    = m.received_at || m.created_at;
      return '' +
        '<div class="panel" style="margin-bottom:12px;padding:18px 20px">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px">' +
                '<span style="font-size:14px;font-weight:600;color:var(--ink)">' + _esc(m.subject || '(件名なし)') + '</span>' +
                bookingTag + mailboxTag +
              '</div>' +
              '<div style="font-size:12px;color:var(--gray-1)"><strong>' + _esc(senderName) + '</strong> ' +
                '&lt;<a href="mailto:' + _esc(m.email) + '" style="color:var(--blue)">' + _esc(m.email) + '</a>&gt;</div>' +
            '</div>' +
            '<time style="font-size:11px;color:var(--gray-2);white-space:nowrap;flex-shrink:0">' + _fmtDate(whenIso) + '</time>' +
          '</div>' +
          '<div style="font-size:13px;color:var(--ink-2);line-height:1.7;white-space:pre-wrap;border-top:1px solid var(--line);padding-top:10px">' + _esc(bodyText) + '</div>' +
          '<div style="margin-top:12px;display:flex;gap:8px">' +
            '<button class="btn btn-primary btn-sm" onclick="inboxOpenReply(\'' + _esc(m.id) + '\')">' +
              '<svg viewBox="0 0 24 24" width="14" height="14" style="margin-right:4px"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>返信</button>' +
          '</div>' +
        '</div>';
    }).join('');

    container.innerHTML =
      '<div class="panel-hd" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">' +
        '<h2 style="font-size:16px;font-weight:700;color:var(--ink)">受信トレイ <span style="font-size:12px;font-weight:400;color:var(--gray-2);margin-left:6px">' + messages.length + '件</span></h2>' +
        '<button class="btn btn-ghost btn-sm" onclick="renderInbox()">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" style="margin-right:4px"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>更新</button>' +
      '</div>' + cards;
  }

  function _showLoading() {
    var c = document.getElementById('messages-container');
    if (!c) return;
    c.innerHTML = '<div style="padding:60px 0;text-align:center;color:var(--gray-2);font-size:13px">' +
      '<div class="login-spinner" style="display:inline-block;margin-bottom:12px;border-color:var(--line);border-top-color:var(--blue)"></div>' +
      '<p>メッセージを読み込み中…</p></div>';
  }

  /* ── Reply modal (injected once into <body>) ─────────────── */
  function _ensureModal() {
    if (document.getElementById('inboxReplyModal')) return;
    var opts = MAILBOXES.map(function (mb) { return '<option value="' + mb + '">' + mb + '</option>'; }).join('');
    var el = document.createElement('div');
    el.id = 'inboxReplyModal';
    el.setAttribute('style', 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(11,15,23,.45);align-items:center;justify-content:center;padding:20px');
    el.innerHTML =
      '<div class="panel" style="background:#fff;max-width:640px;width:100%;max-height:90vh;overflow:auto;padding:0">' +
        '<div class="panel-head" style="padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">' +
          '<span class="panel-title">返信</span>' +
          '<button class="btn btn-ghost btn-sm" onclick="inboxCloseReply()" aria-label="閉じる">✕</button>' +
        '</div>' +
        '<div class="panel-body" style="padding:18px 20px">' +
          '<input type="hidden" id="irMsgId" />' +
          '<div class="m-row">' +
            '<div class="m-field"><label class="m-label">送信元（メールボックス）</label>' +
              '<select class="input" id="irFrom">' + opts + '</select></div>' +
            '<div class="m-field"><label class="m-label">宛先</label>' +
              '<input class="input" id="irTo" type="email" readonly style="background:var(--bg-soft-2)" /></div>' +
          '</div>' +
          '<div class="m-field" style="margin-top:10px"><label class="m-label">件名</label>' +
            '<input class="input" id="irSubject" type="text" /></div>' +
          '<div class="m-field" style="margin-top:10px"><label class="m-label">本文</label>' +
            '<textarea class="input" id="irBody" rows="9" style="resize:vertical;min-height:150px" placeholder="返信内容を入力してください…"></textarea></div>' +
          '<p id="irStatus" style="display:none;font-size:12.5px;margin-top:10px"></p>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
            '<button class="btn btn-ghost btn-sm" onclick="inboxCloseReply()">キャンセル</button>' +
            '<button class="btn btn-primary btn-sm" id="irSend" onclick="inboxSendReply()">送信する</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
  }

  function _status(msg, kind) {
    var s = document.getElementById('irStatus');
    if (!s) return;
    s.textContent = msg || '';
    s.style.display = msg ? 'block' : 'none';
    s.style.color = kind === 'error' ? '#c23' : (kind === 'success' ? '#0a7d33' : 'var(--gray-2)');
  }

  function inboxOpenReply(id) {
    var m = _byId[id];
    if (!m) return;
    _ensureModal();
    document.getElementById('irMsgId').value = id;
    document.getElementById('irTo').value = m.email || '';
    var subj = m.subject || '';
    document.getElementById('irSubject').value = /^re:/i.test(subj) ? subj : ('Re: ' + subj);
    document.getElementById('irBody').value = '';
    document.getElementById('irFrom').value =
      (_accountForMailbox(m.mailbox) === 'booking' ? MAILBOXES[0]
        : _accountForMailbox(m.mailbox) === 'contact' ? MAILBOXES[2] : MAILBOXES[1]);
    _status('', '');
    document.getElementById('inboxReplyModal').style.display = 'flex';
    document.getElementById('irBody').focus();
  }

  function inboxCloseReply() {
    var el = document.getElementById('inboxReplyModal');
    if (el) el.style.display = 'none';
  }

  async function inboxSendReply() {
    var id      = document.getElementById('irMsgId').value;
    var m       = _byId[id] || {};
    var account = _accountForMailbox(document.getElementById('irFrom').value);
    var to      = (document.getElementById('irTo').value || '').trim();
    var subject = (document.getElementById('irSubject').value || '').trim();
    var body    = (document.getElementById('irBody').value || '').trim();

    if (!to)   { _status('宛先がありません。', 'error'); return; }
    if (!body) { _status('本文を入力してください。', 'error'); return; }

    var base = (window.API_BASE || '').replace(/\/$/, '');
    if (!base) { _status('API_BASE未設定です。', 'error'); return; }

    var payload = {
      from_account: account,
      to:           to,
      subject:      subject || '[Hello Moving] ご返信',
      message:      body,
      booking_id:   m.booking_id || '',
      log_comm:     true,                         // exactly one communications row
    };
    // Thread the reply to the inbound message when we have its Message-ID.
    if (m.message_id) { payload.in_reply_to = m.message_id; payload.references = m.message_id; }

    var btn = document.getElementById('irSend');
    if (btn) { btn.disabled = true; btn.textContent = '送信中…'; }
    _status('送信しています…', 'info');
    try {
      var res = await fetch(base + '/send-email.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' },
        body: JSON.stringify(payload),
      });
      var result = await res.json().catch(function () { return { ok: false, error: 'HTTP ' + res.status }; });
      if (result.ok) {
        _status('返信を送信しました。', 'success');
        if (window.toast) toast('返信を送信しました');
        setTimeout(inboxCloseReply, 900);
      } else {
        var err = result.error && (result.error.message || result.error);
        _status('送信できませんでした：' + (err || ('HTTP ' + res.status)), 'error');
      }
    } catch (e) {
      _status('通信エラーが発生しました。', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '送信する'; }
    }
  }

  /* ── Public entry point ───────────────────────────────── */
  async function renderInbox() {
    if (!document.getElementById('view-inbox')) return;
    _showLoading();
    var messages = await _fetchMessages();
    _renderMessages(messages);
  }

  window.renderInbox     = renderInbox;
  window.inboxOpenReply  = inboxOpenReply;
  window.inboxSendReply  = inboxSendReply;
  window.inboxCloseReply = inboxCloseReply;

})();
