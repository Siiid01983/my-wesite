'use strict';

/* ════════════════════════════════════════════════════════
   EMAIL NOTIFY — admin booking notifications
   Routed through the send-email.php gateway (authenticated SMTP via
   hm-api/EmailService.php). EmailJS has been removed.
     new booking / confirmed → booking@hello-moving.com
     completed               → support@hello-moving.com
   Server logs each send in the communications table (log_comm:true).
   ════════════════════════════════════════════════════════ */
function bkEmailParams(b) {
  return {
    booking_id:     b.id      || '',
    booking_name:   b.name    || '',
    booking_email:  b.email   || '',
    booking_service:b.service || '',
    booking_date:   b.date    || '未定',
    booking_time:   b.time    || '',
    booking_from:   b.fromAddr|| '',
    booking_to:     b.toAddr  || '',
    booking_notes:  b.notes   || '',
  };
}

/* trigger → gateway account + admin recipient mailbox */
const NOTIF_ACCOUNT = { newBooking:'booking', statusConfirmed:'booking', statusComplete:'support', newQuote:'booking' };
const NOTIF_MAILBOX = { booking:'booking@hello-moving.com', support:'support@hello-moving.com', contact:'contact@hello-moving.com' };

/* Plain-text admin notification body built from the booking template params. */
function _buildAdminMessage(p) {
  return [
    (p.trigger_type ? '【' + p.trigger_type + '】' : '') + '予約通知',
    '',
    '受付番号　：' + (p.booking_id      || '—'),
    'お客様名　：' + (p.booking_name    || '—'),
    'メール　　：' + (p.booking_email   || '—'),
    'サービス　：' + (p.booking_service || '—'),
    '引越し日　：' + (p.booking_date    || '未定'),
    '希望時間帯：' + (p.booking_time    || '—'),
    '引越し元　：' + (p.booking_from    || '—'),
    '引越し先　：' + (p.booking_to      || '—'),
    (p.booking_notes ? '備考　　　：' + p.booking_notes : ''),
    '',
    '管理パネル: ' + (window.location.origin + '/admin.html'),
  ].filter(function (line) { return line !== ''; }).join('\n');
}

async function sendEmailNotif(templateParams, triggerKey) {
  const cfg = Adapter.getEmailSettings();
  if (!cfg.enabled) return;
  if (triggerKey && cfg.triggers && !cfg.triggers[triggerKey]) return;

  const account = NOTIF_ACCOUNT[triggerKey] || 'booking';
  const to      = NOTIF_MAILBOX[account];
  const subject = templateParams.subject || '[Hello Moving] 予約通知';
  const message = _buildAdminMessage(templateParams);
  const ts      = new Date().toLocaleString('ja-JP');
  const url     = (window.API_BASE || '').replace(/\/$/, '') + '/send-email.php';

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' },
      body: JSON.stringify({
        from_account: account,
        to:           to,
        subject:      subject,
        message:      message,
        booking_id:   templateParams.booking_id || '',
        log_comm:     true,      /* record in communications (server-side) */
      }),
    });
    const result = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }));
    const ok  = !!result.ok;
    const err = result.error && (result.error.message || result.error);
    Adapter.pushEmailLog({ ts, ok, subject, status: ok ? 'sent' : (err || res.status) });
    if (ok) toast('メール通知を送信しました');
    else    toast('メール送信エラー: ' + (err || ('HTTP ' + res.status)));
  } catch (err) {
    Adapter.pushEmailLog({ ts, ok: false, subject, status: (err.message || '').slice(0, 40) });
    toast('メール送信に失敗しました');
  }
  if (document.getElementById('view-email')?.classList.contains('active')) renderEmailLog();
}

