'use strict';

/* ════════════════════════════════════════════════════════
   INBOX MODULE — Email Center: management, quoting & direct SMTP reply

   Reads inbox_messages and renders them as cards inside
   #messages-container.

   ── Recipient channels (Workstream 2) ─────────────────────
   Every message is classified by the company mailbox that RECEIVED it — the
   existing `mailbox` column (this IS the recipient email; set by the IMAP
   poller, create-booking.php and receive-email.php):
       booking@hello-moving.com   予約 (blue)
       support@hello-moving.com   サポート (amber)
       contact@hello-moving.com   お問い合わせ (green) ← default for legacy /
                                  unclassified rows (inbox-migrate.php backfill)
   The UI adds a channel tab bar (すべて / booking@ / support@ / contact@) and
   a colored recipient badge on every card.

   ── Direct server-side reply (Workstream 1) ───────────────
     • 返信 → reply modal (To / From / 件名 / 本文) → inboxSendReply() POSTs to
       hm-api/send-email.php, which routes through EmailService::deliver():
       transport is _config.php 'mail_mode' ('smtp' → _smtp.php native client
       with the smtp_host/port/user/pass/secure credentials; 'mail' → PHP mail()).
     • The From account is chosen AUTOMATICALLY from the message's channel:
       booking@ msg → from_account 'booking', support@ → 'support',
       contact@ → 'contact'. (SMTP AUTH stays smtp_user; when From differs,
       EmailService discloses it via a Sender: header — RFC 5322 §3.6.2.)
     • Replies are threaded (in_reply_to / references = inbound Message-ID)
       and logged into `communications` (log_comm:true).
     • UX: the send button shows 送信中… while in flight; failures surface the
       server's error + code verbatim PLUS a _config.php troubleshooting hint
       (e.g. smtp_auth → check smtp_user/smtp_pass). A コピー fallback keeps
       the old clipboard path available if SMTP is down.

   ── Management / quoting ──────────────────────────────────
     • 既読/未読 toggle            → is_read (optimistic)
     • 見積送信 modal              → price/expiry/terms → labels.quote (JSON col)
       + 「見積りをコピー」        → professional template → clipboard
     • 削除                        → rest.php delete (staff-gated) + confirm
     • Status pills                → すべて / 未読 / 見積済 / 対応済 (+ text search)
   Quote history lives in the EXISTING labels JSON column (labels.quote =
   {price, expiry, terms, quotedAt}) — no schema migration. DB writes go
   through window.api (rest.php; staff token required for inbox writes);
   the email send goes to send-email.php with X-API-KEY (rate-limited).
   Optimistic UI: the local cache mutates + re-renders instantly; failures
   revert and toast.

   Public API on window:
     renderInbox()                — called by go('inbox')
     inboxToggleRead(id)          — mark read/unread
     inboxDelete(id)              — delete a message
     inboxOpenReply(id)           — open the reply modal (channel-aware From)
     inboxSendReply()             — send via send-email.php (SMTP/mail())
     inboxCopyReply()             — clipboard fallback for the reply text
     inboxCloseReply()            — close the reply modal
     inboxOpenQuote(id)           — open the quote modal (prefilled if quoted)
     inboxSaveQuote()             — persist labels.quote
     inboxCopyQuote()             — copy the formatted quote template
     inboxCloseQuote()            — close the quote modal
     inboxSetFilter(f)/inboxSetChannel(c)/inboxSearch(q)
   ════════════════════════════════════════════════════════ */

