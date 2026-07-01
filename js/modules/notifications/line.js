'use strict';

/* ════════════════════════════════════════════════════════
   LINE NOTIFY
   ════════════════════════════════════════════════════════ */
async function sendLineNotif(message, triggerKey) {
  const cfg = Adapter.getLineSettings();
  /* Admin-side preference gating still applies, but the Channel Access Token now
     lives SERVER-SIDE (hm-api/_config.php) and is sent via hm-api/line-push.php
     using the LINE Messaging API push endpoint — the token is never read in the
     browser (the old client-side LINE Notify path, retired March 2025, is gone).
     The legacy cfg.token / cfg.proxyUrl fields are no longer used for sending. */
  if (!cfg.enabled) return;
  if (triggerKey && cfg.triggers && !cfg.triggers[triggerKey]) return;

  const ts   = new Date().toLocaleString('ja-JP');
  const base = (window.API_BASE || '').replace(/\/$/, '');
  if (!base) { toast('API設定が見つかりません'); return; }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (window.API_KEY)          headers['X-API-KEY']     = window.API_KEY;
    if (window.__HM_ADMIN_TOKEN) headers['X-ADMIN-TOKEN'] = window.__HM_ADMIN_TOKEN;
    const res = await fetch(base + '/line-push.php', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, trigger: triggerKey || null })
    });
    let body = {};
    try { body = await res.json(); } catch (_) {}
    const ok = res.ok && body && (body.ok === true || (body.data && body.data.sent));
    const status = ok ? (res.status || 200)
                      : ((body && body.error && body.error.message) || ('HTTP ' + res.status));
    Adapter.pushLineLog({ ts, ok, preview: message.slice(0, 50), status });
    if (ok) toast('LINE通知を送信しました');
    else    toast('LINE通知エラー: ' + status);
  } catch (err) {
    Adapter.pushLineLog({ ts, ok: false, preview: message.slice(0, 50), status: (err.message || 'error').slice(0, 40) });
    toast('LINE通知に失敗しました（ネットワークエラー）');
  }
  if (document.getElementById('view-line')?.classList.contains('active')) renderLineLog();
}