function renderEmail() {
  const cfg = Adapter.getEmailSettings();
  const el  = document.getElementById('emailContent'); if (!el) return;

  const triggerRows = [
    ['newBooking',      '📅 新規予約',   '管理者が予約を追加したとき'],
    ['statusConfirmed', '✅ 予約確定',   'ステータスが「確定」に変わったとき'],
    ['statusComplete',  '🎉 引越し完了', 'ステータスが「完了」に変わったとき'],
    ['newQuote',        '📋 新規見積り', '見積りリクエストが届いたとき'],
  ];

  el.innerHTML = `
  <div class="settings-grid" style="margin-bottom:16px">

    <!-- Notification settings panel -->
    <div class="panel">
      <div class="panel-head">
        <div style="display:flex;align-items:center;gap:8px">
          <svg viewBox="0 0 24 24" width="18" height="18" style="color:var(--blue);flex-shrink:0"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>
          <span class="panel-title">メール通知設定</span>
        </div>
        <label class="toggle" title="${cfg.enabled?'無効にする':'有効にする'}">
          <input type="checkbox" id="emailEnabled" ${cfg.enabled?'checked':''} onchange="saveEmailSettings()" />
          <div class="toggle-track"></div><div class="toggle-thumb"></div>
        </label>
      </div>
      <div class="panel-body">
        <p style="font-size:12px;color:var(--gray-1);line-height:1.7;margin-bottom:14px">
          予約通知は自社SMTPの送信ゲートウェイ（send-email.php）経由で送信されます。<br>
          新規予約・予約確定 → <code style="background:var(--bg-soft-2);padding:1px 5px;border-radius:4px;font-size:11px">booking@hello-moving.com</code>、
          引越し完了 → <code style="background:var(--bg-soft-2);padding:1px 5px;border-radius:4px;font-size:11px">support@hello-moving.com</code>。
          追加の設定は不要です。
        </p>
        <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="testEmailNotif()">テスト送信</button>
        </div>
      </div>
    </div>

    <!-- Triggers panel -->
    <div class="panel">
      <div class="panel-head"><span class="panel-title">通知トリガー</span></div>
      <div class="panel-body">
        ${triggerRows.map(([key, label, sub]) => `
          <div class="settings-row">
            <div>
              <div class="settings-label">${label}</div>
              <div class="settings-sub">${sub}</div>
            </div>
            <label class="toggle">
              <input type="checkbox" data-email-trigger="${key}" ${cfg.triggers[key]?'checked':''} onchange="saveEmailSettings()" />
              <div class="toggle-track"></div><div class="toggle-thumb"></div>
            </label>
          </div>`).join('')}
      </div>
    </div>

  </div>

  <!-- Log -->
  <div class="panel">
    <div class="panel-head">
      <span class="panel-title">送信ログ</span>
      <button class="btn btn-ghost btn-sm" onclick="Adapter.clearEmailLog();renderEmailLog()">クリア</button>
    </div>
    <div id="emailLogBody" class="panel-body"></div>
  </div>`;

  renderEmailLog();
  if (window.FollowUp) FollowUp.renderFollowUpPanel();
}

function renderEmailLog() {
  const el = document.getElementById('emailLogBody'); if (!el) return;
  const log = Adapter.getEmailLog();
  if (!log.length) { el.innerHTML = '<div class="empty" style="padding:20px"><p>まだ送信履歴がありません</p></div>'; return; }
  el.innerHTML = log.map(e => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--line-2)">
      <span style="flex-shrink:0;display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;${e.ok?'background:rgba(16,185,129,.1);color:#059669;border:1px solid rgba(16,185,129,.2)':'background:rgba(239,68,68,.08);color:#b91c1c;border:1px solid rgba(239,68,68,.18)'}">
        ${e.ok ? '✓ 成功' : '✗ 失敗'}
      </span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.subject)}</div>
        <div style="font-size:11px;color:var(--gray-2);margin-top:2px">${esc(e.ts)} · ${esc(String(e.status))}</div>
      </div>
    </div>`).join('');
}

function saveEmailSettings() {
  const cfg   = Adapter.getEmailSettings();
  cfg.enabled = document.getElementById('emailEnabled')?.checked ?? cfg.enabled;
  cfg.triggers = cfg.triggers || {};
  document.querySelectorAll('[data-email-trigger]').forEach(cb => {
    cfg.triggers[cb.dataset.emailTrigger] = cb.checked;
  });
  Adapter.saveEmailSettings(cfg);
  toast('メール通知設定を保存しました');
}

async function testEmailNotif() {
  const cfg = Adapter.getEmailSettings();
  if (!cfg.enabled) { toast('メール通知が無効です。先に有効化してください'); return; }
  /* triggerKey=null bypasses the per-trigger toggle; routes to booking@ */
  await sendEmailNotif({
    subject:      '[Hello Moving] テスト通知',
    trigger_type: 'テスト送信',
    booking_id: 'TEST-001', booking_name: 'テスト 太郎', booking_email: 'booking@hello-moving.com',
    booking_service: '単身引越し', booking_date: new Date().toISOString().slice(0,10),
    booking_time: '午前 8:00〜12:00', booking_from: '東京都渋谷区', booking_to: '東京都新宿区', booking_notes: 'テスト送信です',
  }, null);
}
