'use strict';

/* ════════════════════════════════════════════════════════
   BOOKING REMINDER ACTION — Phase 24B
   Sends a pre-move reminder email to customers 1 day before
   their move date. Replaces the placeholder send_move_reminder
   action registered in automationActions.js.

   Sends to CUSTOMER (to_email = booking.email).
   Includes move details + company contact info for moving day.

   Storage:
     hm_booking_reminders_sent  { version, sent:{}, log:[] }
     hm_br_settings             { version, templateId, companyPhone, companyEmail }

   Audit action code: booking_reminder_sent
   ════════════════════════════════════════════════════════ */

window.BookingReminderAction = (function () {

  var SENT_KEY     = 'hm_booking_reminders_sent';
  var SETTINGS_KEY = 'hm_br_settings';

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
    var d = _loadSent(); d.log = []; _persistSent(d);
  }

  /* ── Build template params for this booking ── */

  function _buildParams(bk, cfg) {
    var moveDate = (typeof fmtD === 'function')
      ? fmtD(bk.date || bk.move_date || '')
      : (bk.date || bk.move_date || '');

    return {
      to_email:      bk.email,
      customer_name: bk.name    || bk.customer_name || '',
      reference_id:  bk.id      || bk.reference_id  || '',
      move_date:     moveDate,
      move_time:     bk.time    || '未定',
      move_from:     bk.fromAddr|| bk.from_address  || '未定',
      move_to:       bk.toAddr  || bk.to_address    || '未定',
      service_type:  bk.service || '',
      booking_notes: bk.notes   || '',
      company_name:  'Hello Moving',
      company_phone: cfg.companyPhone  || '',
      company_email: cfg.companyEmail  || '',
    };
  }

  /* ── EmailJS send ── */

  async function _sendEmail(bk) {
    // EmailJS has been removed. This customer booking-reminder flow is DISABLED
    // pending a rebuild on the send-email.php gateway; it no longer sends email.
    void _buildParams;
    return { ok: false, detail: 'この自動メールは無効です（EmailJS 廃止・送信ゲートウェイ移行待ち）' };
  }

  /* ── Automation action (replaces placeholder in automationActions.js) ── */

  async function _action(ctx) {
    var bk = ctx.booking;
    if (!bk) throw new Error('予約データがありません');
    var bookingId = bk.id || bk.reference_id || '';
    if (isSent(bookingId)) {
      return 'スキップ（送信済み）: ' + (bk.name || bookingId);
    }
    var result = await _sendEmail(bk);
    if (result.ok) {
      markSent(bookingId, {
        email:   bk.email,
        name:    bk.name || bk.customer_name || '',
        refId:   bookingId,
        moveDate: bk.date || bk.move_date || '',
      });
      if (window.AuditLog) {
        AuditLog.record('other', 'automation', 'booking_reminder_sent',
          '引越しリマインダー送信: ' + (bk.name || bookingId) +
          ' <' + bk.email + '> → ' + (bk.date || bk.move_date || ''));
      }
    } else {
      throw new Error(result.detail);
    }
    return (bk.name || bookingId) + ': ' + result.detail;
  }

  /* ── Manual run ── */

  async function runNow() {
    var btn = document.getElementById('brRunNowBtn');
    if (btn) { btn.disabled = true; btn.textContent = '確認中…'; }
    try {
      var bookings = window.Adapter ? Adapter.getBookings() : [];
      var today    = new Date(); today.setHours(0, 0, 0, 0);
      var tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      var tomorrowStr = tomorrow.toISOString().slice(0, 10);
      var count = 0;

      for (var i = 0; i < bookings.length; i++) {
        var bk = bookings[i];
        if (bk.status !== '確定') continue;
        var dateStr = bk.date || bk.move_date || '';
        if (!dateStr || !bk.email) continue;
        if (dateStr !== tomorrowStr) continue;
        var bookingId = bk.id || bk.reference_id || '';
        if (isSent(bookingId)) continue;
        var result = await _sendEmail(bk);
        if (result.ok) {
          markSent(bookingId, {
            email: bk.email, name: bk.name || '',
            refId: bookingId, moveDate: dateStr
          });
          if (window.AuditLog) {
            AuditLog.record('other', 'automation', 'booking_reminder_sent',
              '引越しリマインダー: ' + (bk.name || bookingId));
          }
          count++;
        }
      }
      toast(count > 0
        ? '引越しリマインダーを ' + count + '件 送信しました'
        : '送信対象なし（明日移動予定・確定・未送信の予約なし）');
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
    ['move_time',     '希望時間帯'],
    ['move_from',     '引越し元住所'],
    ['move_to',       '引越し先住所'],
    ['service_type',  'サービス種別'],
    ['booking_notes', '備考'],
    ['company_name',  '会社名（Hello Moving）'],
    ['company_phone', '会社電話番号（設定値）'],
    ['company_email', '会社メールアドレス（設定値）'],
  ];

  function renderPanel() {
    var el = document.getElementById('brContent');
    if (!el) return;

    var cfg       = getSettings();
    var sentCount = Object.keys(getSent()).length;
    var log       = getLog().slice(0, 10);

    var logRows = log.length
      ? log.map(function (e) {
          var d  = new Date(e.sentAt);
          var ts = d.getFullYear() + '/' + _p2(d.getMonth() + 1) + '/' + _p2(d.getDate());
          return '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2)">' +
            '<span style="flex-shrink:0;display:inline-flex;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(37,99,235,.1);color:#1d4ed8;border:1px solid rgba(37,99,235,.2)">✓ 送信済み</span>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:12px;color:var(--ink)">' + esc(e.name || e.bookingId || '') + '</div>' +
              '<div style="font-size:11px;color:var(--gray-2);margin-top:2px">' +
                esc(e.email || '') + ' · 引越し日: ' + esc(e.moveDate || '') + ' · ' + ts +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div style="color:var(--gray-2);font-size:12px;padding:8px 0">まだ送信履歴がありません</div>';

    el.innerHTML =
      '<div class="panel" style="margin-top:16px">' +
        '<div class="panel-head">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" style="color:var(--blue);flex-shrink:0"><path fill="currentColor" d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zm-7-7h5v5h-5z"/></svg>' +
            '<span class="panel-title">引越しリマインダーメール（自動）</span>' +
            (sentCount ? '<span style="font-size:11px;padding:2px 8px;border-radius:12px;background:rgba(37,99,235,.1);color:#1d4ed8;font-weight:600">' + sentCount + '件 送信済み</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="panel-body">' +
          '<p style="font-size:12px;color:var(--gray-1);margin-bottom:14px;line-height:1.6">' +
            '自動化ルール「引越し前リマインダー」が実行されると、引越し日の1日前に顧客へリマインダーメールを送信します。<br>' +
            '引越し日・住所・希望時間帯・会社連絡先を含む内容で顧客に安心感を提供します。' +
          '</p>' +

          '<div class="m-field">' +
            '<label class="m-label">リマインダー Template ID</label>' +
            '<input class="input" id="brTemplateId" type="text" value="' + esc(cfg.templateId) + '" ' +
              'placeholder="template_xxxxxxx" style="font-family:monospace;font-size:12px;max-width:300px" />' +
            '<div style="font-size:11px;color:var(--gray-2);margin-top:4px">EmailJSで作成した顧客向けリマインダーテンプレートのID</div>' +
          '</div>' +

          '<div class="m-row">' +
            '<div class="m-field">' +
              '<label class="m-label">会社電話番号</label>' +
              '<input class="input" id="brCompanyPhone" type="text" value="' + esc(cfg.companyPhone) + '" ' +
                'placeholder="0120-000-000" />' +
              '<div style="font-size:11px;color:var(--gray-2);margin-top:4px">テンプレート変数 {{company_phone}} に入ります</div>' +
            '</div>' +
            '<div class="m-field">' +
              '<label class="m-label">会社メールアドレス</label>' +
              '<input class="input" id="brCompanyEmail" type="email" value="' + esc(cfg.companyEmail) + '" ' +
                'placeholder="hellomoving1@gmail.com" />' +
              '<div style="font-size:11px;color:var(--gray-2);margin-top:4px">テンプレート変数 {{company_email}} に入ります</div>' +
            '</div>' +
          '</div>' +

          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
            '<button class="btn btn-primary btn-sm" onclick="BookingReminderAction.savePanel()">保存</button>' +
            '<button class="btn btn-ghost btn-sm" id="brRunNowBtn" onclick="BookingReminderAction.runNow()">今すぐ確認 &amp; 送信</button>' +
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
              '<button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="BookingReminderAction.clearLog()">クリア</button>' +
            '</div>' +
            logRows +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function savePanel() {
    saveSettings({
      templateId:   (document.getElementById('brTemplateId')    || {}).value || '',
      companyPhone: (document.getElementById('brCompanyPhone')  || {}).value || '',
      companyEmail: (document.getElementById('brCompanyEmail')  || {}).value || '',
    });
    toast('リマインダー設定を保存しました');
  }

  function clearLog() { _clearLog(); renderPanel(); }

  function _p2(n) { return String(n).padStart(2, '0'); }

  /* ── Register real action (replaces placeholder in automationActions.js) ── */
  if (window.AutomationActions) {
    AutomationActions.register('send_move_reminder', _action);
  }

  /* ── Wrap renderEmail to inject the settings panel ── */
  var _origRenderEmail = window.renderEmail;
  if (typeof _origRenderEmail === 'function') {
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
