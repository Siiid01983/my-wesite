'use strict';

/* ════════════════════════════════════════════════════════
   QUOTE FOLLOW-UP ACTION — Phase 24C
   Sends a follow-up email to customers whose quote has not
   been converted to a booking 3 days after submission.
   Replaces the placeholder send_quote_followup action.

   "Not converted" is implicit: converted quotes are removed
   from Adapter.getQuotes(), so any remaining quote is pending.

   Sends to CUSTOMER (to_email = quote.email).

   Storage:
     hm_quote_followups_sent  { version, sent:{}, log:[] }
     hm_qf_settings           { version, templateId, companyPhone, companyEmail }

   Audit action code: quote_followup_sent
   ════════════════════════════════════════════════════════ */

window.QuoteFollowUpAction = (function () {

  var SENT_KEY     = 'hm_quote_followups_sent';
  var SETTINGS_KEY = 'hm_qf_settings';

  /* ── Settings ── */

  function getSettings() {
    try {
      var d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (d && d.version === 1) return d;
    } catch (_) {}
    return { version: 1, templateId: '', companyPhone: '', companyEmail: 'hellomoving1@gmail.com' };
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

  function isSent(quoteId) { return !!(_loadSent().sent[quoteId]); }

  function markSent(quoteId, meta) {
    var d   = _loadSent();
    d.sent[quoteId] = Object.assign({ sentAt: new Date().toISOString() }, meta);
    if (!d.log) d.log = [];
    d.log.unshift(Object.assign({ quoteId: quoteId }, d.sent[quoteId]));
    if (d.log.length > 100) d.log.splice(100);
    _persistSent(d);
  }

  function getLog()  { return (_loadSent().log  || []); }
  function getSent() { return (_loadSent().sent || {}); }
  function _clearLog() { var d = _loadSent(); d.log = []; _persistSent(d); }

  /* ── EmailJS send ── */

  function _buildParams(qt, cfg) {
    var quoteDate = (typeof fmtD === 'function' && qt.createdAt)
      ? fmtD(qt.createdAt.slice(0, 10))
      : (qt.createdAt || '').slice(0, 10);
    var moveDate = qt.moveDate
      ? ((typeof fmtD === 'function') ? fmtD(qt.moveDate) : qt.moveDate)
      : '未定';

    return {
      to_email:      qt.email,
      customer_name: qt.name     || '',
      reference_id:  qt.id       || '',
      quote_date:    quoteDate,
      service_type:  qt.service  || '',
      move_date:     moveDate,
      from_address:  qt.fromAddr || '未定',
      to_address:    qt.toAddr   || '未定',
      company_name:  'Hello Moving',
      company_phone: cfg.companyPhone || '',
      company_email: cfg.companyEmail || '',
    };
  }

  async function _sendEmail(qt) {
    var emailCfg = window.Adapter ? Adapter.getEmailSettings() : {};
    if (!emailCfg.enabled || !emailCfg.serviceId || !emailCfg.publicKey) {
      return { ok: false, detail: 'EmailJS未設定（メール通知設定を確認してください）' };
    }
    var cfg = getSettings();
    if (!cfg.templateId) return { ok: false, detail: '見積もりフォローアップテンプレートIDが未設定' };
    if (!qt.email)       return { ok: false, detail: 'お客様メールアドレスなし' };

    try {
      var res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id:      emailCfg.serviceId,
          template_id:     cfg.templateId,
          user_id:         emailCfg.publicKey,
          template_params: _buildParams(qt, cfg),
        }),
      });
      return { ok: res.status === 200, detail: 'HTTP ' + res.status };
    } catch (err) {
      return { ok: false, detail: (err && err.message) || 'ネットワークエラー' };
    }
  }

  /* ── Automation action ── */

  async function _action(ctx) {
    var qt = ctx.quote;
    if (!qt) throw new Error('見積もりデータがありません');
    var quoteId = qt.id || '';
    if (isSent(quoteId)) return 'スキップ（送信済み）: ' + (qt.name || quoteId);
    var result = await _sendEmail(qt);
    if (result.ok) {
      markSent(quoteId, { email: qt.email, name: qt.name || '', service: qt.service || '' });
      if (window.AuditLog) {
        AuditLog.record('other', 'automation', 'quote_followup_sent',
          '見積もりフォローアップ送信: ' + (qt.name || quoteId) + ' <' + qt.email + '>');
      }
    } else {
      throw new Error(result.detail);
    }
    return (qt.name || quoteId) + ': ' + result.detail;
  }

  /* ── Manual run ── */

  async function runNow() {
    var btn = document.getElementById('qfRunNowBtn');
    if (btn) { btn.disabled = true; btn.textContent = '確認中…'; }
    try {
      var quotes  = window.Adapter && Adapter.getQuotes ? (Adapter.getQuotes() || []) : [];
      var today   = new Date(); today.setHours(0, 0, 0, 0);
      var count   = 0;
      for (var i = 0; i < quotes.length; i++) {
        var qt = quotes[i];
        if (!qt.email || !qt.createdAt) continue;
        var created = new Date(qt.createdAt); created.setHours(0, 0, 0, 0);
        var days    = Math.round((today - created) / 86400000);
        if (days < 3) continue;
        if (isSent(qt.id || '')) continue;
        var result  = await _sendEmail(qt);
        if (result.ok) {
          markSent(qt.id || '', { email: qt.email, name: qt.name || '' });
          if (window.AuditLog) {
            AuditLog.record('other', 'automation', 'quote_followup_sent',
              '見積もりフォローアップ: ' + (qt.name || qt.id));
          }
          count++;
        }
      }
      toast(count > 0 ? '見積もりフォローアップを ' + count + '件 送信しました' : '送信対象なし（3日以上経過・未送信の見積もりなし）');
      renderPanel();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '今すぐ確認 &amp; 送信'; }
    }
  }

  /* ── Settings panel ── */

  var TEMPLATE_VARS = [
    ['to_email',      '顧客メールアドレス'],
    ['customer_name', '顧客名'],
    ['reference_id',  '見積もり番号'],
    ['quote_date',    '見積もり受付日'],
    ['service_type',  'サービス種別'],
    ['move_date',     '希望引越し日'],
    ['from_address',  '引越し元住所'],
    ['to_address',    '引越し先住所'],
    ['company_name',  '会社名（Hello Moving）'],
    ['company_phone', '会社電話番号'],
    ['company_email', '会社メールアドレス'],
  ];

  function renderPanel() {
    var el = document.getElementById('qfContent');
    if (!el) return;

    var cfg       = getSettings();
    var sentCount = Object.keys(getSent()).length;
    var log       = getLog().slice(0, 10);

    var logRows = log.length
      ? log.map(function (e) {
          var d  = new Date(e.sentAt);
          var ts = d.getFullYear() + '/' + _p2(d.getMonth() + 1) + '/' + _p2(d.getDate());
          return '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2)">' +
            '<span style="flex-shrink:0;display:inline-flex;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(245,158,11,.1);color:#b45309;border:1px solid rgba(245,158,11,.2)">✓ 送信済み</span>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:12px;color:var(--ink)">' + esc(e.name || e.quoteId || '') + '</div>' +
              '<div style="font-size:11px;color:var(--gray-2);margin-top:2px">' + esc(e.email || '') + ' · ' + ts + '</div>' +
            '</div></div>';
        }).join('')
      : '<div style="color:var(--gray-2);font-size:12px;padding:8px 0">まだ送信履歴がありません</div>';

    el.innerHTML =
      '<div class="panel" style="margin-top:16px">' +
        '<div class="panel-head">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" style="color:var(--yellow);flex-shrink:0"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>' +
            '<span class="panel-title">見積もりフォローアップメール（自動）</span>' +
            (sentCount ? '<span style="font-size:11px;padding:2px 8px;border-radius:12px;background:rgba(245,158,11,.1);color:#b45309;font-weight:600">' + sentCount + '件 送信済み</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="panel-body">' +
          '<p style="font-size:12px;color:var(--gray-1);margin-bottom:14px;line-height:1.6">' +
            '自動化ルール「見積もりフォローアップ」が実行されると、見積もり受付から3日後に予約未確定のお客様へフォローアップメールを送信します。' +
          '</p>' +
          '<div class="m-field">' +
            '<label class="m-label">フォローアップ Template ID</label>' +
            '<input class="input" id="qfTemplateId" type="text" value="' + esc(cfg.templateId) + '" ' +
              'placeholder="template_xxxxxxx" style="font-family:monospace;font-size:12px;max-width:300px" />' +
          '</div>' +
          '<div class="m-row">' +
            '<div class="m-field">' +
              '<label class="m-label">会社電話番号</label>' +
              '<input class="input" id="qfCompanyPhone" type="text" value="' + esc(cfg.companyPhone) + '" placeholder="0120-000-000" />' +
            '</div>' +
            '<div class="m-field">' +
              '<label class="m-label">会社メールアドレス</label>' +
              '<input class="input" id="qfCompanyEmail" type="email" value="' + esc(cfg.companyEmail) + '" placeholder="hellomoving1@gmail.com" />' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
            '<button class="btn btn-primary btn-sm" onclick="QuoteFollowUpAction.savePanel()">保存</button>' +
            '<button class="btn btn-ghost btn-sm" id="qfRunNowBtn" onclick="QuoteFollowUpAction.runNow()">今すぐ確認 &amp; 送信</button>' +
          '</div>' +
          '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">' +
            '<div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">テンプレート変数</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px">' +
              TEMPLATE_VARS.map(function (pair) {
                return '<div style="background:var(--bg-soft-2);border:1px solid var(--line);border-radius:6px;padding:7px 10px">' +
                  '<code style="font-size:11px;color:var(--blue)">{{' + pair[0] + '}}</code>' +
                  '<div style="font-size:11px;color:var(--gray-2);margin-top:2px">' + esc(pair[1]) + '</div></div>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
              '<div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em">送信ログ</div>' +
              '<button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="QuoteFollowUpAction.clearLog()">クリア</button>' +
            '</div>' + logRows +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function savePanel() {
    saveSettings({
      templateId:   (document.getElementById('qfTemplateId')    || {}).value || '',
      companyPhone: (document.getElementById('qfCompanyPhone')  || {}).value || '',
      companyEmail: (document.getElementById('qfCompanyEmail')  || {}).value || '',
    });
    toast('見積もりフォローアップ設定を保存しました');
  }

  function clearLog() { _clearLog(); renderPanel(); }
  function _p2(n) { return String(n).padStart(2, '0'); }

  /* ── Register ── */
  if (window.AutomationActions) AutomationActions.register('send_quote_followup', _action);

  /* renderPanel() is called explicitly by renderAutomation() after it injects #qfContent */

  return { isSent, markSent, getLog, getSent, clearLog, getSettings, saveSettings, renderPanel, savePanel, runNow };

})();