function renderLine() {
  const cfg = Adapter.getLineSettings();
  const el  = document.getElementById('lineContent'); if (!el) return;

  el.innerHTML = `
  <div class="settings-grid" style="margin-bottom:16px">

    <!-- Token & enable panel -->
    <div class="panel">
      <div class="panel-head" style="background:rgba(6,199,85,.04);border-bottom-color:rgba(6,199,85,.2)">
        <div style="display:flex;align-items:center;gap:8px">
          <svg viewBox="0 0 24 24" width="18" height="18" style="color:#06C755;flex-shrink:0"><path fill="currentColor" d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.076 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
          <span class="panel-title">LINE Messaging API 設定</span>
        </div>
        <label class="toggle" title="${cfg.enabled?'無効にする':'有効にする'}">
          <input type="checkbox" id="lineEnabled" ${cfg.enabled?'checked':''} onchange="saveLineSettings()" />
          <div class="toggle-track"></div><div class="toggle-thumb"></div>
        </label>
      </div>
      <div class="panel-body">
        <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;background:rgba(6,199,85,.04);border:1px solid rgba(6,199,85,.2);border-radius:8px;margin-bottom:12px">
          <span style="flex-shrink:0;font-size:15px;line-height:1.4">🔒</span>
          <div style="font-size:12px;color:var(--gray-2);line-height:1.6">
            チャネルアクセストークンは<strong>サーバー側</strong>（<code>hm-api/_config.php</code>）に安全に保管され、ブラウザには一切露出しません。送信はサーバー経由の LINE Messaging API プッシュ（<code>hm-api/line-push.php</code>）で行われます。トークンや送信先の設定は開発者が <code>_config.php</code> で行います。
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn btn-primary btn-sm" onclick="saveLineSettings()">保存</button>
          <button class="btn btn-ghost btn-sm" onclick="testLineNotif()">テスト送信</button>
          <a class="btn btn-ghost btn-sm" href="https://developers.line.biz/console/" target="_blank">LINE Developers ↗</a>
        </div>
      </div>
    </div>

    <!-- Triggers panel -->
    <div class="panel">
      <div class="panel-head"><span class="panel-title">通知トリガー</span></div>
      <div class="panel-body">
        ${[
          ['newBooking',      '📅 新規予約',    '管理者が予約を追加したとき'],
          ['statusConfirmed', '✅ 予約確定',    'ステータスが「確定」に変わったとき'],
          ['statusComplete',  '🎉 引越し完了',  'ステータスが「完了」に変わったとき'],
          ['newQuote',        '📋 新規見積り',  '見積りリクエストが届いたとき'],
        ].map(([key, label, sub]) => `
          <div class="settings-row">
            <div>
              <div class="settings-label">${label}</div>
              <div class="settings-sub">${sub}</div>
            </div>
            <label class="toggle">
              <input type="checkbox" data-trigger="${key}" ${cfg.triggers[key]?'checked':''} onchange="saveLineSettings()" />
              <div class="toggle-track"></div><div class="toggle-thumb"></div>
            </label>
          </div>`).join('')}
      </div>
    </div>

  </div>

  <!-- Instructions -->
  <div class="panel" style="margin-bottom:16px">
    <div class="panel-head"><span class="panel-title">設定手順</span></div>
    <div class="panel-body">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
        ${[
          ['1', 'Messaging APIチャネルを作成', 'LINE Developers コンソールで Messaging API チャネルを作成し、チャネルアクセストークン（長期）を発行します'],
          ['2', 'サーバーに設定', '発行したトークンを hm-api/_config.php の line_channel_token に、送信先のuserId／グループIDを line_push_to に設定します（開発者が実施）'],
          ['3', '有効化', '_config.php の line_enabled を true にし、上のトグルをオンにして「保存」します'],
          ['4', 'テスト送信', '「テスト送信」ボタンで通知が届くか確認します。エラー時は送信ログに表示されるコードで原因を確認できます'],
        ].map(([n, title, desc]) => `
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="width:24px;height:24px;border-radius:50%;background:#06C755;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${n}</div>
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
      <button class="btn btn-ghost btn-sm" onclick="Adapter.clearLineLog();renderLineLog()">クリア</button>
    </div>
    <div id="lineLogBody" class="panel-body"></div>
  </div>`;

  renderLineLog();
}

function renderLineLog() {
  const el = document.getElementById('lineLogBody'); if (!el) return;
  const log = Adapter.getLineLog();
  if (!log.length) { el.innerHTML = '<div class="empty" style="padding:20px"><p>まだ送信履歴がありません</p></div>'; return; }
  el.innerHTML = log.map(e => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--line-2)">
      <span style="flex-shrink:0;display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;${e.ok?'background:rgba(16,185,129,.1);color:#059669;border:1px solid rgba(16,185,129,.2)':'background:rgba(239,68,68,.08);color:#b91c1c;border:1px solid rgba(239,68,68,.18)'}">
        ${e.ok ? '✓ 成功' : '✗ 失敗'}
      </span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;color:var(--ink);white-space:pre-wrap;line-height:1.4">${esc(e.preview)}${e.preview.length >= 50 ? '…' : ''}</div>
        <div style="font-size:11px;color:var(--gray-2);margin-top:2px">${esc(e.ts)} · ${esc(String(e.status))}</div>
      </div>
    </div>`).join('');
}

function saveLineSettings() {
  const cfg = Adapter.getLineSettings();
  // Token / proxy are no longer client-side — only the enable flag and per-trigger
  // preferences are stored here; the Channel Access Token lives in hm-api/_config.php.
  cfg.enabled  = document.getElementById('lineEnabled')?.checked ?? cfg.enabled;
  document.querySelectorAll('[data-trigger]').forEach(cb => {
    cfg.triggers[cb.dataset.trigger] = cb.checked;
  });
  Adapter.saveLineSettings(cfg);
  toast('LINE通知設定を保存しました');
}

async function testLineNotif() {
  // The Channel Access Token lives server-side (hm-api/_config.php); there is no
  // client-side token to gate on. sendLineNotif() posts to /line-push.php, which
  // reports line_disabled / line_no_token if the server side isn't configured.
  await sendLineNotif('🔔 Hello Moving Admin\nテスト通知です。LINE通知が正常に動作しています。', null);
}
