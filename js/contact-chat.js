'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   Contact Chat — public お問い合わせ chat entry point (booking-INDEPENDENT).

   A first-class, self-contained overlay (like the Estimate/BA chat, but separate
   from it and from BookingService). Flow:

     お問い合わせ launcher
        → 「新しくお問い合わせ」 : category + name + email + message → 確認 →
          contact-chat.php?action=start → Contact ID issued → chat opens
        → 「お問い合わせを再開」   : Contact ID + email → resume → chat opens

   Resume auth is ALWAYS Contact ID + email (the code is never sufficient alone;
   the email is verified server-side). Same-device convenience: the last session
   {code,email} is remembered in localStorage; a different device just re-enters
   the Contact ID + email.

   Text-only in this version (attachments are a deferred follow-up; the retention
   job already purges any future contact/<code> files). Zero external CSS/JS deps:
   all styles are injected once, so nothing needs to be added to the Service Worker
   precache. Reuses the site globals window.API_BASE / window.API_KEY only.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  var POLL_MS  = 5000;
  var LS_KEY   = 'hm_contact_session';   // { code, email, name }
  var CATEGORIES = ['料金・お見積り', '日程・予約の変更', 'サービス内容', '不用品回収・処分', 'その他'];

  var _root = null, _timer = null, _lastSig = '', _sending = false, _sess = null;

  // ── utils ────────────────────────────────────────────────────────────────
  function _base() { return (window.API_BASE || '').replace(/\/$/, ''); }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function _fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso.indexOf('T') > 0 ? iso : iso.replace(' ', 'T'));
    if (isNaN(d)) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function _loadSession() {
    try { var j = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (j && j.code && j.email) return j; } catch (e) {}
    return null;
  }
  function _saveSession(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {} }
  function _clearSession() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }

  async function _post(action, body) {
    var res = await fetch(_base() + '/contact-chat.php?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' },
      body: JSON.stringify(body || {}),
    });
    return res.json().catch(function () { return { ok: false, error: { message: 'HTTP ' + res.status } }; });
  }

  // ── one-time styles ────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('hmcc-styles')) return;
    var css =
      '.hmcc-ov{position:fixed;inset:0;z-index:99999;display:none;align-items:flex-end;justify-content:center;background:rgba(20,26,18,.55)}' +
      '.hmcc-ov.open{display:flex}' +
      '@media(min-width:640px){.hmcc-ov{align-items:center}}' +
      '.hmcc-panel{display:flex;flex-direction:column;width:100%;max-width:480px;height:min(90vh,720px);background:#F9F9F6;border-radius:16px 16px 0 0;overflow:hidden;box-shadow:0 -8px 40px rgba(0,0,0,.3);font-family:"DM Sans",system-ui,sans-serif}' +
      '@media(min-width:640px){.hmcc-panel{border-radius:16px}}' +
      '.hmcc-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:#2C3626;color:#fff}' +
      '.hmcc-head h3{margin:0;font-size:15px;font-weight:700;flex:1;line-height:1.3}' +
      '.hmcc-head .hmcc-sub{font-size:11px;opacity:.7;font-weight:400;display:block;margin-top:1px}' +
      '.hmcc-x{background:none;border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:4px 6px;opacity:.85}' +
      '.hmcc-x:hover{opacity:1}' +
      '.hmcc-body{flex:1;overflow-y:auto;padding:18px 16px}' +
      '.hmcc-choice{display:flex;flex-direction:column;gap:12px;padding:8px 2px}' +
      '.hmcc-choice p.lead{margin:0 0 6px;font-size:13.5px;line-height:1.8;color:#555}' +
      '.hmcc-btn{display:block;width:100%;padding:14px 16px;border-radius:10px;border:1px solid #d7ddcf;background:#fff;color:#2C3626;font-size:15px;font-weight:600;cursor:pointer;text-align:left;transition:background .15s,border-color .15s}' +
      '.hmcc-btn:hover{border-color:#9AB57A;background:#f3f6ec}' +
      '.hmcc-btn.primary{background:#2C3626;color:#fff;border-color:#2C3626;text-align:center}' +
      '.hmcc-btn.primary:hover{background:#3a472f}' +
      '.hmcc-btn small{display:block;font-size:11.5px;font-weight:400;opacity:.7;margin-top:3px}' +
      '.hmcc-field{margin-bottom:14px}' +
      '.hmcc-field label{display:block;font-size:12px;font-weight:600;color:#3a4432;margin-bottom:5px}' +
      '.hmcc-field label em{color:#c23;font-style:normal}' +
      '.hmcc-field input,.hmcc-field select,.hmcc-field textarea{width:100%;padding:10px 12px;border:1px solid #d7ddcf;border-radius:8px;font-size:14px;font-family:inherit;background:#fff;box-sizing:border-box;color:#1f271a}' +
      '.hmcc-field textarea{resize:vertical;min-height:96px;line-height:1.6}' +
      '.hmcc-field input:focus,.hmcc-field select:focus,.hmcc-field textarea:focus{outline:none;border-color:#9AB57A}' +
      '.hmcc-status{font-size:12.5px;line-height:1.7;margin:6px 0 0;min-height:1em}' +
      '.hmcc-status.err{color:#c23}.hmcc-status.ok{color:#0a7d33}.hmcc-status.info{color:#666}' +
      '.hmcc-link{background:none;border:none;color:#5a7040;font-size:12.5px;text-decoration:underline;cursor:pointer;padding:6px 0}' +
      '.hmcc-idcard{background:#fff;border:2px dashed #9AB57A;border-radius:12px;padding:18px 16px;text-align:center;margin:6px 0 14px}' +
      '.hmcc-idcard .lbl{font-size:12px;color:#666;margin:0 0 6px}' +
      '.hmcc-idcard .code{font-size:30px;font-weight:800;letter-spacing:3px;color:#2C3626;font-family:"DM Mono",ui-monospace,monospace;margin:0}' +
      '.hmcc-idcard .copy{margin-top:10px;background:#9AB57A;color:#20301a;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer}' +
      '.hmcc-idcard .copy:hover{background:#8aa869}' +
      '.hmcc-note{font-size:12px;line-height:1.8;color:#555;background:#eef1e7;border-radius:8px;padding:12px 14px;margin-bottom:14px}' +
      /* chat stream */
      '.hmcc-stream{display:flex;flex-direction:column;gap:8px}' +
      '.hmcc-empty{text-align:center;color:#8a8f82;font-size:13px;line-height:1.9;padding:30px 10px}' +
      '.hmcc-day{align-self:center;font-size:11px;color:#8a8f82;background:#e7ebe0;border-radius:10px;padding:2px 12px;margin:8px 0 2px}' +
      '.hmcc-row{display:flex;max-width:82%}' +
      '.hmcc-row.me{align-self:flex-end;justify-content:flex-end}' +
      '.hmcc-row.them{align-self:flex-start}' +
      '.hmcc-b{padding:9px 13px;border-radius:14px;font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word}' +
      '.hmcc-row.me .hmcc-b{background:#2C3626;color:#fff;border-bottom-right-radius:4px}' +
      '.hmcc-row.them .hmcc-b{background:#fff;color:#20271b;border:1px solid #e2e7d8;border-bottom-left-radius:4px}' +
      '.hmcc-meta{font-size:10px;color:#9aa091;margin:2px 4px 0}' +
      '.hmcc-row.me .hmcc-meta{text-align:right}' +
      '.hmcc-name{font-size:11px;font-weight:700;color:#5a7040;margin:0 4px 2px}' +
      '.hmcc-bar{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #e2e7d8}' +
      '.hmcc-in{flex:1;resize:none;border:1px solid #d7ddcf;border-radius:18px;padding:9px 14px;font-size:14px;font-family:inherit;line-height:1.5;max-height:110px;background:#f7f9f3;box-sizing:border-box}' +
      '.hmcc-in:focus{outline:none;border-color:#9AB57A;background:#fff}' +
      '.hmcc-send{flex-shrink:0;width:40px;height:40px;border-radius:50%;border:none;background:#2C3626;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
      '.hmcc-send[disabled]{opacity:.45;cursor:default}';
    var el = document.createElement('style');
    el.id = 'hmcc-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── overlay shell ──────────────────────────────────────────────────────────
  function _ensureRoot() {
    if (_root) return _root;
    _injectStyles();
    _root = document.createElement('div');
    _root.className = 'hmcc-ov';
    _root.setAttribute('role', 'dialog');
    _root.setAttribute('aria-modal', 'true');
    _root.setAttribute('aria-label', 'お問い合わせチャット');
    _root.innerHTML =
      '<div class="hmcc-panel">' +
        '<div class="hmcc-head">' +
          '<div style="flex:1">' +
            '<h3>お問い合わせ<span class="hmcc-sub" id="hmccSub">Hello Moving カスタマーサポート</span></h3>' +
          '</div>' +
          '<button class="hmcc-x" type="button" aria-label="閉じる">×</button>' +
        '</div>' +
        '<div class="hmcc-body" id="hmccBody"></div>' +
      '</div>';
    document.body.appendChild(_root);
    _root.addEventListener('click', function (e) {
      if (e.target === _root) close();
      if (e.target.closest && e.target.closest('.hmcc-x')) close();
    });
    return _root;
  }
  function _body() { return document.getElementById('hmccBody'); }
  function _setSub(txt) { var s = document.getElementById('hmccSub'); if (s) s.textContent = txt; }

  // ── screen: choose new / resume ─────────────────────────────────────────────
  function _screenChoice() {
    _stopPoll();
    _setSub('Hello Moving カスタマーサポート');
    var saved = _loadSession();
    var resumeSaved = saved
      ? '<button class="hmcc-btn" data-act="continue">前回のお問い合わせを続ける' +
        '<small>お問い合わせ番号 ' + _esc(saved.code) + '</small></button>'
      : '';
    _body().innerHTML =
      '<div class="hmcc-choice">' +
        '<p class="lead">ご質問・ご相談をチャットでお受けします。担当者が順次ご返信いたします。</p>' +
        resumeSaved +
        '<button class="hmcc-btn primary" data-act="new">新しくお問い合わせ</button>' +
        '<button class="hmcc-btn" data-act="resume">お問い合わせを再開' +
          '<small>お問い合わせ番号とメールアドレスで再開できます</small></button>' +
      '</div>';
    _body().onclick = function (e) {
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'new') _screenNew();
      else if (act === 'resume') _screenResume();
      else if (act === 'continue') _openChat(saved, null);
    };
  }

  // ── screen: new inquiry ─────────────────────────────────────────────────────
  function _screenNew() {
    _setSub('新しくお問い合わせ');
    var opts = CATEGORIES.map(function (c) { return '<option value="' + _esc(c) + '">' + _esc(c) + '</option>'; }).join('');
    _body().innerHTML =
      '<div class="hmcc-field"><label>お問い合わせ種別</label><select id="hmccCat">' + opts + '</select></div>' +
      '<div class="hmcc-field"><label>お名前 <em>*</em></label><input id="hmccName" type="text" autocomplete="name" placeholder="山田 太郎"></div>' +
      '<div class="hmcc-field"><label>メールアドレス <em>*</em></label><input id="hmccEmail" type="email" autocomplete="email" placeholder="you@example.com"></div>' +
      '<div class="hmcc-field"><label>メッセージ <em>*</em></label><textarea id="hmccMsg" placeholder="ご相談内容をご記入ください。"></textarea></div>' +
      '<button class="hmcc-btn primary" id="hmccSubmit" type="button">送信して番号を発行</button>' +
      '<p class="hmcc-status info" id="hmccStat">送信後、お問い合わせ番号が発行されます。</p>' +
      '<button class="hmcc-link" data-back="1" type="button">← 戻る</button>';
    _body().onclick = function (e) { if (e.target.closest && e.target.closest('[data-back]')) _screenChoice(); };
    document.getElementById('hmccSubmit').addEventListener('click', _submitNew);
  }

  function _stat(msg, kind) {
    var el = document.getElementById('hmccStat');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'hmcc-status ' + (kind || 'info');
  }

  async function _submitNew() {
    var cat   = (document.getElementById('hmccCat') || {}).value || '';
    var name  = (document.getElementById('hmccName').value || '').trim();
    var email = (document.getElementById('hmccEmail').value || '').trim();
    var msg   = (document.getElementById('hmccMsg').value || '').trim();
    if (!name)                 { _stat('お名前をご入力ください。', 'err'); return; }
    if (!EMAIL_RE.test(email)) { _stat('正しいメールアドレスをご入力ください。', 'err'); return; }
    if (!msg)                  { _stat('メッセージをご入力ください。', 'err'); return; }
    if (!_base())              { _stat('送信先が設定されていません。お急ぎの場合はLINEよりご連絡ください。', 'err'); return; }

    var btn = document.getElementById('hmccSubmit');
    btn.disabled = true; _stat('送信しています…', 'info');
    var out = await _post('start', { name: name, email: email, category: cat, message: msg });
    btn.disabled = false;
    if (out && out.ok && out.data && out.data.public_contact_id) {
      var sess = { code: out.data.public_contact_id, email: email, name: name };
      _saveSession(sess);
      _screenIssued(sess);
    } else {
      var em = out && out.error && (out.error.message || out.error);
      _stat('送信できませんでした：' + (em || '不明なエラー') + '　お急ぎの場合はLINEよりご連絡ください。', 'err');
    }
  }

  // ── screen: Contact ID issued ───────────────────────────────────────────────
  function _screenIssued(sess) {
    _setSub('お問い合わせ番号が発行されました');
    _body().innerHTML =
      '<div class="hmcc-idcard">' +
        '<p class="lbl">お問い合わせ番号</p>' +
        '<p class="code" id="hmccCode">' + _esc(sess.code) + '</p>' +
        '<button class="copy" id="hmccCopy" type="button">番号をコピー</button>' +
      '</div>' +
      '<div class="hmcc-note">この番号とメールアドレス（' + _esc(sess.email) + '）で、いつでもお問い合わせを再開できます。<br>番号は大切に保管してください。</div>' +
      '<button class="hmcc-btn primary" id="hmccGoChat" type="button">チャットを開く</button>';
    document.getElementById('hmccCopy').addEventListener('click', function () {
      var t = sess.code;
      var done = function () { this.textContent = 'コピーしました ✓'; }.bind(this);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, done);
      else done();
    });
    document.getElementById('hmccGoChat').addEventListener('click', function () { _openChat(sess, null); });
  }

  // ── screen: resume ──────────────────────────────────────────────────────────
  function _screenResume() {
    _setSub('お問い合わせを再開');
    var saved = _loadSession();
    _body().innerHTML =
      '<div class="hmcc-field"><label>お問い合わせ番号 <em>*</em></label><input id="hmccRid" type="text" autocomplete="off" placeholder="HM7K4P2" value="' + _esc(saved ? saved.code : '') + '" style="text-transform:uppercase;letter-spacing:2px;font-weight:700"></div>' +
      '<div class="hmcc-field"><label>メールアドレス <em>*</em></label><input id="hmccRem" type="email" autocomplete="email" placeholder="you@example.com" value="' + _esc(saved ? saved.email : '') + '"></div>' +
      '<button class="hmcc-btn primary" id="hmccResume" type="button">お問い合わせを再開</button>' +
      '<p class="hmcc-status info" id="hmccStat">番号とメールアドレスの両方が必要です。</p>' +
      '<button class="hmcc-link" data-back="1" type="button">← 戻る</button>';
    _body().onclick = function (e) { if (e.target.closest && e.target.closest('[data-back]')) _screenChoice(); };
    document.getElementById('hmccResume').addEventListener('click', _submitResume);
  }

  async function _submitResume() {
    var code  = (document.getElementById('hmccRid').value || '').trim().toUpperCase();
    var email = (document.getElementById('hmccRem').value || '').trim();
    if (!code)                 { _stat('お問い合わせ番号をご入力ください。', 'err'); return; }
    if (!EMAIL_RE.test(email)) { _stat('正しいメールアドレスをご入力ください。', 'err'); return; }
    var btn = document.getElementById('hmccResume');
    btn.disabled = true; _stat('確認しています…', 'info');
    var out = await _post('resume', { contact_id: code, email: email });
    btn.disabled = false;
    if (out && out.ok && out.data) {
      var sess = { code: out.data.public_contact_id, email: email, name: out.data.name || '' };
      _saveSession(sess);
      _openChat(sess, out.data);
    } else {
      // Deliberately generic — never reveal whether the number exists.
      _stat('番号またはメールアドレスが一致しませんでした。ご確認のうえ再度お試しください。', 'err');
    }
  }

  // ── screen: chat ────────────────────────────────────────────────────────────
  function _openChat(sess, seed) {
    _sess = sess;
    _lastSig = '';
    _setSub('お問い合わせ番号 ' + sess.code);
    _body().innerHTML =
      '<div class="hmcc-stream" id="hmccStream" aria-live="polite"><div class="hmcc-empty">読み込み中…</div></div>';
    // The input bar lives OUTSIDE the scrollable body, pinned to the panel bottom.
    var panel = _root.querySelector('.hmcc-panel');
    var old = panel.querySelector('.hmcc-bar');
    if (old) old.remove();
    var bar = document.createElement('div');
    bar.className = 'hmcc-bar';
    bar.innerHTML =
      '<textarea class="hmcc-in" id="hmccInput" rows="1" placeholder="メッセージを入力…" maxlength="4000"></textarea>' +
      '<button class="hmcc-send" id="hmccSendBtn" type="button" aria-label="送信">➤</button>';
    panel.appendChild(bar);

    var input = document.getElementById('hmccInput');
    input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 110) + 'px'; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendText(); } });
    document.getElementById('hmccSendBtn').addEventListener('click', _sendText);

    if (seed && seed.messages) _renderStream(seed.messages);
    _poll().then(_scheduleNext);
  }

  function _dayLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso.indexOf('T') > 0 ? iso : iso.replace(' ', 'T'));
    if (isNaN(d)) return '';
    var dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + dow + '）';
  }

  function _renderStream(messages) {
    var stream = document.getElementById('hmccStream');
    if (!stream) return;
    var sig = messages.map(function (m) { return m.id; }).join('|');
    if (sig === _lastSig) return;
    var nearBottom = (stream.scrollHeight - stream.scrollTop - stream.clientHeight) < 90;
    _lastSig = sig;
    if (!messages.length) {
      stream.innerHTML = '<div class="hmcc-empty">まだメッセージはありません。<br>ご質問・ご要望をお気軽にどうぞ。</div>';
      return;
    }
    var html = '', lastDay = '';
    messages.forEach(function (m) {
      var day = _dayLabel(m.created_at);
      if (day && day !== lastDay) { html += '<div class="hmcc-day">' + _esc(day) + '</div>'; lastDay = day; }
      var me = m.sender_type === 'customer';
      var name = me ? '' : '<div class="hmcc-name">' + _esc(m.sender_name || 'Hello Moving') + '</div>';
      html += '<div class="hmcc-row ' + (me ? 'me' : 'them') + '">' +
                '<div>' + name +
                  '<div class="hmcc-b">' + _esc(m.text) + '</div>' +
                  '<div class="hmcc-meta">' + _fmtTime(m.created_at) + '</div>' +
                '</div></div>';
    });
    stream.innerHTML = html;
    if (nearBottom) stream.scrollTop = stream.scrollHeight;
  }

  async function _poll() {
    if (!_sess || !_root || !_root.classList.contains('open')) return;
    try {
      var out = await _post('list', { contact_id: _sess.code, email: _sess.email });
      if (out && out.ok && out.data) _renderStream(out.data.messages || []);
    } catch (e) { /* transient — next tick retries */ }
  }
  function _scheduleNext() {
    if (!_sess || !_root || !_root.classList.contains('open')) return;
    _timer = setTimeout(function () { _poll().then(_scheduleNext); }, POLL_MS);
  }
  function _stopPoll() { if (_timer) { clearTimeout(_timer); _timer = null; } }

  async function _sendText() {
    if (_sending || !_sess) return;
    var input = document.getElementById('hmccInput');
    var text = (input.value || '').trim();
    if (!text) return;
    _sending = true;
    var btn = document.getElementById('hmccSendBtn');
    if (btn) btn.disabled = true;
    try {
      var out = await _post('send', { contact_id: _sess.code, email: _sess.email, message: text });
      if (out && out.ok) {
        input.value = ''; input.style.height = 'auto';
        _lastSig = '';
        await _poll();
      }
    } catch (e) { /* keep the text so the user can retry */ }
    finally { _sending = false; if (btn) btn.disabled = false; }
  }

  // ── open / close ────────────────────────────────────────────────────────────
  function open(mode) {
    _ensureRoot();
    _root.classList.add('open');
    document.documentElement.style.overflow = 'hidden';
    if (mode === 'new') _screenNew();
    else if (mode === 'resume') _screenResume();
    else _screenChoice();
  }
  function close() {
    _stopPoll();
    if (_root) _root.classList.remove('open');
    document.documentElement.style.overflow = '';
  }

  // Public API — the index.html launcher calls these.
  window.openContactChat = open;
  window.closeContactChat = close;
})();
