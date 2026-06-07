'use strict';

/* ════════════════════════════════════════════════════════
   SECURITY PAGE
   ════════════════════════════════════════════════════════ */
function renderSecurity() {
  const si = document.getElementById('secSessionInfo');
  if (si) {
    try {
      const s = JSON.parse(sessionStorage.getItem(Auth.KEY)||'null');
      if (s && s.token) {
        const loginAt = new Date(s.ts);
        const exp     = new Date(s.ts + Auth.TIMEOUT);
        const remMins = Math.max(0, Math.ceil((Auth.TIMEOUT - (Date.now()-s.ts)) / 60000));
        si.innerHTML = `
          <div class="settings-row"><div><div class="settings-label">ログイン時刻</div></div><div style="font-size:13px;color:var(--ink)">${loginAt.toLocaleString('ja-JP')}</div></div>
          <div class="settings-row"><div><div class="settings-label">セッション期限</div></div><div style="font-size:13px;color:var(--ink)">${exp.toLocaleString('ja-JP')}</div></div>
          <div class="settings-row"><div><div class="settings-label">残り時間</div></div><div style="font-size:13px;color:var(--green);font-weight:600">${remMins}分</div></div>
          <div style="margin-top:12px"><button class="btn btn-danger btn-sm" onclick="logout()">セッションを終了する</button></div>
        `;
      }
    } catch(e) {}
  }

  const tbody = document.getElementById('secLogBody');
  if (!tbody) return;
  const log = Auth.getLog();
  if (!log.length) {
    tbody.innerHTML='<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--gray-2)">履歴なし</td></tr>';
    return;
  }
  const labelMap  = {login:'ログイン',logout:'ログアウト',fail:'認証失敗',passwd_change:'パスワード変更'};
  const typeClass = {login:'badge-confirmed',fail:'badge-cancel',logout:'badge-done',passwd_change:'badge-review'};
  const detailMap = {success:'成功',manual:'手動',timeout:'タイムアウト',wrong_creds:'認証エラー',locked:'アカウントロック'};
  tbody.innerHTML = log.map(e => `<tr>
    <td class="td-mono">${new Date(e.ts).toLocaleString('ja-JP')}</td>
    <td><span class="badge ${typeClass[e.type]||'badge-done'}">${labelMap[e.type]||e.type}</span></td>
    <td class="td-sm">${detailMap[e.detail]||e.detail||''}</td>
  </tr>`).join('');
}

/* ════════════════════════════════════════════════════════
   SYSTEM HEALTH PAGE
   ════════════════════════════════════════════════════════ */
const _HC_SVC_LABEL = {
  supabase:     'Supabase 接続',
  dataProvider: 'データプロバイダー',
  services:     'サービスレジストリ',
  storage:      'ストレージ',
  auth:         '認証サービス',
};

