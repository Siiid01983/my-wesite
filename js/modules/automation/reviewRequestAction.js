'use strict';

/* ════════════════════════════════════════════════════════
   REVIEW REQUEST ACTION — Phase 24A
   Sends a review request email to customers 7 days after
   their booking completes. Replaces the placeholder action
   registered in automationActions.js with a real EmailJS call.

   Reuses EmailJS credentials from Adapter.getEmailSettings()
   (serviceId, publicKey) but a separate templateId configured
   here — keeping the review request template independent from
   admin notifications and follow-up templates.

   Sends to CUSTOMER (to_email = booking.email).

   Storage:
     hm_review_requests_sent  { version, sent:{}, log:[] }
     hm_rr_settings           { version, templateId }

   Audit action code: review_request_sent
   ════════════════════════════════════════════════════════ */

window.ReviewRequestAction = (function () {

  var SENT_KEY     = 'hm_review_requests_sent';
  var SETTINGS_KEY = 'hm_rr_settings';

  /* ── Settings ── */

  function getSettings() {
    try {
      var d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (d && d.version === 1) return d;
    } catch (_) {}
    return { version: 1, templateId: '' };
  }

  function saveSettings(cfg) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign({ version: 1 }, cfg))); } catch (_) {}
  }

  /* ── Sent tracking ── */

  function _loadSent() {
    try {
      var d = JSON.parse(localStorage.getItem(SENT_KEY) || 'null');
      if (d && d.version === 1) return d;
    } catch (_) {}
    return { version: 1, sent: {}, log: [] };
  }

  function _persistSent(d) {
    try { localStorage.setItem(SENT_KEY, JSON.stringify(d)); } catch (_) {}
  }

  function isSent(bookingId) { return !!(_loadSent().sent[bookingId]); }

  function markSent(bookingId, meta) {
    var d   = _loadSent();
    var rec = Object.assign({ sentAt: new Date().toISOString() }, meta);
    d.sent[bookingId] = rec;
    if (!d.log) d.log = [];
    d.log.unshift(Object.assign({ bookingId: bookingId }, rec));
    if (d.log.length > 100) d.log.splice(100);
    _persistSent(d);
  }

  function getLog()  { return (_loadSent().log  || []); }
  function getSent() { return (_loadSent().sent || {}); }

  function _clearLog() {
    var d = _loadSent();
    d.log = [];
    _persistSent(d);
  }

  /* ── EmailJS send ── */

  async function _sendEmail(bk) {
    var emailCfg = window.Adapter ? Adapter.getEmailSettings() : {};
    if (!emailCfg.enabled || !emailCfg.serviceId || !emailCfg.publicKey) {
      return { ok: false, detail: 'EmailJS未設定（メール通知設定を確認してください）' };
    }
    var cfg = getSettings();
    if (!cfg.templateId) {
      return { ok: false, detail: 'レビュー依頼テンプレートIDが未設定' };
    }
    var email = bk.email || '';
    if (!email) {
      return { ok: false, detail: 'お客様メールアドレスなし' };
    }

    var moveDate = (typeof fmtD === 'function')
      ? fmtD(bk.date || bk.move_date || '')
      : (bk.date || bk.move_date || '');

    try {
      var res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id:  emailCfg.serviceId,
          template_id: cfg.templateId,
          user_id:     emailCfg.publicKey,
          template_params: {
            to_email:      email,
            customer_name: bk.name || bk.customer_name || '',
            reference_id:  bk.id   || bk.reference_id  || '',
            move_date:     moveDate,
            company_name:  'Hello Moving',
          },
        }),
      });
      return { ok: res.status === 200, detail: 'HTTP ' + res.status };
    } catch (err) {
      return { ok: false, detail: (err && err.message) || 'ネットワークエラー' };
    }
  }

  /* ── Automation action (overrides the placeholder registered in automationActions.js) ── */

  async function _action(ctx) {
    var bk = ctx.booking;
    if (!bk) throw new Error('予約データがありません');
    var bookingId = bk.id || bk.reference_id || '';
    if (isSent(bookingId)) {
      return 'スキップ（送信済み）: ' + (bk.name || bk.customer_name || bookingId);
    }
    var result = await _sendEmail(bk);
    if (result.ok) {
      markSent(bookingId, {
        email: bk.email,
        name:  bk.name || bk.customer_name || '',
        refId: bookingId
      });
      if (window.AuditLog) {
        AuditLog.record('other', 'automation', 'review_request_sent',
          'レビュー依頼メール送信: ' + (bk.name || bookingId) + ' <' + bk.email + '>');
      }
      if (window.AutomationAudit) {
        AutomationAudit.log(
          (ctx._key || bookingId), 'レビュー依頼', 'send_review_request',
          'success', (bk.name || bookingId) + ': ' + result.detail
        );
      }
    } else {
      throw new Error(result.detail);
    }
    return (bk.name || bookingId) + ': ' + result.detail;
  }

  /* ── Manual run (bypasses engine deduplication — sends to all eligible bookings) ── */

  async function runNow() {
    var btn = document.getElementById('rrRunNowBtn');
    if (btn) { btn.disabled = true; btn.textContent = '確認中…'; }
    try {
      var bookings = window.Adapter ? Adapter.getBookings() : [];
      var today    = new Date(); today.setHours(0, 0, 0, 0);
      var count    = 0;

      for (var i = 0; i < bookings.length; i++) {
        var bk = bookings[i];
        if (bk.status !== '完了') continue;
        var dateStr = bk.date || bk.move_date || '';
        if (!dateStr || !bk.email) continue;
        var moveDate = new Date(dateStr + 'T00:00:00');
        var trigger  = new Date(moveDate); trigger.setDate(trigger.getDate() + 7);
        if (trigger > today) continue;
        var bookingId = bk.id || bk.reference_id || '';
        if (isSent(bookingId)) continue;

        var result = await _sendEmail(bk);
        if (result.ok) {
          markSent(bookingId, { email: bk.email, name: bk.name || '' });
          if (window.AuditLog) {
            AuditLog.record('other', 'automation', 'review_request_sent',
              'レビュー依頼: ' + (bk.name || bookingId));
          }
          count++;
        }
      }
      toast(count > 0 ? 'レビュー依頼メールを ' + count + '件 送信しました' : '送信対象なし（未送信・7日経過済みの完了予約なし）');
      renderPanel();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '今すぐ確認 &amp; 送信'; }
    }
  }

  /* ── Settings panel ── */

  var TEMPLATE_VARS = [
    ['to_email',      '顧客メールアドレス'],
    ['customer_name', '顧客名'],
    ['reference_id',  '予約番号'],
    ['move_date',     '引越し日（日本語形式）'],
    ['company_name',  '会社名（Hello Moving）'],
  ];

  function renderPanel() {
    var el = document.getElementById('rrContent');
    if (!el) return;

    var cfg       = getSettings();
    var sentCount = Object.keys(getSent()).length;
    var log       = getLog().slice(0, 10);

    var logRows = log.length
      ? log.map(function (e) {
          var d  = new Date(e.sentAt);
          var ts = d.getFullYear() + '/' + _p2(d.getMonth() + 1) + '/' + _p2(d.getDate());
          return '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2)">' +
            '<span style="flex-shrink:0;display:inline-flex;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(16,185,129,.1);color:#059669;border:1px solid rgba(16,185,129,.2)">✓ 送信済み</span>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:12px;color:var(--ink)">' + esc(e.name || e.bookingId || '') + '</div>' +
              '<div style="font-size:11px;color:var(--gray-2);margin-top:2px">' + esc(e.email || '') + ' · ' + ts + '</div>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div style="color:var(--gray-2);font-size:12px;padding:8px 0">まだ送信履歴がありません</div>';

    el.innerHTML =
      '<div class="panel" style="margin-top:16px">' +
        '<div class="panel-head">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" style="color:var(--blue);flex-shrink:0"><path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>' +
            '<span class="panel-title">レビュー依頼メール（自動）</span>' +
            (sentCount ? '<span style="font-size:11px;padding:2px 8px;border-radius:12px;background:rgba(16,185,129,.1);color:#059669;font-weight:600">' + sentCount + '件 送信済み</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="panel-body">' +
          '<p style="font-size:12px;color:var(--gray-1);margin-bottom:14px;line-height:1.6">' +
            '自動化ルール「レビュー依頼」が実行されると、引越し完了7日後に顧客へレビュー依頼メールを送信します。<br>' +
            'メール通知設定のEmailJS認証情報（Service ID・Public Key）を共用します。テンプレートIDのみ別途設定します。' +
          '</p>' +
          '<div class="m-field">' +
            '<label class="m-label">レビュー依頼 Template ID</label>' +
            '<input class="input" id="rrTemplateId" type="text" value="' + esc(cfg.templateId) + '" ' +
              'placeholder="template_xxxxxxx" style="font-family:monospace;font-size:12px;max-width:300px" />' +
            '<div style="font-size:11px;color:var(--gray-2);margin-top:4px">' +
              'EmailJSで作成した顧客向けレビュー依頼テンプレートのID（管理者通知テンプレートとは別のもの）' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
            '<button class="btn btn-primary btn-sm" onclick="ReviewRequestAction.savePanel()">保存</button>' +
            '<button class="btn btn-ghost btn-sm" id="rrRunNowBtn" onclick="ReviewRequestAction.runNow()">今すぐ確認 &amp; 送信</button>' +
          '</div>' +

          '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">' +
            '<div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">テンプレート変数</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px">' +
              TEMPLATE_VARS.map(function (pair) {
                return '<div style="background:var(--bg-soft-2);border:1px solid var(--line);border-radius:6px;padding:7px 10px">' +
                  '<code style="font-size:11px;color:var(--blue)">{{' + pair[0] + '}}</code>' +
                  '<div style="font-size:11px;color:var(--gray-2);margin-top:2px">' + esc(pair[1]) + '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
              '<div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em">送信ログ</div>' +
              '<button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="ReviewRequestAction.clearLog()">クリア</button>' +
            '</div>' +
            logRows +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function savePanel() {
    var inp = document.getElementById('rrTemplateId');
    saveSettings({ templateId: inp ? inp.value.trim() : '' });
    toast('レビュー依頼設定を保存しました');
  }

  function clearLog() {
    _clearLog();
    renderPanel();
  }

  function _p2(n) { return String(n).padStart(2, '0'); }

  /* ── Register real action (replaces toast placeholder from automationActions.js) ── */
  if (window.AutomationActions) {
    AutomationActions.register('send_review_request', _action);
  }

  /* ── Wrap renderEmail to inject the settings panel ── */
  if (typeof window.renderEmail === 'function') {
    var _origRenderEmail = window.renderEmail;
    window.renderEmail = function () {
      _origRenderEmail();
      renderPanel();
    };
  }

  return {
    isSent:       isSent,
    markSent:     markSent,
    getLog:       getLog,
    getSent:      getSent,
    clearLog:     clearLog,
    getSettings:  getSettings,
    saveSettings: saveSettings,
    renderPanel:  renderPanel,
    savePanel:    savePanel,
    runNow:       runNow,
  };

})();
