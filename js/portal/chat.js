// js/portal/chat.js → window.PortalChat
// LINE-style customer chat for the マイページ portal, on top of inbox_messages.
//
// Every reservation has ONE chat room (server thread_id 'chat:<bookingId>').
// This module is a self-contained, mountable controller:
//     PortalChat.mount(container, { email, ref, name })
//     PortalChat.unmount()
// It renders the bubble UI, AJAX-polls hm-api/chat.php for a real-time feel
// (no WebSockets), and sends text + media. Media is uploaded through the
// existing storage.php private `chat` bucket (server-side MIME validation from
// bytes); the message row only stores the path, and reads use short-lived
// signed URLs returned by chat.php. Admin replies from the existing Inbox land
// in the same room and appear here automatically on the next poll.
//
// Reuses window.api.storage (the same seam PortalPhotos/PortalDocs use). Adds no
// database tables and no new storage mechanism.

(function () {
  'use strict';

  var BUCKET      = 'chat';
  var POLL_MS     = 5000;                     // AJAX poll interval (real-time feel)
  var MAX_BYTES   = 15 * 1024 * 1024;         // 15 MB (matches storage.php default)
  var ALLOWED     = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
  var UPLOAD_CONCURRENCY = 2;                 // upload N files at a time (queue)

  var _ctx    = null;    // { email, ref, name }
  var _host   = null;    // mounted container element
  var _timer  = null;    // poll timer
  var _bookingId = null; // server-resolved bookings.id (for upload path scoping)
  var _lastSig = '';     // signature of last render (skip needless re-render)
  var _sending = false;
  var _uploading = false;// an upload batch is in flight (optimistic previews shown)
  var _mounted = false;

  function _base() { return (window.API_BASE || '').replace(/\/$/, ''); }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _fmtTime(iso) {
    if (!iso) return '';
    // T3 — one consistent full timestamp across Portal / Ops / Admin (local TZ).
    if (window.HMFmt) return HMFmt.msgTime(iso, 'ja');
    var d = new Date(iso.indexOf('T') > 0 ? iso : iso.replace(' ', 'T'));
    if (isNaN(d)) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function _isImg(mime) { return /^image\//.test(mime || ''); }
  function _safeName(name) {
    var dot = (name || '').lastIndexOf('.');
    var ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'dat';
    return Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  }

  // ── One-time PORTAL-CHROME styles ────────────────────────────────────────
  // The bubble primitives (.pchat-row/.pchat-bubble/.pchat-media/…) are shared
  // with the admin Inbox and live in css/chat-bubbles.css (loaded via a <link>
  // in portal.html). Only the portal-specific frame, scroll area and input bar
  // are injected here so they never leak into the admin surface.
  function _injectStyles() {
    if (document.getElementById('pchat-styles')) return;
    var css =
      '.pchat{display:flex;flex-direction:column;height:min(68vh,620px);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:#eef1f4}' +
      '.pchat .pchat-stream{flex:1;overflow-y:auto;padding:16px 14px;gap:10px}' +
      '.pchat-bar{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid var(--line)}' +
      '.pchat-attach{width:40px;height:40px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--navy);background:var(--line-3);cursor:pointer;transition:background .2s}' +
      '.pchat-attach:hover{background:var(--line)}' +
      '.pchat-attach svg{width:20px;height:20px}' +
      '.pchat-attach.busy{opacity:.5;pointer-events:none}' +
      '.pchat-attach input{display:none}' +
      '.pchat-input{flex:1;resize:none;border:1px solid var(--line);border-radius:20px;padding:9px 15px;font-size:14px;font-family:var(--font-jp);line-height:1.5;max-height:120px;background:var(--bg-soft)}' +
      '.pchat-input:focus{outline:none;border-color:var(--navy);background:#fff}' +
      '.pchat-send{width:40px;height:40px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--navy);color:#fff;cursor:pointer;transition:opacity .2s}' +
      '.pchat-send[disabled]{opacity:.45;cursor:default}' +
      '.pchat-send svg{width:19px;height:19px}' +
      '.pchat-err{font-size:12px;color:#c0392b;padding:4px 14px 0}';
    var el = document.createElement('style');
    el.id = 'pchat-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  var ATTACH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
  var SEND_ICON   = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  var CAMERA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
  var FILE_ICON   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var TRASH_ICON  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

  // ── API calls ────────────────────────────────────────────────────────────
  async function _post(action, extra) {
    var body = { email: _ctx.email, reference: _ctx.ref };
    if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    var res = await fetch(_base() + '/chat.php?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' },
      body: JSON.stringify(body),
    });
    return res.json().catch(function () { return { ok: false, error: 'bad-response' }; });
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function _dayLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso.indexOf('T') > 0 ? iso : iso.replace(' ', 'T'));
    if (isNaN(d)) return '';
    var dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + dow + '）';
  }

  // `canDelete` (the customer's own media) adds a corner delete control that
  // removes just this one item; `msgId` ties it back to its message.
  function _mediaHtml(a, canDelete, msgId) {
    // Deleted attachment → keep the bubble, show a placeholder (T1).
    if (a && a.deleted) {
      return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#8a8f82;font-style:italic;padding:4px 2px">'
           + TRASH_ICON + '<span>添付ファイルは削除されました</span></span>';
    }
    var del = (canDelete && a.path)
      ? '<button class="pchat-media-del" data-del-media="' + _esc(a.path) + '" data-del-mid="' + _esc(msgId || '') +
        '" title="この画像を削除" aria-label="削除">' + TRASH_ICON + '</button>'
      : '';
    if (_isImg(a.mime) && a.url) {
      return '<a href="' + _esc(a.url) + '" target="_blank" rel="noopener">' +
             '<img class="pchat-media" src="' + _esc(a.url) + '" alt="' + _esc(a.name) + '" loading="lazy"></a>' + del;
    }
    return '<a class="pchat-file" href="' + _esc(a.url || '#') + '" target="_blank" rel="noopener">' +
           FILE_ICON + '<span>' + _esc(a.name || 'ファイル') + '</span></a>' + del;
  }

  // `grouped` = same sender+channel as the previous bubble → hide the
  // avatar/name so a run of messages reads as one messenger-style group.
  function _bubble(m, grouped) {
    var me    = m.sender_type === 'customer';
    var email = (!me && m.channel === 'email');   // formal email reply (vs direct chat)
    var rowCls = 'pchat-row ' + (me ? 'me' : 'them') + (email ? ' email' : '') + (grouped ? ' grp' : '');
    var avatar = me ? ''
      : '<div class="pchat-avatar' + (grouped ? ' pchat-avatar-empty' : '') + '" aria-hidden="true">' + (grouped ? '' : 'HM') + '</div>';

    if (m.deleted) {
      return '<div class="' + rowCls + '">' + avatar +
               '<div class="pchat-bubble-wrap">' +
                 '<div class="pchat-bubble deleted">メッセージを削除しました</div>' +
                 '<div class="pchat-meta">' + _fmtTime(m.created_at) + '</div>' +
               '</div></div>';
    }

    var name = (me || grouped) ? ''
      : (email ? '<span class="pchat-email-tag">✉ メールでの返信</span>'
               : '<div class="pchat-name">' + _esc(m.sender_name || 'Hello Moving') + '</div>');
    var parts = '';
    if (m.text) parts += '<div class="pchat-bubble">' + _esc(m.text) + '</div>';
    (m.attachments || []).forEach(function (a) {
      parts += '<div class="pchat-bubble pchat-media-bubble">' + _mediaHtml(a, me, m.id) + '</div>';
    });
    // Message-level delete only for the customer's own TEXT messages; media is
    // deleted per-item via the corner icon on each thumbnail.
    var del = (me && m.text) ? '<button class="pchat-del" data-del="' + _esc(m.id) + '" title="削除" aria-label="削除">🗑</button>' : '';
    return '<div class="' + rowCls + '">' + avatar +
             '<div class="pchat-bubble-wrap">' + name + parts +
               '<div class="pchat-meta">' + _fmtTime(m.created_at) + '</div>' + del +
             '</div>' +
           '</div>';
  }

  function _groupKey(m) { return m.sender_type + '|' + (m.channel || '') + '|' + (m.deleted ? 'd' : ''); }

  function _renderStream(messages) {
    var stream = _host && _host.querySelector('.pchat-stream');
    if (!stream) return;
    // Cheap change-detection so polling doesn't rebuild/scroll-jump every 5s.
    var sig = messages.map(function (m) {
      return m.id + ':' + (m.deleted ? 'd' : '') + ':' + (m.attachments ? m.attachments.length : 0);
    }).join('|');
    if (sig === _lastSig) return;
    var nearBottom = (stream.scrollHeight - stream.scrollTop - stream.clientHeight) < 80;
    _lastSig = sig;

    if (!messages.length) {
      stream.innerHTML = '<div class="pchat-empty">まだメッセージはありません。<br>ご質問・ご要望をお気軽にどうぞ。担当者が順次ご返信いたします。</div>';
      return;
    }
    var html = '';
    var lastDay = '', lastKey = '';
    messages.forEach(function (m) {
      var day = _dayLabel(m.created_at);
      if (day && day !== lastDay) { html += '<div class="pchat-day">' + _esc(day) + '</div>'; lastDay = day; lastKey = ''; }
      var key = _groupKey(m);
      html += _bubble(m, key === lastKey);
      lastKey = key;
    });
    stream.innerHTML = html;
    if (nearBottom) stream.scrollTop = stream.scrollHeight;
  }

  // Customer deletes one of their own messages → chat.php purges files + leaves
  // a tombstone; the poll refresh reflects it (no reload).
  async function _deleteMessage(id) {
    if (!id) return;
    if (!confirm('このメッセージを削除しますか？')) return;
    _err('');
    try {
      var out = await _post('delete', { id: id });
      if (!out || !out.ok) { _err('削除できませんでした。'); return; }
      _lastSig = '';
      await _poll();
    } catch (_) { _err('削除できませんでした。'); }
  }

  // Customer deletes ONE image from a message → optimistic removal of that
  // thumbnail, then chat.php purges just that file (poll reconciles the rest).
  async function _deleteMedia(id, path, el) {
    if (!id || !path) return;
    if (!confirm('この画像を削除しますか？')) return;
    var bubble = el && el.closest && el.closest('.pchat-media-bubble');
    if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble);   // optimistic
    _err('');
    try {
      var out = await _post('delete-media', { id: id, path: path });
      if (!out || !out.ok) _err('削除できませんでした。');
    } catch (_) { _err('削除できませんでした。'); }
    _lastSig = '';
    await _poll();   // reconcile (tombstone if that was the message's last item)
  }

  // ── Poll loop ────────────────────────────────────────────────────────────
  async function _poll() {
    if (!_mounted || _uploading) return;   // don't wipe optimistic previews mid-upload
    try {
      var out = await _post('list');
      if (out && out.ok && out.data) {
        if (out.data.booking_id) _bookingId = String(out.data.booking_id);
        _renderStream(out.data.messages || []);
      }
    } catch (_) { /* transient — next tick retries */ }
  }
  function _scheduleNext() {
    if (!_mounted) return;
    _timer = setTimeout(function () { _poll().then(_scheduleNext); }, POLL_MS);
  }

  // ── Send ────────────────────────────────────────────────────────────────
  function _err(msg) {
    var e = _host && _host.querySelector('.pchat-err');
    if (e) { e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; }
  }
  async function _sendText() {
    if (_sending) return;
    var input = _host.querySelector('.pchat-input');
    var text  = (input.value || '').trim();
    if (!text) return;
    _sending = true; _err('');
    try {
      var out = await _post('send', { message: text });
      if (!out || !out.ok) { _err('送信できませんでした。時間をおいて再度お試しください。'); return; }
      input.value = ''; input.style.height = 'auto';
      _lastSig = '';                    // force re-render with the new message
      await _poll();
    } catch (_) {
      _err('通信エラーが発生しました。');
    } finally {
      _sending = false;
    }
  }

  // Optimistic preview group appended to the stream while an upload batch is in
  // flight, so the user sees each image "sending" until all are stored + sent.
  function _renderOptimistic(files) {
    var stream = _host && _host.querySelector('.pchat-stream');
    if (!stream) return null;
    var urls = [];
    var media = files.map(function (f) {
      if (/^image\//.test(f.type)) {
        var url = URL.createObjectURL(f);
        urls.push(url);
        return '<div class="pchat-bubble pchat-media-bubble">' +
                 '<img class="pchat-media uploading" src="' + url + '" alt="' + _esc(f.name) + '" loading="lazy"></div>';
      }
      return '<div class="pchat-bubble pchat-media-bubble"><span class="pchat-file">' +
               FILE_ICON + '<span>' + _esc(f.name) + '</span></span></div>';
    }).join('');
    var node = document.createElement('div');
    node.id = 'pchat-optimistic';
    node._objectUrls = urls;   // revoked by the caller once the batch resolves
    node.innerHTML =
      '<div class="pchat-row me">' +
        '<div class="pchat-bubble-wrap">' + media +
          '<div class="pchat-meta" id="pchat-optimistic-meta">アップロード中…</div>' +
        '</div>' +
      '</div>';
    stream.appendChild(node);
    stream.scrollTop = stream.scrollHeight;
    return node;
  }
  function _optimisticStatus(txt) {
    var el = document.getElementById('pchat-optimistic-meta');
    if (el) el.textContent = txt;
  }

  // Multi-file send: validate, upload sequentially (with per-batch progress),
  // then send ONE message carrying all attachments (chat.php accepts up to 10).
  async function _sendFiles(fileInput) {
    var picked = fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
    fileInput.value = '';
    if (!picked.length) return;
    _err('');
    if (!window.api || !window.api.storage) { _err('アップロードを利用できません。'); return; }

    // Downscale/recompress large photos client-side BEFORE the size check so big
    // camera shots pass the 15MB limit and upload fast (mobile-first).
    if (window.HMImageCompress) { try { picked = await HMImageCompress.processAll(picked, { maxEdge: 1600 }); } catch (_) {} }

    var skipped = 0;
    var files = picked.filter(function (f) {
      var ok = ALLOWED.indexOf(f.type) >= 0 && f.size <= MAX_BYTES;
      if (!ok) skipped++;
      return ok;
    });
    if (files.length > 10) { skipped += files.length - 10; files = files.slice(0, 10); }
    if (!files.length) { _err('対応形式は JPG・PNG・PDF（各15MBまで）です。'); return; }

    // Need the server-resolved booking id so upload paths are in-scope.
    if (!_bookingId) { await _poll(); }
    if (!_bookingId) { _err('予約情報を確認できませんでした。'); return; }

    var label = _host.querySelector('.pchat-attach');
    if (label) label.classList.add('busy');
    _uploading = true;                    // pause poll re-render so previews survive
    var node = _renderOptimistic(files);

    try {
      // Bounded-concurrency upload queue (UPLOAD_CONCURRENCY workers pull from a
      // shared cursor) so a large batch never blocks the UI or floods the network.
      // Results are written by index so the final order matches the selection.
      var attachments = new Array(files.length);
      var next = 0, done = 0;
      async function _worker() {
        while (next < files.length) {
          var i = next++;
          var f = files[i];
          var path = _bookingId + '/' + _safeName(f.name);
          var up = await window.api.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
          if (up && up.error) throw new Error('upload');
          attachments[i] = { path: path, name: f.name, mime: f.type, size: f.size };
          done++;
          _optimisticStatus('アップロード中… (' + done + '/' + files.length + ')');
        }
      }
      var workers = [];
      for (var w = 0; w < Math.min(UPLOAD_CONCURRENCY, files.length); w++) workers.push(_worker());
      await Promise.all(workers);
      _optimisticStatus('送信中…');
      var out = await _post('send', { attachments: attachments });
      if (!out || !out.ok) throw new Error('send');
      if (skipped) _err(skipped + '件は対応外のためスキップしました。');
      _uploading = false;
      _lastSig = '';
      if (node && node.parentNode) node.parentNode.removeChild(node);
      await _poll();                       // real (signed) bubbles replace previews
    } catch (_) {
      _uploading = false;
      if (node && node.parentNode) node.parentNode.removeChild(node);
      _err('アップロードに失敗しました。もう一度お試しください。');
    } finally {
      if (label) label.classList.remove('busy');
      if (node && node._objectUrls) node._objectUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (_) {} });
    }
  }

  // ── Mount / unmount ──────────────────────────────────────────────────────
  function mount(container, ctx) {
    if (!container || !ctx || !ctx.email || !ctx.ref) return;
    unmount();
    _injectStyles();
    _ctx = { email: ctx.email, ref: ctx.ref, name: ctx.name || 'お客様' };
    _host = container;
    _bookingId = null; _lastSig = ''; _mounted = true;

    container.innerHTML =
      '<div class="pchat">' +
        '<div class="pchat-stream" aria-live="polite"><div class="pchat-empty">読み込み中…</div></div>' +
        '<div class="pchat-err" style="display:none"></div>' +
        '<div class="pchat-bar">' +
          '<label class="pchat-attach pchat-cam" title="カメラで撮影">' + CAMERA_ICON +
            '<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></label>' +
          '<label class="pchat-attach" title="写真・PDFを添付（複数選択可）">' + ATTACH_ICON +
            '<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"></label>' +
          '<textarea class="pchat-input" rows="1" placeholder="メッセージを入力…" maxlength="4000"></textarea>' +
          '<button class="pchat-send" title="送信" aria-label="送信">' + SEND_ICON + '</button>' +
        '</div>' +
      '</div>';

    var input  = container.querySelector('.pchat-input');
    var sendBt = container.querySelector('.pchat-send');
    var fileIn = container.querySelector('.pchat-attach:not(.pchat-cam) input');
    var camIn  = container.querySelector('.pchat-cam input');   // T2 — camera (mobile) / file picker (desktop)

    // Auto-grow textarea + Enter-to-send (Shift+Enter = newline).
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendText(); }
    });
    sendBt.addEventListener('click', _sendText);
    fileIn.addEventListener('change', function () { _sendFiles(fileIn); });
    if (camIn) camIn.addEventListener('change', function () { _sendFiles(camIn); });
    // Delegated delete (bubbles are re-rendered on every poll).
    container.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var md = e.target.closest('.pchat-media-del[data-del-media]');
      if (md) { e.preventDefault(); _deleteMedia(md.getAttribute('data-del-mid'), md.getAttribute('data-del-media'), md); return; }
      var del = e.target.closest('.pchat-del[data-del]');
      if (del) _deleteMessage(del.getAttribute('data-del'));
    });

    _poll().then(_scheduleNext);
  }

  function unmount() {
    _mounted = false;
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _host = null; _ctx = null; _bookingId = null; _lastSig = '';
  }

  window.PortalChat = { mount: mount, unmount: unmount, POLL_MS: POLL_MS };
})();