function renderHealth() {
  const body    = document.getElementById('healthViewBody');
  const logBody = document.getElementById('healthLogBody');
  if (!body) return;

  window.HealthCheck.getReport().then(report => {
    if (!report) {
      body.innerHTML = '<div style="text-align:center;padding:30px 0;color:var(--gray-2)">チェック未実行 — 「再チェック」ボタンを押してください</div>';
      return;
    }

    const _statusBadge = s =>
      s === 'healthy' ? `<span class="badge badge-confirmed">正常</span>`
      : s === 'warning' ? `<span class="badge badge-review">警告</span>`
      : `<span class="badge badge-cancel">エラー</span>`;

    const _overallColor = report.status === 'healthy' ? 'var(--green)' : report.status === 'warning' ? 'var(--yellow)' : 'var(--red)';
    const _overallLabel = report.status === 'healthy' ? '✓ 全サービス正常'
      : report.status === 'warning' ? '⚠ 一部のサービスに警告があります'
      : '✕ 重大な設定エラーが検出されました';
    const _ts = new Date(report.ts).toLocaleString('ja-JP');

    const rows = report.checks.map(c => `<tr>
      <td style="font-weight:500;font-size:13px">${_HC_SVC_LABEL[c.service] || c.service}</td>
      <td>${_statusBadge(c.status)}</td>
      <td class="td-mono">${_ts}</td>
      <td style="font-size:12px;color:var(--ink-2)">${esc(c.message)}</td>
    </tr>`).join('');

    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid var(--line)">
        <span style="font-size:14px;font-weight:700;color:${_overallColor}">${_overallLabel}</span>
        <span style="font-size:11px;color:var(--gray-2);margin-left:auto">最終チェック: ${_ts}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>サービス</th><th>状態</th><th>チェック日時</th><th>詳細</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  });

  if (!logBody) return;
  const logs = window.HealthCheck.getLog();
  if (!logs.length) {
    logBody.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--gray-2)">ログなし</div>';
    return;
  }
  const logRows = logs.slice(0, 100).map(l => {
    const color = l.status === 'healthy' ? 'var(--green)' : l.status === 'warning' ? 'var(--yellow)' : 'var(--red)';
    return `<tr>
      <td class="td-mono">${new Date(l.ts).toLocaleString('ja-JP')}</td>
      <td style="font-size:12px;font-weight:500;color:${color}">${_HC_SVC_LABEL[l.service] || l.service}</td>
      <td><span class="badge ${l.status==='healthy'?'badge-confirmed':l.status==='warning'?'badge-review':'badge-cancel'}">${l.status==='healthy'?'正常':l.status==='warning'?'警告':'エラー'}</span></td>
      <td style="font-size:12px">${esc(l.message)}</td>
    </tr>`;
  }).join('');
  logBody.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>日時</th><th>サービス</th><th>状態</th><th>メッセージ</th></tr></thead>
    <tbody>${logRows}</tbody>
  </table></div>`;
}

async function _refreshHealth() {
  const body = document.getElementById('healthViewBody');
  if (body) body.innerHTML = '<div style="text-align:center;padding:30px 0;color:var(--gray-2)">チェック実行中...</div>';
  const report = await window.HealthCheck.run();
  _hcReport = report;
  _applyHcBanner();
  _applyAppHealthBanner(report);
  renderHealth();
  toast('ヘルスチェック完了');
}

function _clearHealthLog() {
  window.HealthCheck.clearLog();
  renderHealth();
  toast('ログをクリアしました');
}

/* ════════════════════════════════════════════════════════
   IN-APP HEALTH BANNER
   ════════════════════════════════════════════════════════ */
function _applyAppHealthBanner(report) {
  const banner = document.getElementById('hmHealthBanner');
  if (!banner || !report) return;

  if (report.status === 'healthy') {
    banner.className = 'hmhb-healthy';
    banner.style.display = 'block';
    banner.innerHTML = `<div class="hmhb-inner">
      <svg viewBox="0 0 24 24" width="15" height="15" style="flex-shrink:0"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
      <span>システム正常 — 全サービス動作中</span>
      <button class="hmhb-dismiss" onclick="document.getElementById('hmHealthBanner').style.display='none'">&#215;</button>
    </div>`;
    setTimeout(() => {
      if (banner.classList.contains('hmhb-healthy')) banner.style.display = 'none';
    }, 4000);
    return;
  }

  const isError   = report.status === 'error';
  banner.className = isError ? 'hmhb-error' : 'hmhb-warning';
  banner.style.display = 'block';

  const icon = isError
    ? `<svg viewBox="0 0 24 24" width="15" height="15" style="flex-shrink:0"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="15" height="15" style="flex-shrink:0"><path fill="currentColor" d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z"/></svg>`;
  const label   = isError ? '重大な設定エラーが検出されました' : '一部のサービスに問題があります';
  const issues  = report.checks.filter(c => c.status !== 'healthy').length;

  banner.innerHTML = `<div class="hmhb-inner">
    ${icon}
    <span>${label}</span>
    <span style="opacity:.65;font-size:11px">${issues}件の問題</span>
    <button class="hmhb-link" onclick="go('health')" style="margin-left:4px">詳細を確認</button>
    <button class="hmhb-dismiss" onclick="document.getElementById('hmHealthBanner').style.display='none'">&#215;</button>
  </div>`;
}

async function doChangePassword() {
  const cur = document.getElementById('secCurrentPass').value;
  const nw  = document.getElementById('secNewPass').value;
  const con = document.getElementById('secConfirmPass').value;
  const msg = document.getElementById('secPassMsg');

  msg.className='sec-pass-msg sec-pass-err';
  if (!cur||!nw||!con)       { msg.textContent='全ての項目を入力してください'; return; }
  if (nw.length < 8)         { msg.textContent='パスワードは8文字以上で設定してください'; return; }
  if (nw !== con)            { msg.textContent='新しいパスワードが一致しません'; return; }
  if (nw === cur)            { msg.textContent='新しいパスワードは現在と異なるものにしてください'; return; }

  const ok = await Auth.changePassword(cur, nw);
  if (ok) {
    msg.className='sec-pass-msg sec-pass-ok';
    msg.textContent='パスワードを変更しました';
    document.getElementById('secCurrentPass').value='';
    document.getElementById('secNewPass').value='';
    document.getElementById('secConfirmPass').value='';
    toast('パスワードを変更しました');
  } else {
    msg.textContent='現在のパスワードが正しくありません';
  }
}