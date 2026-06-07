'use strict';

/* ════════════════════════════════════════════════════════
   EMAIL NOTIFY  (EmailJS REST API — no SDK required)
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

async function sendEmailNotif(templateParams, triggerKey) {
  const cfg = Adapter.getEmailSettings();
  if (!cfg.enabled || !cfg.publicKey || !cfg.serviceId || !cfg.templateId) return;
  if (triggerKey && !cfg.triggers[triggerKey]) return;
  const ts = new Date().toLocaleString('ja-JP');
  try {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id:      cfg.serviceId,
        template_id:     cfg.templateId,
        user_id:         cfg.publicKey,
        template_params: { to_email: cfg.adminEmail, ...templateParams }
      })
    });
    const ok = res.status === 200;
    Adapter.pushEmailLog({ ts, ok, subject: templateParams.subject || '', status: res.status });
    if (ok) toast('メール通知を送信しました');
    else    toast('メール送信エラー: HTTP ' + res.status);
  } catch(err) {
    Adapter.pushEmailLog({ ts, ok: false, subject: templateParams.subject || '', status: err.message.slice(0, 40) });
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

    <!-- Credentials panel -->
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
        <div class="m-field">
          <label class="m-label">通知先メールアドレス</label>
          <input class="input" id="emailAdmin" type="email" value="${esc(cfg.adminEmail)}" placeholder="admin@hello-moving.com" />
        </div>
        <div class="m-row">
          <div class="m-field">
            <label class="m-label">Service ID</label>
            <input class="input" id="emailServiceId" type="text" value="${esc(cfg.serviceId)}" placeholder="service_xxxxxxx" style="font-family:monospace;font-size:12px" />
          </div>
          <div class="m-field">
            <label class="m-label">Template ID</label>
            <input class="input" id="emailTemplateId" type="text" value="${esc(cfg.templateId)}" placeholder="template_xxxxxxx" style="font-family:monospace;font-size:12px" />
          </div>
        </div>
        <div class="m-field">
          <label class="m-label">Public Key</label>
          <div style="display:flex;gap:6px">
            <input class="input" id="emailPublicKey" type="password" value="${esc(cfg.publicKey)}" placeholder="EmailJS Public Key" style="font-family:monospace;font-size:12px" />
            <button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="var i=document.getElementById('emailPublicKey');i.type=i.type==='password'?'text':'password'">表示</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="saveEmailSettings()">保存</button>
          <button class="btn btn-ghost btn-sm" onclick="testEmailNotif()">テスト送信</button>
          <a class="btn btn-ghost btn-sm" href="https://www.emailjs.com/" target="_blank">EmailJSを開く ↗</a>
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

  <!-- Template variables reference -->
  <div class="panel" style="margin-bottom:16px">
    <div class="panel-head"><span class="panel-title">EmailJSテンプレート変数</span></div>
    <div class="panel-body">
      <p style="font-size:12px;color:var(--gray-1);margin-bottom:12px">EmailJSのテンプレートで以下の変数が使えます。テンプレートに <code style="background:var(--bg-soft-2);padding:1px 5px;border-radius:4px;font-size:11px">{{変数名}}</code> の形式で記述してください。</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px">
        ${[
          ['to_email',        '通知先メールアドレス'],
          ['subject',         'メール件名'],
          ['trigger_type',    'イベント種別'],
          ['booking_id',      '予約番号'],
          ['booking_name',    'お客様名'],
          ['booking_email',   'お客様メール'],
          ['booking_service', 'サービス'],
          ['booking_date',    '引越し日'],
          ['booking_time',    '希望時間帯'],
          ['booking_from',    '引越し元住所'],
          ['booking_to',      '引越し先住所'],
          ['booking_notes',   '備考'],
        ].map(([v, desc]) => `
          <div style="background:var(--bg-soft-2);border:1px solid var(--line);border-radius:6px;padding:7px 10px">
            <code style="font-size:11px;color:var(--blue)">{{${v}}}</code>
            <div style="font-size:11px;color:var(--gray-2);margin-top:2px">${desc}</div>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <!-- Setup instructions -->
  <div class="panel" style="margin-bottom:16px">
    <div class="panel-head"><span class="panel-title">設定手順</span></div>
    <div class="panel-body">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
        ${[
          ['1', 'EmailJSに登録', 'emailjs.com にアクセスし、無料アカウントを作成します（月200通まで無料）'],
          ['2', 'Email Serviceを追加', 'Email Services でGmailやOutlookなどを接続し、Service IDをメモします'],
          ['3', 'Templateを作成', 'Email Templates で通知テンプレートを作成。左の変数一覧を参考に {{変数名}} を配置します'],
          ['4', 'キーを設定', 'Account → General → Public Key をコピーし、上のフォームに Service ID・Template ID・Public Key を入力して保存します'],
        ].map(([n, title, desc]) => `
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="width:24px;height:24px;border-radius:50%;background:var(--blue);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${n}</div>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:3px">${title}</div>
              <div style="font-size:12px;color:var(--gray-2);line-height:1.55">${desc}</div>
            </div>
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
        <div style="font-size:11px;color:var(--gray-2);margin-top:2px">${esc(e.ts)} · HTTP ${esc(String(e.status))}</div>
      </div>
    </div>`).join('');
}

function saveEmailSettings() {
  const cfg      = Adapter.getEmailSettings();
  cfg.adminEmail = document.getElementById('emailAdmin')?.value.trim()      || cfg.adminEmail;
  cfg.serviceId  = document.getElementById('emailServiceId')?.value.trim()  || cfg.serviceId;
  cfg.templateId = document.getElementById('emailTemplateId')?.value.trim() || cfg.templateId;
  cfg.publicKey  = document.getElementById('emailPublicKey')?.value.trim()  || cfg.publicKey;
  cfg.enabled    = document.getElementById('emailEnabled')?.checked ?? cfg.enabled;
  document.querySelectorAll('[data-email-trigger]').forEach(cb => {
    cfg.triggers[cb.dataset.emailTrigger] = cb.checked;
  });
  Adapter.saveEmailSettings(cfg);
  toast('メール通知設定を保存しました');
}

async function testEmailNotif() {
  const cfg = Adapter.getEmailSettings();
  if (!cfg.publicKey || !cfg.serviceId || !cfg.templateId) { toast('Service ID・Template ID・Public Keyを入力してください'); return; }
  if (!cfg.adminEmail) { toast('通知先メールアドレスを入力してください'); return; }
  await sendEmailNotif({
    subject:      '[Hello Moving] テスト通知',
    trigger_type: 'テスト送信',
    booking_id: 'TEST-001', booking_name: 'テスト 太郎', booking_email: cfg.adminEmail,
    booking_service: '単身引越し', booking_date: new Date().toISOString().slice(0,10),
    booking_time: '午前 8:00〜12:00', booking_from: '東京都渋谷区', booking_to: '東京都新宿区', booking_notes: 'テスト送信です',
  }, null);
}