(function () {

  var _byId = {};                                   // id → message (lookup)
  var _messages = [];                               // local cache (optimistic UI)
  var _filter = 'all';                              // all | unread | quoted | done
  var _channel = 'all';                             // all | <recipient mailbox>
  var _search = '';

  /* ── Recipient channels (WS2) ─────────────────────────────
     Keyed by the FULL recipient address stored in inbox_messages.mailbox.
     `key` is the send-email.php from_account that replies from the SAME
     channel (Integration Goal: reply From matches the received mailbox). */
  var DEFAULT_CHANNEL = 'contact@hello-moving.com';
  var CHANNELS = ['booking@hello-moving.com', 'support@hello-moving.com', 'contact@hello-moving.com'];
  var CHANNEL_META = {
    'booking@hello-moving.com': { key: 'booking', label: 'booking@', bg: 'rgba(37,99,235,.10)',  fg: '#1d4ed8' },
    'support@hello-moving.com': { key: 'support', label: 'support@', bg: 'rgba(245,158,11,.14)', fg: '#b45309' },
    'contact@hello-moving.com': { key: 'contact', label: 'contact@', bg: 'rgba(16,185,129,.12)', fg: '#0a7d33' }
  };
  // Recipient email of a message. Unknown/missing mailbox → contact@ (the same
  // default inbox-migrate.php backfills, so UI and DB never disagree).
  function _recipientOf(m) {
    var v = String((m && m.mailbox) || '').trim().toLowerCase();
    return CHANNEL_META[v] ? v : DEFAULT_CHANNEL;
  }
  function _channelMeta(m) { return CHANNEL_META[_recipientOf(m)]; }

  /* ── Helpers ─────────────────────────────────────────── */
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  }
  function _fmtYen(n) {
    var v = Number(n);
    return isNaN(v) ? String(n) : '¥' + v.toLocaleString('ja-JP');
  }
  // labels may arrive as object (cast_row) or null — always return an object copy.
  function _labelsOf(m) {
    var l = m && m.labels;
    if (l && typeof l === 'object' && !Array.isArray(l)) return l;
    return {};
  }
  function _quoteOf(m) { var l = _labelsOf(m); return l.quote || null; }
  // A cosmetic toast must never break a data action — toast() writes to #toast
  // without a null guard and throws if that element isn't in the DOM yet.
  function _toast(msg) { if (window.toast) { try { toast(msg); } catch (_) {} } }

  /* ── Fetch from API (select * → resilient before the migration runs) ── */
  async function _fetchMessages() {
    var _api = window.api;
    if (!_api) { console.error('[INBOX] ApiClient not available'); return []; }
    var res = await _api.from('inbox_messages').select('*')
      .order('created_at', { ascending: false }).limit(200);
    if (res.error) { console.error('[INBOX] Fetch failed:', res.error.message); return []; }
    return res.data || [];
  }

  /* ── Filtering ────────────────────────────────────────── */
  function _matchesFilter(m) {
    if (_channel !== 'all' && _recipientOf(m) !== _channel) return false;
    if (_filter === 'unread' && m.is_read) return false;
    if (_filter === 'quoted' && !_quoteOf(m)) return false;
    if (_filter === 'done'   && !m.is_read) return false;
    if (_search) {
      var hay = ((m.sender_name || m.sender || '') + ' ' + (m.email || '') + ' ' +
                 (m.subject || '') + ' ' + (m.body_text || m.body || '') + ' ' +
                 (m.booking_id || '')).toLowerCase();
      if (hay.indexOf(_search.toLowerCase()) < 0) return false;
    }
    return true;
  }

  /* ── Action buttons (per card) ────────────────────────── */
  function _actionBtns(m) {
    var id = _esc(m.id);
    var readIcon = m.is_read
      ? '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M21.99 8c0-.72-.37-1.35-.94-1.7L12 1 2.95 6.3C2.38 6.65 2 7.28 2 8v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2l-.01-10zM12 13 3.74 7.84 12 3l8.26 4.84L12 13z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>';
    return '' +
      '<div class="ibx-actions" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
        '<button class="btn btn-ghost btn-sm" onclick="inboxToggleRead(\'' + id + '\')" title="' + (m.is_read ? '未読にする' : '既読にする') + '">' +
          readIcon + '<span style="margin-left:4px">' + (m.is_read ? '未読に' : '既読に') + '</span></button>' +
        '<button class="btn btn-ghost btn-sm" onclick="inboxOpenReply(\'' + id + '\')" title="返信を作成・送信（差出人は受信チャンネル ' + _esc(_channelMeta(m).label) + ' に自動一致）">' +
          '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg><span style="margin-left:4px">返信</span></button>' +
        '<button class="btn btn-ghost btn-sm" onclick="inboxOpenQuote(\'' + id + '\')" title="見積を作成・送信" style="color:var(--blue)">' +
          '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1H6.32c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg><span style="margin-left:4px">見積送信</span></button>' +
        '<button class="btn btn-ghost btn-sm" onclick="inboxDelete(\'' + id + '\')" title="削除" style="color:#c0392b">' +
          '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg><span style="margin-left:4px">削除</span></button>' +
      '</div>';
  }

  /* ── Render ───────────────────────────────────────────── */
  function _renderMessages() {
    var container = document.getElementById('messages-container');
    if (!container) return;

    _byId = {};
    _messages.forEach(function (m) { _byId[m.id] = m; });

    var shown = _messages.filter(_matchesFilter);
    var counts = {
      all:    _messages.length,
      unread: _messages.filter(function (m) { return !m.is_read; }).length,
      quoted: _messages.filter(function (m) { return !!_quoteOf(m); }).length,
      done:   _messages.filter(function (m) { return !!m.is_read; }).length,
    };

    var pill = function (key, label) {
      var on = _filter === key;
      return '<button class="btn btn-sm" onclick="inboxSetFilter(\'' + key + '\')" style="' +
        (on ? 'background:var(--blue);color:#fff;border:1px solid var(--blue)'
            : 'background:var(--bg);color:var(--gray-1);border:1px solid var(--line)') +
        ';border-radius:999px;padding:4px 12px;font-size:12px">' +
        label + ' <span style="opacity:.75">' + counts[key] + '</span></button>';
    };

    // Channel tab bar (WS2): counts per recipient mailbox over the WHOLE cache
    // (channel is the outer dimension; status pills/search filter within it).
    var chCounts = { all: _messages.length };
    CHANNELS.forEach(function (c) { chCounts[c] = 0; });
    _messages.forEach(function (m) { chCounts[_recipientOf(m)]++; });

    var chTab = function (key, label, meta) {
      var on = _channel === key;
      var style = on
        ? (meta ? 'background:' + meta.fg + ';color:#fff;border:1px solid ' + meta.fg
                : 'background:var(--ink);color:#fff;border:1px solid var(--ink)')
        : 'background:var(--bg);color:var(--gray-1);border:1px solid var(--line)';
      return '<button class="btn btn-sm ibx-ch-tab" data-channel="' + _esc(key) + '" onclick="inboxSetChannel(\'' + _esc(key) + '\')" ' +
        'title="' + (key === 'all' ? '全チャンネル' : '宛先: ' + _esc(key)) + '" style="' + style +
        ';border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600">' +
        label + ' <span style="opacity:.75;font-weight:400">' + chCounts[key] + '</span></button>';
    };
    var channelBar =
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
        '<span style="font-size:11px;color:var(--gray-2);margin-right:2px">宛先チャンネル:</span>' +
        chTab('all', 'すべて', null) +
        CHANNELS.map(function (c) { return chTab(c, CHANNEL_META[c].label, CHANNEL_META[c]); }).join('') +
      '</div>';

    var header =
      '<div class="panel-hd" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
        '<h2 style="font-size:16px;font-weight:700;color:var(--ink)">受信トレイ <span style="font-size:12px;font-weight:400;color:var(--gray-2);margin-left:6px">' + shown.length + ' / ' + _messages.length + '件</span></h2>' +
        '<button class="btn btn-ghost btn-sm" onclick="renderInbox()">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" style="margin-right:4px"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>更新</button>' +
      '</div>' +
      channelBar +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">' +
        pill('all', 'すべて') + pill('unread', '未読') + pill('quoted', '見積済') + pill('done', '対応済') +
        '<input class="input" id="ibxSearch" type="text" placeholder="検索（名前・件名・予約番号）" value="' + _esc(_search) + '" ' +
          'oninput="inboxSearch(this.value)" style="flex:1;min-width:180px;max-width:320px;padding:6px 12px;font-size:12.5px" />' +
      '</div>';

    if (!shown.length) {
      container.innerHTML = header +
        '<div class="empty" style="padding:60px 0;text-align:center;color:var(--gray-2)">' +
        '<svg viewBox="0 0 24 24" width="40" height="40" style="margin-bottom:12px;opacity:.35"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>' +
        '<p style="font-size:14px">' + (_messages.length ? '条件に一致するメッセージはありません' : '受信メッセージはありません') + '</p></div>';
      return;
    }

    var cards = shown.map(function (m) {
      var q = _quoteOf(m);
      var bookingTag = m.booking_id
        ? '<span style="display:inline-block;padding:2px 8px;background:rgba(37,99,235,.1);color:var(--blue);font-size:11px;font-weight:600;border-radius:4px;margin-left:8px">' + _esc(m.booking_id) + '</span>'
        : '';
      // Recipient badge (WS2): ALWAYS shown — unclassified rows read as contact@
      // so every card instantly identifies its inquiry channel.
      var chMeta = _channelMeta(m);
      var mailboxTag =
        '<span class="ibx-ch-badge" title="宛先: ' + _esc(_recipientOf(m)) + '" style="display:inline-block;padding:2px 8px;background:' +
        chMeta.bg + ';color:' + chMeta.fg + ';font-size:11px;font-weight:600;border-radius:4px;margin-left:8px">→ ' + _esc(chMeta.label) + '</span>';
      var quoteTag = q
        ? '<span style="display:inline-block;padding:2px 8px;background:rgba(16,185,129,.12);color:#0a7d33;font-size:11px;font-weight:700;border-radius:4px;margin-left:8px" title="見積済（' + _esc(q.quotedAt ? _fmtDate(q.quotedAt) : '') + '）">見積 ' + _esc(_fmtYen(q.price)) + '</span>'
        : '';
      var unreadDot = !m.is_read
        ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--blue);margin-right:8px;flex-shrink:0" title="未読"></span>'
        : '';
      // Prefer the plain-text body; fall back to legacy `body`.
      var bodyText = (m.body_text != null && m.body_text !== '') ? m.body_text : (m.body || '');
      // Prefer IMAP-parsed sender name + mail Date; fall back to legacy fields.
      var senderName = (m.sender_name != null && m.sender_name !== '') ? m.sender_name : m.sender;
      var whenIso    = m.received_at || m.created_at;
      return '' +
        '<div class="panel ibx-card" style="margin-bottom:12px;padding:18px 20px' + (m.is_read ? ';opacity:.86' : '') + '">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px">' +
                unreadDot +
                '<span style="font-size:14px;font-weight:' + (m.is_read ? '500' : '700') + ';color:var(--ink)">' + _esc(m.subject || '(件名なし)') + '</span>' +
                bookingTag + mailboxTag + quoteTag +
              '</div>' +
              '<div style="font-size:12px;color:var(--gray-1)"><strong>' + _esc(senderName) + '</strong> ' +
                '&lt;<a href="mailto:' + _esc(m.email) + '" style="color:var(--blue)">' + _esc(m.email) + '</a>&gt;</div>' +
            '</div>' +
            '<time style="font-size:11px;color:var(--gray-2);white-space:nowrap;flex-shrink:0">' + _fmtDate(whenIso) + '</time>' +
          '</div>' +
          '<div style="font-size:13px;color:var(--ink-2);line-height:1.7;white-space:pre-wrap;border-top:1px solid var(--line);padding-top:10px">' + _esc(bodyText) + '</div>' +
          '<div style="margin-top:12px;display:flex;justify-content:flex-end;border-top:1px dashed var(--line);padding-top:10px">' + _actionBtns(m) + '</div>' +
        '</div>';
    }).join('');

    container.innerHTML = header + cards;

    // Restore search focus + caret (re-render replaces the input).
    if (_search) {
      var si = document.getElementById('ibxSearch');
      if (si) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }
    }
  }

  function _showLoading() {
    var c = document.getElementById('messages-container');
    if (!c) return;
    c.innerHTML = '<div style="padding:60px 0;text-align:center;color:var(--gray-2);font-size:13px">' +
      '<div class="login-spinner" style="display:inline-block;margin-bottom:12px;border-color:var(--line);border-top-color:var(--blue)"></div>' +
      '<p>メッセージを読み込み中…</p></div>';
  }

  /* ── Filter / search (client-side over the cache) ─────── */
  function inboxSetFilter(f)  { _filter = f; _renderMessages(); }
  function inboxSetChannel(c) { _channel = (c === 'all' || CHANNEL_META[c]) ? c : 'all'; _renderMessages(); }
  function inboxSearch(q)     { _search = q || ''; _renderMessages(); }

  /* ── Mark read/unread (optimistic) ────────────────────── */
  async function inboxToggleRead(id) {
    var m = _byId[id];
    if (!m || !window.api) return;
    var next = !m.is_read;
    m.is_read = next;                    // optimistic
    _renderMessages();
    var res = await window.api.from('inbox_messages').update({ is_read: next }).eq('id', id);
    if (res.error) {
      m.is_read = !next;                 // revert
      _renderMessages();
      _toast('更新に失敗しました：' + res.error.message);
    }
  }

  /* ── Delete (optimistic, with confirm) ────────────────── */
  async function inboxDelete(id) {
    var m = _byId[id];
    if (!m || !window.api) return;
    if (!confirm('このメッセージを削除しますか？\n「' + (m.subject || '(件名なし)') + '」\nこの操作は取り消せません。')) return;
    var idx = _messages.indexOf(m);
    _messages = _messages.filter(function (x) { return x.id !== id; });   // optimistic
    _renderMessages();
    var res = await window.api.from('inbox_messages').delete().eq('id', id);
    if (res.error) {
      if (idx >= 0) _messages.splice(idx, 0, m);                          // revert
      _renderMessages();
      _toast('削除に失敗しました：' + res.error.message);
    } else {
      _toast('メッセージを削除しました');
    }
  }

  /* ── Reply modal — direct server-side send (WS1 / PRIMARY 返信 flow) ──────
     The From identity is NOT chosen by the operator: it is derived from the
     message's recipient channel (mailbox column) so a booking@ inquiry is
     answered from booking@, support@ from support@, contact@ from contact@.
     The send goes through hm-api/send-email.php → EmailService::deliver(),
     which reads the SMTP credentials (smtp_host/port/user/pass/secure) from
     hm-api/_config.php when mail_mode='smtp'. */

  // Editable reply BODY (no pseudo-headers — those are real SMTP headers now).
  function _replyBodyTemplate(m) {
    var name = m.sender_name || m.sender || 'お客';
    var from = _recipientOf(m);
    var lines = [
      name + ' 様',
      '',
      'お問い合わせいただき誠にありがとうございます。',
      'Hello Moving でございます。',
      '',
      '■ 予約番号　　：' + (m.booking_id || '—'),
    ];
    // Quote injection — hard-code the last quoted price only when one exists.
    var q = _quoteOf(m);
    if (q && q.price != null && q.price !== '') {
      var expiry = q.expiry
        ? new Date(q.expiry + 'T00:00:00').toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric' })
        : '—';
      lines.push('■ お見積り金額：' + Number(q.price).toLocaleString('ja-JP') + ' 円（税込）');
      lines.push('■ 有効期限　　：' + expiry);
      if (q.terms) lines.push('■ 条件・備考　：' + q.terms);
    }
    lines.push('');
    lines.push('（↑ こちらにご返信の本文をご記入ください）');
    lines.push('');
    lines.push('ご不明な点がございましたら、お気軽にご連絡ください。');
    lines.push('引き続きどうぞよろしくお願いいたします。');
    lines.push('');
    lines.push('──────────────────');
    lines.push('Hello Moving（ハロームービング）');
    lines.push('Email: ' + from);
    lines.push('TEL: 090-2489-3402');
    lines.push('https://hello-moving.com');
    lines.push('──────────────────');
    return lines.join('\n');
  }

  function _ensureReplyModal() {
    if (document.getElementById('inboxReplyModal')) return;
    var el = document.createElement('div');
    el.id = 'inboxReplyModal';
    el.setAttribute('style', 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(11,15,23,.45);align-items:center;justify-content:center;padding:20px');
    el.innerHTML =
      '<div class="panel" style="background:#fff;max-width:640px;width:100%;max-height:90vh;overflow:auto;padding:0">' +
        '<div class="panel-head" style="padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">' +
          '<span class="panel-title">返信を送信</span>' +
          '<button class="btn btn-ghost btn-sm" onclick="inboxCloseReply()" aria-label="閉じる">✕</button>' +
        '</div>' +
        '<div class="panel-body" style="padding:18px 20px">' +
          '<input type="hidden" id="ircMsgId" />' +
          '<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:12.5px;background:var(--bg-soft-2);border-radius:8px;padding:10px 12px;margin-bottom:12px">' +
            '<span style="color:var(--gray-2)">宛先</span><strong id="ircTo" style="word-break:break-all"></strong>' +
            '<span style="color:var(--gray-2)">差出人</span><span><span id="ircFrom" style="display:inline-block;padding:1px 8px;border-radius:4px;font-weight:600"></span>' +
              '<span style="color:var(--gray-2);margin-left:6px">（受信チャンネルに自動一致）</span></span>' +
          '</div>' +
          '<div class="m-field"><label class="m-label">件名</label>' +
            '<input class="input" id="ircSubject" type="text" /></div>' +
          '<div class="m-field" style="margin-top:10px"><label class="m-label">本文</label>' +
            '<textarea class="input" id="ircText" rows="13" spellcheck="false" style="resize:vertical;min-height:240px;font-size:12.5px;line-height:1.7;font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre"></textarea></div>' +
          '<p id="ircStatus" style="display:none;font-size:12.5px;margin-top:10px;white-space:pre-wrap"></p>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap">' +
            '<button class="btn btn-ghost btn-sm" onclick="inboxCloseReply()">閉じる</button>' +
            '<button class="btn btn-ghost btn-sm" id="ircCopy" onclick="inboxCopyReply()" title="SMTP が使えない場合の予備手段：本文をコピーして Gmail から手動送信">' +
              '<svg viewBox="0 0 24 24" width="13" height="13" style="margin-right:4px"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>コピー</button>' +
            '<button class="btn btn-primary btn-sm" id="ircSend" onclick="inboxSendReply()">' +
              '<svg viewBox="0 0 24 24" width="13" height="13" style="margin-right:4px"><path fill="currentColor" d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>送信する</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
  }

  function _ircStatus(msg, kind) {
    var s = document.getElementById('ircStatus');
    if (!s) return;
    s.textContent = msg || '';
    s.style.display = msg ? 'block' : 'none';
    s.style.color = kind === 'error' ? '#c23' : (kind === 'success' ? '#0a7d33' : 'var(--gray-2)');
  }

  function inboxOpenReply(id) {
    var m = _byId[id];
    if (!m) return;
    _ensureReplyModal();
    var from = _recipientOf(m);
    var meta = CHANNEL_META[from];
    document.getElementById('ircMsgId').value = id;
    document.getElementById('ircTo').textContent = m.email || '';
    var fromEl = document.getElementById('ircFrom');
    fromEl.textContent = from;
    fromEl.style.background = meta.bg;
    fromEl.style.color = meta.fg;
    document.getElementById('ircSubject').value =
      'Re: ' + (m.subject || 'お問い合わせ') + (m.booking_id ? '（予約番号: ' + m.booking_id + '）' : '');
    document.getElementById('ircText').value = _replyBodyTemplate(m);
    var send = document.getElementById('ircSend');
    if (send) { send.disabled = false; send.innerHTML = _IRC_SEND_LABEL; }
    _ircStatus('', '');
    document.getElementById('inboxReplyModal').style.display = 'flex';
  }

  function inboxCloseReply() {
    var el = document.getElementById('inboxReplyModal');
    if (el) el.style.display = 'none';
  }

  var _IRC_SEND_LABEL =
    '<svg viewBox="0 0 24 24" width="13" height="13" style="margin-right:4px"><path fill="currentColor" d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>送信する';

  // Troubleshooting hints per send-email.php error code — points the admin
  // straight at the _config.php key that most likely needs fixing.
  function _smtpHint(code) {
    switch (code) {
      case 'smtp_auth':    return 'ヒント: _config.php の smtp_user / smtp_pass（SMTPパスワード）を確認してください。';
      case 'smtp_config':  return 'ヒント: _config.php の smtp_host / smtp_user / smtp_pass が未設定です。';
      case 'smtp_connect':
      case 'smtp_dns':     return 'ヒント: _config.php の smtp_host / smtp_port を確認してください。';
      case 'smtp_tls':     return 'ヒント: _config.php の smtp_secure（"tls"=587 / "ssl"=465）と smtp_port の組み合わせを確認してください。';
      case 'smtp_unavailable': return 'ヒント: サーバーに _smtp.php / EmailService.php がデプロイされているか確認してください。';
      case 'mail_send':    return 'ヒント: mail_mode="mail" の送信に失敗。cPanel のメール設定 / SPF を確認するか、mail_mode="smtp" への切替を検討してください。';
      case 'invalid_recipient':
      case 'bad_recipient': return 'ヒント: 宛先メールアドレスの形式が不正です。';
      default: return '';
    }
  }

  /* ── Send the reply (server-side SMTP via send-email.php) ─────────────── */
  async function inboxSendReply() {
    var id = document.getElementById('ircMsgId').value;
    var m = _byId[id];
    if (!m) return;
    var to      = String(m.email || '').trim();
    var subject = (document.getElementById('ircSubject').value || '').trim();
    var body    = (document.getElementById('ircText').value || '').trim();
    if (!to || to.indexOf('@') < 0) { _ircStatus('宛先メールアドレスが不正です。', 'error'); return; }
    if (!subject) { _ircStatus('件名を入力してください。', 'error'); return; }
    if (!body)    { _ircStatus('本文を入力してください。', 'error'); return; }

    var from    = _recipientOf(m);                 // channel = From identity
    var account = CHANNEL_META[from].key;          // send-email.php from_account
    var btn = document.getElementById('ircSend');

    // Loading state — clear feedback while the SMTP round-trip runs.
    if (btn) { btn.disabled = true; btn.textContent = '送信中…'; }
    _ircStatus('送信中…（' + from + ' から送信しています）', '');

    var json;
    try {
      var base = (window.API_BASE || '').replace(/\/$/, '');
      var res = await fetch(base + '/send-email.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' },
        body: JSON.stringify({
          to:           to,
          subject:      subject,
          message:      body,
          booking_id:   m.booking_id || '',
          from_account: account,                   // From matches the channel
          in_reply_to:  m.message_id || '',        // thread onto the inbound mail
          references:   m.message_id || '',
          log_comm:     true,                      // record in `communications`
        }),
      });
      json = await res.json().catch(function () {
        return { ok: false, error: 'サーバーが不正な応答を返しました（HTTP ' + res.status + '）' };
      });
    } catch (e) {
      json = { ok: false, error: (e && e.message) || 'ネットワークエラー（APIに接続できません）' };
    }

    if (btn) { btn.disabled = false; btn.innerHTML = _IRC_SEND_LABEL; }

    if (json && json.ok) {
      _ircStatus('送信しました！ 差出人: ' + (json.from || from) +
                 (json.transport ? '（経路: ' + json.transport + '）' : ''), 'success');
      _toast('返信を送信しました');
      // Replying implies the message is handled — mark read (best-effort).
      if (!m.is_read) {
        m.is_read = true;
        _renderMessages();
        if (window.api) {
          window.api.from('inbox_messages').update({ is_read: true }).eq('id', id)
            .then(function (r) { if (r && r.error) console.warn('[INBOX] mark-read after send failed:', r.error.message); });
        }
      }
      setTimeout(inboxCloseReply, 1600);
      return;
    }

    // Explicit failure surface: server error string + code + _config.php hint,
    // so an SMTP auth/config problem is diagnosable without opening the logs.
    var code = (json && json.error_detail && json.error_detail.code) || '';
    var msg  = '送信に失敗しました：' + ((json && json.error) || '不明なエラー') +
               (code ? '（コード: ' + code + '）' : '');
    var hint = _smtpHint(code);
    if (hint) msg += '\n' + hint;
    _ircStatus(msg, 'error');
  }

  /* ── Clipboard fallback (kept for SMTP outages) ───────────────────────── */
  async function inboxCopyReply() {
    var id = document.getElementById('ircMsgId').value;
    var m = _byId[id];
    if (!m) return;
    var from = _recipientOf(m);
    var text = [
      'From: ' + from,
      'To: ' + (m.email || ''),
      '件名: ' + (document.getElementById('ircSubject').value || ''),
      '────────────────────────',
      '',
      document.getElementById('ircText').value || '',
    ].join('\n');
    function _ok() { _ircStatus('コピーしました！' + from + ' の Gmail に貼り付けて送信できます。', 'success'); _toast('コピーしました！'); }
    try {
      await navigator.clipboard.writeText(text);   // copies live edits too
      _ok();
    } catch (e) {
      // Clipboard API blocked (permissions/http) — fallback via hidden textarea.
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); _ok(); }
      catch (_) { _ircStatus('コピーできませんでした。テキストを手動で選択してください。', 'error'); }
      document.body.removeChild(ta);
    }
  }

  /* ── Quote modal ──────────────────────────────────────── */
  function _ensureQuoteModal() {
    if (document.getElementById('inboxQuoteModal')) return;
    var el = document.createElement('div');
    el.id = 'inboxQuoteModal';
    el.setAttribute('style', 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(11,15,23,.45);align-items:center;justify-content:center;padding:20px');
    el.innerHTML =
      '<div class="panel" style="background:#fff;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:0">' +
        '<div class="panel-head" style="padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">' +
          '<span class="panel-title">お見積りの作成</span>' +
          '<button class="btn btn-ghost btn-sm" onclick="inboxCloseQuote()" aria-label="閉じる">✕</button>' +
        '</div>' +
        '<div class="panel-body" style="padding:18px 20px">' +
          '<input type="hidden" id="iqMsgId" />' +
          '<div id="iqPrev" style="display:none;font-size:12px;color:#0a7d33;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);border-radius:8px;padding:8px 12px;margin-bottom:12px"></div>' +
          '<div class="m-field"><label class="m-label">お見積金額（円・税込） <span style="color:#c0392b">*</span></label>' +
            '<input class="input" id="iqPrice" type="number" min="0" step="500" placeholder="例：35000" /></div>' +
          '<div class="m-field" style="margin-top:10px"><label class="m-label">有効期限 <span style="color:#c0392b">*</span></label>' +
            '<input class="input" id="iqExpiry" type="date" /></div>' +
          '<div class="m-field" style="margin-top:10px"><label class="m-label">条件・備考（任意）</label>' +
            '<textarea class="input" id="iqTerms" rows="3" style="resize:vertical" placeholder="例：家具の分解・組立を含みます／駐車料金は別途"></textarea></div>' +
          '<p id="iqStatus" style="display:none;font-size:12.5px;margin-top:10px"></p>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap">' +
            '<button class="btn btn-ghost btn-sm" onclick="inboxCloseQuote()">キャンセル</button>' +
            '<button class="btn btn-ghost btn-sm" id="iqCopy" onclick="inboxCopyQuote()">' +
              '<svg viewBox="0 0 24 24" width="13" height="13" style="margin-right:4px"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>見積りをコピー</button>' +
            '<button class="btn btn-primary btn-sm" id="iqSave" onclick="inboxSaveQuote()">保存する</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
  }

  function _iqStatus(msg, kind) {
    var s = document.getElementById('iqStatus');
    if (!s) return;
    s.textContent = msg || '';
    s.style.display = msg ? 'block' : 'none';
    s.style.color = kind === 'error' ? '#c23' : (kind === 'success' ? '#0a7d33' : 'var(--gray-2)');
  }

  function inboxOpenQuote(id) {
    var m = _byId[id];
    if (!m) return;
    _ensureQuoteModal();
    document.getElementById('iqMsgId').value = id;
    var q = _quoteOf(m);
    // Editable history: pre-fill the previous quote for easy revision.
    document.getElementById('iqPrice').value  = q ? q.price  : '';
    document.getElementById('iqExpiry').value = q ? (q.expiry || '') : '';
    document.getElementById('iqTerms').value  = q ? (q.terms  || '') : '';
    var prev = document.getElementById('iqPrev');
    if (q) {
      prev.textContent = '前回の見積り：' + _fmtYen(q.price) + '（' + (q.quotedAt ? _fmtDate(q.quotedAt) : '—') + ' 作成）— 修正して保存できます。';
      prev.style.display = 'block';
    } else {
      prev.style.display = 'none';
      // Sensible default expiry: 14 days out.
      var d = new Date(Date.now() + 14 * 86400000);
      document.getElementById('iqExpiry').value = d.toISOString().split('T')[0];
    }
    _iqStatus('', '');
    document.getElementById('inboxQuoteModal').style.display = 'flex';
    document.getElementById('iqPrice').focus();
  }

  function inboxCloseQuote() {
    var el = document.getElementById('inboxQuoteModal');
    if (el) el.style.display = 'none';
  }

  function _readQuoteForm() {
    var price  = (document.getElementById('iqPrice').value || '').trim();
    var expiry = (document.getElementById('iqExpiry').value || '').trim();
    var terms  = (document.getElementById('iqTerms').value || '').trim();
    if (!price || isNaN(Number(price)) || Number(price) <= 0) { _iqStatus('金額を正しく入力してください。', 'error'); return null; }
    if (!expiry) { _iqStatus('有効期限を選択してください。', 'error'); return null; }
    return { price: Number(price), expiry: expiry, terms: terms, quotedAt: new Date().toISOString() };
  }

  async function inboxSaveQuote() {
    var id = document.getElementById('iqMsgId').value;
    var m = _byId[id];
    if (!m || !window.api) return;
    var q = _readQuoteForm();
    if (!q) return;
    var prevLabels = _labelsOf(m);
    var nextLabels = {};
    Object.keys(prevLabels).forEach(function (k) { nextLabels[k] = prevLabels[k]; });
    nextLabels.quote = q;
    var oldLabels = m.labels;
    m.labels = nextLabels;               // optimistic
    _renderMessages();
    var btn = document.getElementById('iqSave');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    var res = await window.api.from('inbox_messages').update({ labels: nextLabels }).eq('id', id);
    if (btn) { btn.disabled = false; btn.textContent = '保存する'; }
    if (res.error) {
      m.labels = oldLabels;              // revert
      _renderMessages();
      _iqStatus('保存に失敗しました：' + res.error.message, 'error');
    } else {
      _iqStatus('見積りを保存しました。「見積りをコピー」で送信文を取得できます。', 'success');
      _toast('見積りを保存しました');
    }
  }

  /* ── Professional quote template → clipboard ──────────── */
  function _quoteTemplate(m, q) {
    var name = m.sender_name || m.sender || 'お客';
    var from = _recipientOf(m);          // quote is issued from the same channel
    // Service details: the packed notes section (after ---) of the inbox body.
    var bodyText = (m.body_text || m.body || '');
    var details = bodyText.indexOf('---') >= 0 ? bodyText.split('---').slice(1).join('---').trim() : '';
    if (details.length > 600) details = details.slice(0, 600) + '…';
    var expiry = q.expiry ? new Date(q.expiry + 'T00:00:00').toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric' }) : '—';
    var issued = new Date((q.quotedAt ? new Date(q.quotedAt) : new Date())).toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric' });
    var lines = [
      '━━━━━━━━━━━━━━━━━━━━━━━━',
      '　　　　お 見 積 書 ／ QUOTATION',
      '━━━━━━━━━━━━━━━━━━━━━━━━',
      '発行日：' + issued,
      '発行者：Hello Moving（ハロームービング）',
      '差出人：' + from,
      '',
      name + ' 様',
      '',
      'この度はお問い合わせいただき誠にありがとうございます。',
      '下記の通りお見積りを申し上げます。ご検討のほどよろしくお願い申し上げます。',
      '',
      '───────────────────────',
      '■ 予約番号　　：' + (m.booking_id || '—'),
    ];
    if (details) {
      lines.push('■ ご依頼内容　：');
      lines.push(details);
    }
    lines.push('');
    lines.push('■ お見積金額　：' + _fmtYen(q.price) + '（税込）');
    lines.push('■ 有効期限　　：' + expiry);
    if (q.terms) {
      lines.push('■ 条件・備考　：');
      lines.push(q.terms);
    }
    lines.push('───────────────────────');
    lines.push('');
    lines.push('※ 本見積りは有効期限内のご成約に適用されます。');
    lines.push('ご不明な点がございましたら、お気軽にご連絡ください。');
    lines.push('引き続きどうぞよろしくお願いいたします。');
    lines.push('');
    lines.push('──────────────────');
    lines.push('Hello Moving（ハロームービング）');
    lines.push('国土交通省認可　第 431320058126 号');
    lines.push('Email: ' + from);
    lines.push('TEL: 090-2489-3402');
    lines.push('https://hello-moving.com');
    lines.push('──────────────────');
    return lines.join('\n');
  }

  async function inboxCopyQuote() {
    var id = document.getElementById('iqMsgId').value;
    var m = _byId[id];
    if (!m) return;
    var q = _readQuoteForm();
    if (!q) return;
    var text = _quoteTemplate(m, q);
    try {
      await navigator.clipboard.writeText(text);
      _iqStatus('見積り文をコピーしました。メールに貼り付けて送信してください。', 'success');
      _toast('見積り文をコピーしました');
    } catch (e) {
      // Clipboard API blocked (permissions/http) — fallback via hidden textarea.
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); _iqStatus('見積り文をコピーしました。', 'success'); }
      catch (_) { _iqStatus('コピーできませんでした。手動で選択してください。', 'error'); }
      document.body.removeChild(ta);
    }
  }

  /* ── Public entry point ───────────────────────────────── */
  async function renderInbox() {
    if (!document.getElementById('view-inbox')) return;
    _showLoading();
    _messages = await _fetchMessages();
    _renderMessages();
  }

  window.renderInbox      = renderInbox;
  window.inboxToggleRead  = inboxToggleRead;
  window.inboxDelete      = inboxDelete;
  window.inboxOpenReply   = inboxOpenReply;
  window.inboxSendReply   = inboxSendReply;
  window.inboxCopyReply   = inboxCopyReply;
  window.inboxCloseReply  = inboxCloseReply;
  window.inboxOpenQuote   = inboxOpenQuote;
  window.inboxSaveQuote   = inboxSaveQuote;
  window.inboxCopyQuote   = inboxCopyQuote;
  window.inboxCloseQuote  = inboxCloseQuote;
  window.inboxSetFilter   = inboxSetFilter;
  window.inboxSetChannel  = inboxSetChannel;
  window.inboxSearch      = inboxSearch;

})();
