'use strict';

/* ════════════════════════════════════════════════════════
   QUOTE FOLLOW-UP ACTION — Phase 24C
   Sends a follow-up email to customers whose quote has not
   been converted to a booking 3 days after submission.
   Replaces the placeholder send_quote_followup action.

   "Not converted" is implicit: converted quotes are removed
   from Adapter.getQuotes(), so any remaining quote is pending.

   Sends to CUSTOMER (to_email = quote.email).

   Sends via the send-email.php gateway (booking@hello-moving.com — quote is
   part of the booking funnel), log_comm:true. EmailJS has been fully removed.

   Storage:
     hm_quote_followups_sent  { version, sent:{}, log:[] }
     hm_qf_settings           { version, companyPhone, companyEmail }

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
    return { version: 1, companyPhone: '', companyEmail: '' };
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

  /* ── Message + gateway send (booking@) ── */

  async function _gwSend(account, to, subject, message, refId) {
    var base = (window.API_BASE || '').replace(/\/$/, '');
    if (!base) return { ok: false, detail: 'API_BASE未設定' };
    try {
      var res = await fetch(base + '/send-email.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' },
        body: JSON.stringify({ from_account: account, to: to, subject: subject, message: message, booking_id: refId || '', log_comm: true }),
      });
      var r = await res.json().catch(function () { return { ok: false, error: 'HTTP ' + res.status }; });
      return { ok: !!r.ok, detail: r.ok ? (r.messageId || 'sent') : ((r.error && (r.error.message || r.error)) || ('HTTP ' + res.status)) };
    } catch (err) {
      return { ok: false, detail: (err && err.message) || 'ネットワークエラー' };
    }
  }

  function _buildMessage(qt, cfg) {
    var quoteDate = (typeof fmtD === 'function' && qt.createdAt)
      ? fmtD(qt.createdAt.slice(0, 10))
      : (qt.createdAt || '').slice(0, 10);
    var moveDate = qt.moveDate
      ? ((typeof fmtD === 'function') ? fmtD(qt.moveDate) : qt.moveDate)
      : '未定';
    return [
      (qt.name || 'お客様') + '様',
      '',
      '先日は Hello Moving に引越しのお見積もりをご依頼いただき、誠にありがとうございます。',
      'その後のご検討状況はいかがでしょうか。ご不明な点やご予算のご相談など、お気軽にこのメールへご返信ください。',
      '',
      '── お見積もり内容 ──',
      '見積もり番号: ' + (qt.id || '—'),
      'サービス　　: ' + (qt.service || '—'),
      '引越し希望日: ' + moveDate,
      '引越し元　　: ' + (qt.fromAddr || '未定'),
      '引越し先　　: ' + (qt.toAddr || '未定'),
      '受付日　　　: ' + quoteDate,
      '',
      'お電話でのご相談: ' + (cfg.companyPhone || '090-2489-3402'),
      '',
      'Hello Moving',
    ].join('\n');
  }

  async function _sendEmail(qt) {
    // Master email switch (preserves the prior emailCfg.enabled gate).
    if (window.Adapter && Adapter.getEmailSettings && !Adapter.getEmailSettings().enabled) {
      return { ok: false, detail: 'メール通知が無効です（メール通知設定で有効化してください）' };
    }
    if (!qt.email) return { ok: false, detail: 'お客様メールアドレスなし' };
    var subject = '[Hello Moving] お見積もりのご検討状況について（' + (qt.id || '') + '）';
    return _gwSend('booking', qt.email, subject, _buildMessage(qt, getSettings()), qt.id || '');
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
            '自動化ルール「見積もりフォローアップ」が実行されると、見積もり受付から3日後に予約未確定のお客様へ、送信ゲートウェイ経由（booking@hello-moving.com）でフォローアップメールを送信します。' +
          '</p>' +
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
