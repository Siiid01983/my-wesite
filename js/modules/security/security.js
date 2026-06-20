'use strict';

/* ════════════════════════════════════════════════════════
   SECURITY CENTER v2
   Score · Password · Session · Lockout · Staff · History
   ════════════════════════════════════════════════════════ */

/* ── State ── */
let _staffEditId = null;     // null = add | id = edit
let _staffResetId = null;

/* ── Constants ── */
const _RING_R = 32;
const _RING_C = +(2 * Math.PI * _RING_R).toFixed(1);  // ≈ 201.1

const _ROLE_LABEL = { admin: '管理者', staff: 'スタッフ', 'read-only': '閲覧専用' };
const _ROLE_COLOR = {
  admin:       { bg:'rgba(37,99,235,.1)',  color:'#2563eb', border:'rgba(37,99,235,.2)' },
  staff:       { bg:'rgba(16,185,129,.1)', color:'#059669', border:'rgba(16,185,129,.2)' },
  'read-only': { bg:'rgba(107,114,128,.1)',color:'#4b5563', border:'rgba(107,114,128,.2)' },
};

/* ════════════════════════════════════════════════════════
   MAIN RENDER
   ════════════════════════════════════════════════════════ */
function renderSecurity() {
  const el = document.getElementById('securityContent');
  if (!el) return;

  const { score, items } = _secScore();

  el.innerHTML =
    _renderSecScore(score, items) +
    `<div class="settings-grid" style="margin-bottom:16px">` +
      _renderSecAccount() +
      _renderSecSession() +
    `</div>` +
    `<div class="settings-grid" style="margin-bottom:16px">` +
      _renderSecPassword() +
      _renderSecLockout() +
    `</div>` +
    _renderSecStaff() +
    _renderSecHistory();
}

/* ════════════════════════════════════════════════════════
   SECURITY SCORE
   ════════════════════════════════════════════════════════ */
function _secScore() {
  const log = Auth.getLog();
  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;
  const recentFails = log.filter(e => e.type === 'fail' && new Date(e.ts).getTime() > last24h).length;
  const isLocked    = Auth.isLockedOut();
  const hasChangedPass = log.some(e => e.type === 'passwd_change');

  let score = 0;
  const items = [];

  if (hasChangedPass) {
    score += 40;
    items.push({ ok: true,    text: 'デフォルトパスワードから変更済み' });
  } else {
    items.push({ ok: false,   text: 'デフォルトパスワードから変更してください（+40点）' });
  }

  if (isLocked) {
    items.push({ ok: false,   text: 'アカウントがロックされています' });
  } else {
    score += 20;
    items.push({ ok: true,    text: 'アカウントロック状態なし' });
  }

  if (recentFails === 0) {
    score += 30;
    items.push({ ok: true,    text: '過去24時間の認証失敗なし' });
  } else if (recentFails < 5) {
    score += 10;
    items.push({ ok: 'warn',  text: `過去24時間に ${recentFails} 件の認証失敗` });
  } else {
    items.push({ ok: false,   text: `過去24時間に ${recentFails} 件の認証失敗 — 不審アクセスの可能性あり` });
  }

  score += 10;
  items.push({ ok: true, text: 'セッション有効（30分タイムアウト）' });

  return { score, items };
}

function _renderSecScore(score, items) {
  const color  = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
  const label  = score >= 80 ? 'セキュリティ良好' : score >= 50 ? '改善の余地あり' : '要対応';
  const offset = _RING_C * (1 - score / 100);

  const ring = `<div class="sec-ring-wrap">
    <svg viewBox="0 0 80 80" width="76" height="76">
      <circle cx="40" cy="40" r="${_RING_R}" fill="none" stroke="var(--line)" stroke-width="7"/>
      <circle cx="40" cy="40" r="${_RING_R}" fill="none" stroke="${color}" stroke-width="7"
        stroke-dasharray="${_RING_C}" stroke-dashoffset="${offset.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 40 40)" style="transition:stroke-dashoffset .5s ease"/>
    </svg>
    <div class="sec-ring-num" style="color:${color}">${score}</div>
  </div>`;

  const checks = items.map(it => {
    const icon = it.ok === true
      ? `<svg viewBox="0 0 24 24" width="14" height="14" style="color:var(--green);flex-shrink:0"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`
      : it.ok === 'warn'
      ? `<svg viewBox="0 0 24 24" width="14" height="14" style="color:var(--yellow);flex-shrink:0"><path fill="currentColor" d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="14" height="14" style="color:var(--red);flex-shrink:0"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
    return `<div class="sec-check-item">${icon}<span>${esc(it.text)}</span></div>`;
  }).join('');

  return `<div class="panel sec-score-panel" style="margin-bottom:16px">
    <div class="panel-body" style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
      ${ring}
      <div style="flex:1;min-width:180px">
        <div style="font-size:16px;font-weight:700;color:${color};margin-bottom:6px">${label}</div>
        <div class="sec-check-list">${checks}</div>
      </div>
    </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════
   ACCOUNT PANEL
   ════════════════════════════════════════════════════════ */
function _renderSecAccount() {
  const creds = (() => {
    try { return JSON.parse(localStorage.getItem(Auth.CREDS_KEY) || 'null'); } catch(e) { return null; }
  })();
  const user = Auth.getUser();
  const initials = (user.name || 'A').slice(0, 2).toUpperCase();

  return `<div class="panel">
    <div class="panel-head"><span class="panel-title">アカウント</span></div>
    <div class="panel-body">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
        <div class="sec-avatar" style="background:var(--navy)">${initials}</div>
        <div>
          <div style="font-weight:600;font-size:14px;color:var(--ink)">${esc(user.name)}</div>
          <div style="font-size:12px;color:var(--gray-1);margin-top:2px">${creds ? esc(creds.user) : '—'}</div>
          ${_roleBadge(user.role)}
        </div>
      </div>
      <div class="m-field">
        <label class="m-label">管理者メールアドレス</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="m-input" id="secEmailInput" type="email" value="${creds ? esc(creds.user) : ''}" placeholder="admin@example.com" style="flex:1" />
        </div>
      </div>
      <div id="secEmailMsg" class="sec-pass-msg"></div>
      <button class="btn btn-ghost btn-sm" onclick="doChangeEmail()">メールアドレスを変更する</button>
    </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════
   SESSION PANEL
   ════════════════════════════════════════════════════════ */
function _renderSecSession() {
  let content = '<div style="color:var(--gray-2);font-size:13px">セッション情報を取得できません</div>';

  try {
    const s = JSON.parse(sessionStorage.getItem(Auth.KEY) || 'null');
    if (s && s.token) {
      const elapsed  = Date.now() - s.ts;
      const remMs    = Math.max(0, Auth.TIMEOUT - elapsed);
      const remMins  = Math.ceil(remMs / 60000);
      const pct      = Math.max(0, (remMs / Auth.TIMEOUT) * 100);
      const barColor = pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--yellow)' : 'var(--red)';
      const loginAt  = new Date(s.ts).toLocaleString('ja-JP');
      const expAt    = new Date(s.ts + Auth.TIMEOUT).toLocaleString('ja-JP');

      content = `
        <div class="settings-row"><div class="settings-label">ログイン時刻</div><div style="font-size:13px">${loginAt}</div></div>
        <div class="settings-row"><div class="settings-label">セッション期限</div><div style="font-size:13px">${expAt}</div></div>
        <div class="settings-row"><div class="settings-label">残り時間</div><div style="font-weight:600;font-size:13px;color:${barColor}">${remMins} 分</div></div>
        <div class="sec-prog-track" style="margin:10px 0 14px">
          <div class="sec-prog-bar" style="width:${pct.toFixed(1)}%;background:${barColor}"></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="extendSession()">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
            延長（30分）
          </button>
          <button class="btn btn-danger btn-sm" onclick="logout()">ログアウト</button>
        </div>`;
    }
  } catch(e) {}

  return `<div class="panel">
    <div class="panel-head"><span class="panel-title">現在のセッション</span></div>
    <div class="panel-body">${content}</div>
  </div>`;
}

/* ════════════════════════════════════════════════════════
   PASSWORD CHANGE
   ════════════════════════════════════════════════════════ */
function _renderSecPassword() {
  return `<div class="panel">
    <div class="panel-head"><span class="panel-title">パスワード変更</span></div>
    <div class="panel-body">
      <div class="m-field">
        <label class="m-label">現在のパスワード</label>
        <input class="m-input" id="secCurrentPass" type="password" placeholder="現在のパスワード" autocomplete="current-password" />
      </div>
      <div class="m-field">
        <label class="m-label">新しいパスワード <span style="color:var(--gray-2);font-weight:400">（8文字以上）</span></label>
        <input class="m-input" id="secNewPass" type="password" placeholder="8文字以上" autocomplete="new-password" oninput="_secPassStrength(this.value)" />
        <div class="sec-strength-wrap" id="secStrengthWrap" style="display:none;margin-top:6px">
          <div class="sec-strength-track"><div class="sec-strength-bar" id="secStrengthBar"></div></div>
          <div class="sec-strength-label" id="secStrengthLabel"></div>
        </div>
      </div>
      <div class="m-field">
        <label class="m-label">新しいパスワード（確認）</label>
        <input class="m-input" id="secConfirmPass" type="password" placeholder="確認のため再入力" autocomplete="new-password" />
      </div>
      <div id="secPassMsg" class="sec-pass-msg"></div>
      <button class="btn btn-primary" onclick="doChangePassword()">パスワードを変更する</button>
    </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════
   LOCKOUT STATUS
   ════════════════════════════════════════════════════════ */
function _renderSecLockout() {
  const lk         = (() => { try { return JSON.parse(localStorage.getItem(Auth.LOCK_KEY)||'{}'); } catch(e) { return {}; } })();
  const isLocked   = Auth.isLockedOut();
  const lockMins   = Auth.lockoutMins();
  const failCount  = lk.count || 0;
  const maxFails   = Auth.MAX_ATTEMPTS;
  const times      = lk.times || 0;
  const attLeft    = Auth.attemptsLeft();

  const statusColor = isLocked ? 'var(--red)' : failCount > 0 ? 'var(--yellow)' : 'var(--green)';
  const statusLabel = isLocked ? 'ロック中' : failCount > 0 ? '注意' : '正常';
  const statusIcon  = isLocked
    ? `<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-9-2c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm3 11c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`;

  const rows = [
    ['ステータス',      `<span style="font-weight:600;color:${statusColor};display:inline-flex;align-items:center;gap:5px">${statusIcon}${statusLabel}</span>`],
    ['失敗試行数',      `${failCount} / ${maxFails}`],
    ['残り試行可能数',  isLocked ? '—' : `<span style="font-weight:600;color:${attLeft <= 2 ? 'var(--red)' : 'var(--ink)'}">${attLeft}回</span>`],
    ['ロック回数',      times > 0 ? `${times}回（段階的バックオフ中）` : '0回'],
    ['残りロック時間',  isLocked ? `<span style="font-weight:600;color:var(--red)">${lockMins}分</span>` : '—'],
  ];

  const tableRows = rows.map(([label, val]) =>
    `<div class="settings-row"><div class="settings-label">${label}</div><div style="font-size:13px">${val}</div></div>`
  ).join('');

  return `<div class="panel">
    <div class="panel-head">
      <span class="panel-title">ロックアウト状態</span>
      ${isLocked || failCount > 0 ? `<button class="btn btn-ghost btn-sm" onclick="resetLockout()">ロックを解除</button>` : ''}
    </div>
    <div class="panel-body">
      ${tableRows}
      <div style="margin-top:12px;font-size:11.5px;color:var(--gray-2);line-height:1.6">
        ${maxFails}回連続失敗でロック。バックオフ：15分 → 30分 → 60分 → 最大24時間
      </div>
    </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════
   STAFF MANAGEMENT
   ════════════════════════════════════════════════════════ */
function _renderSecStaff() {
  const staff = Auth.getStaff();

  const rows = staff.length === 0
    ? `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--gray-2)">スタッフメンバーなし</td></tr>`
    : staff.map(s => {
        const rc = _ROLE_COLOR[s.role] || _ROLE_COLOR.staff;
        const initials = (s.name || s.email).slice(0, 2).toUpperCase();
        const loginDate = s.lastLogin ? new Date(s.lastLogin).toLocaleDateString('ja-JP') : '—';
        return `<tr style="${!s.active ? 'opacity:.5' : ''}">
          <td>
            <div style="display:flex;align-items:center;gap:9px">
              <div class="sec-avatar" style="width:30px;height:30px;font-size:11px;background:var(--navy)">${initials}</div>
              <div>
                <div style="font-size:13px;font-weight:500">${esc(s.name)}</div>
                <div style="font-size:11px;color:var(--gray-2)">${esc(s.email)}</div>
              </div>
            </div>
          </td>
          <td><span class="cl-badge" style="background:${rc.bg};color:${rc.color};border:1px solid ${rc.border}">${_ROLE_LABEL[s.role]||s.role}</span></td>
          <td class="td-sm">${loginDate}</td>
          <td><span class="badge ${s.active ? 'badge-confirmed' : 'badge-cancel'}">${s.active ? '有効' : '無効'}</span></td>
          <td>
            <div style="display:flex;gap:4px">
              <button class="btn btn-ghost btn-sm btn-icon" title="編集" onclick="openStaffModal('${s.id}')">
                <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </button>
              <button class="btn btn-ghost btn-sm btn-icon" title="パスワードリセット" onclick="openResetPassModal('${s.id}')">
                <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
              </button>
              <button class="btn btn-ghost btn-sm btn-icon" title="${s.active ? '無効化' : '有効化'}" onclick="toggleStaffActive('${s.id}')">
                <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="${s.active ? 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z' : 'M8 5v14l11-7z'}"/></svg>
              </button>
              <button class="btn btn-danger btn-sm btn-icon" title="削除" onclick="deleteStaffMember('${s.id}')">
                <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
      }).join('');

  return `<div class="panel" style="margin-bottom:16px">
    <div class="panel-head">
      <span class="panel-title">スタッフ管理</span>
      <button class="btn btn-primary btn-sm" onclick="openStaffModal(null)">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        スタッフを追加
      </button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>メンバー</th><th>権限</th><th>最終ログイン</th><th>状態</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="padding:10px 16px;font-size:11.5px;color:var(--gray-2);border-top:1px solid var(--line-2)">
      スタッフアカウントはメインの管理者とは独立したパスワードで管理されます。権限：<strong>管理者</strong> = 全機能、<strong>スタッフ</strong> = 予約・見積り管理、<strong>閲覧専用</strong> = 読み取りのみ
    </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════
   LOGIN HISTORY
   ════════════════════════════════════════════════════════ */
function _renderSecHistory() {
  const log = Auth.getLog();

  const labelMap  = { login:'ログイン', logout:'ログアウト', fail:'認証失敗', passwd_change:'パスワード変更' };
  const badgeMap  = { login:'badge-confirmed', fail:'badge-cancel', logout:'badge-done', passwd_change:'badge-review' };
  const detailMap = { success:'成功', manual:'手動', timeout:'タイムアウト', wrong_creds:'認証エラー', locked:'ロック', forced:'強制変更' };

  const rows = !log.length
    ? `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--gray-2)">履歴なし</td></tr>`
    : log.map(e => `<tr>
        <td class="td-mono">${new Date(e.ts).toLocaleString('ja-JP')}</td>
        <td><span class="badge ${badgeMap[e.type]||'badge-done'}">${labelMap[e.type]||e.type}</span></td>
        <td class="td-sm">${esc(detailMap[e.detail] || e.detail?.replace?.(/^staff:/, 'スタッフ: ') || '')}</td>
      </tr>`).join('');

  return `<div class="panel">
    <div class="panel-head">
      <span class="panel-title">ログイン履歴 <span style="font-size:12px;font-weight:400;color:var(--gray-2)">(最新${log.length}件)</span></span>
      <button class="btn btn-ghost btn-sm" onclick="renderSecurity()">更新</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>日時</th><th>種別</th><th>詳細</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════
   PASSWORD ACTIONS
   ════════════════════════════════════════════════════════ */
async function doChangePassword() {
  const cur = document.getElementById('secCurrentPass')?.value;
  const nw  = document.getElementById('secNewPass')?.value;
  const con = document.getElementById('secConfirmPass')?.value;
  const msg = document.getElementById('secPassMsg');
  if (!msg) return;

  msg.className = 'sec-pass-msg sec-pass-err';
  if (!cur || !nw || !con) { msg.textContent = '全ての項目を入力してください'; return; }
  if (nw.length < 8)       { msg.textContent = 'パスワードは8文字以上で設定してください'; return; }
  if (nw !== con)          { msg.textContent = '新しいパスワードが一致しません'; return; }
  if (nw === cur)          { msg.textContent = '新しいパスワードは現在と異なるものにしてください'; return; }

  const ok = await Auth.changePassword(cur, nw);
  if (ok) {
    msg.className = 'sec-pass-msg sec-pass-ok';
    msg.textContent = 'パスワードを変更しました';
    document.getElementById('secCurrentPass').value = '';
    document.getElementById('secNewPass').value = '';
    document.getElementById('secConfirmPass').value = '';
    toast('パスワードを変更しました');
    setTimeout(renderSecurity, 300);
  } else {
    msg.textContent = '現在のパスワードが正しくありません';
  }
}

async function doChangeEmail() {
  const input = document.getElementById('secEmailInput');
  const msg   = document.getElementById('secEmailMsg');
  if (!input || !msg) return;
  const email = input.value.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    msg.className = 'sec-pass-msg sec-pass-err';
    msg.textContent = '有効なメールアドレスを入力してください';
    return;
  }
  try {
    const creds = JSON.parse(localStorage.getItem(Auth.CREDS_KEY) || 'null');
    if (!creds) { msg.className = 'sec-pass-msg sec-pass-err'; msg.textContent = '認証情報が見つかりません'; return; }
    creds.user = email;
    localStorage.setItem(Auth.CREDS_KEY, JSON.stringify(creds));
    msg.className = 'sec-pass-msg sec-pass-ok';
    msg.textContent = 'メールアドレスを変更しました';
    toast('メールアドレスを変更しました');
    setTimeout(renderSecurity, 300);
  } catch(e) {
    msg.className = 'sec-pass-msg sec-pass-err';
    msg.textContent = '変更に失敗しました';
  }
}

function _secPassStrength(val) {
  const wrap  = document.getElementById('secStrengthWrap');
  const bar   = document.getElementById('secStrengthBar');
  const label = document.getElementById('secStrengthLabel');
  if (!wrap || !bar || !label) return;
  if (!val) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  let score = 0;
  if (val.length >= 8)  score++;
  if (val.length >= 12) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;

  const levels = [
    { pct:20, color:'var(--red)',    text:'非常に弱い' },
    { pct:40, color:'var(--red)',    text:'弱い' },
    { pct:60, color:'var(--yellow)', text:'普通' },
    { pct:80, color:'var(--blue)',   text:'強い' },
    { pct:100,color:'var(--green)',  text:'非常に強い' },
  ];
  const lvl = levels[Math.min(score, levels.length - 1)];
  bar.style.width  = lvl.pct + '%';
  bar.style.background = lvl.color;
  label.textContent = lvl.text;
  label.style.color = lvl.color;
}

/* ════════════════════════════════════════════════════════
   SESSION & LOCKOUT ACTIONS
   ════════════════════════════════════════════════════════ */
function extendSession() {
  Auth.touch();
  toast('セッションを30分延長しました');
  renderSecurity();
}

function resetLockout() {
  localStorage.removeItem(Auth.LOCK_KEY);
  toast('ロックを解除しました');
  renderSecurity();
}

/* ════════════════════════════════════════════════════════
   STAFF MODAL — ADD / EDIT
   ════════════════════════════════════════════════════════ */
function openStaffModal(id) {
  _staffEditId = id;
  const modal   = document.getElementById('staffModal');
  const titleEl = document.getElementById('staffModalTitle');
  const nameEl  = document.getElementById('staffName');
  const emailEl = document.getElementById('staffEmail');
  const roleEl  = document.getElementById('staffRole');
  const passWrap= document.getElementById('staffPassWrap');
  const passEl  = document.getElementById('staffPassword');
  const msgEl   = document.getElementById('staffMsg');
  if (!modal) return;
  if (msgEl) msgEl.textContent = '';

  if (id) {
    const s = Auth.getStaff().find(x => x.id === id);
    if (!s) return;
    titleEl.textContent = 'スタッフを編集';
    nameEl.value  = s.name;
    emailEl.value = s.email;
    roleEl.value  = s.role;
    if (passWrap) passWrap.style.display = 'none';
  } else {
    titleEl.textContent = 'スタッフを追加';
    nameEl.value = emailEl.value = '';
    roleEl.value = 'staff';
    if (passEl) passEl.value = '';
    if (passWrap) passWrap.style.display = '';
  }

  modal.classList.add('open');
  setTimeout(() => nameEl?.focus(), 60);
}

function closeStaffModal() {
  const modal = document.getElementById('staffModal');
  if (modal) modal.classList.remove('open');
  _staffEditId = null;
}

async function saveStaffModal() {
  const name  = document.getElementById('staffName')?.value.trim();
  const email = document.getElementById('staffEmail')?.value.trim().toLowerCase();
  const role  = document.getElementById('staffRole')?.value;
  const pass  = document.getElementById('staffPassword')?.value;
  const msg   = document.getElementById('staffMsg');

  const setErr = txt => { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = txt; } };

  if (!name)          { setErr('名前を入力してください'); return; }
  if (_staffEditId) {
    Auth.updateStaffMember(_staffEditId, { name, role });
    closeStaffModal();
    renderSecurity();
    toast('スタッフ情報を更新しました');
  } else {
    if (!email || !email.includes('@')) { setErr('有効なメールアドレスを入力してください'); return; }
    if (!pass || pass.length < 8)       { setErr('パスワードは8文字以上で入力してください'); return; }
    const existing = Auth.getStaff().find(s => s.email === email);
    if (existing) { setErr('このメールアドレスは既に登録されています'); return; }
    await Auth.addStaffMember({ name, email, role, password: pass });
    closeStaffModal();
    renderSecurity();
    toast(`「${name}」を追加しました`);
  }
}

function toggleStaffActive(id) {
  const s = Auth.getStaff().find(x => x.id === id);
  if (!s) return;
  Auth.updateStaffMember(id, { active: !s.active });
  renderSecurity();
  toast(s.active ? '無効化しました' : '有効化しました');
}

function deleteStaffMember(id) {
  const s = Auth.getStaff().find(x => x.id === id);
  if (!s) return;
  if (!confirm(`「${s.name}」を削除しますか？`)) return;
  Auth.deleteStaffMember(id);
  renderSecurity();
  toast('スタッフを削除しました');
}

/* ════════════════════════════════════════════════════════
   STAFF RESET PASSWORD MODAL
   ════════════════════════════════════════════════════════ */
function openResetPassModal(id) {
  _staffResetId = id;
  const modal = document.getElementById('staffResetModal');
  const s     = Auth.getStaff().find(x => x.id === id);
  if (!modal || !s) return;
  const nameEl = document.getElementById('resetStaffName');
  const passEl = document.getElementById('resetStaffPass');
  const confEl = document.getElementById('resetStaffConf');
  const msgEl  = document.getElementById('resetStaffMsg');
  if (nameEl) nameEl.textContent = s.name;
  if (passEl) passEl.value = '';
  if (confEl) confEl.value = '';
  if (msgEl)  msgEl.textContent = '';
  modal.classList.add('open');
  setTimeout(() => passEl?.focus(), 60);
}

function closeResetPassModal() {
  const modal = document.getElementById('staffResetModal');
  if (modal) modal.classList.remove('open');
  _staffResetId = null;
}

async function saveResetPassModal() {
  const pass = document.getElementById('resetStaffPass')?.value;
  const conf = document.getElementById('resetStaffConf')?.value;
  const msg  = document.getElementById('resetStaffMsg');
  const setErr = txt => { if (msg) { msg.style.color='var(--red)'; msg.textContent=txt; } };

  if (!pass || pass.length < 8) { setErr('パスワードは8文字以上で入力してください'); return; }
  if (pass !== conf)             { setErr('パスワードが一致しません'); return; }

  const ok = await Auth.resetStaffPassword(_staffResetId, pass);
  if (ok) {
    closeResetPassModal();
    renderSecurity();
    toast('パスワードをリセットしました');
  } else {
    setErr('リセットに失敗しました');
  }
}

/* ════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════ */
function _roleBadge(role) {
  const rc = _ROLE_COLOR[role] || _ROLE_COLOR['read-only'];
  return `<span class="cl-badge" style="background:${rc.bg};color:${rc.color};border:1px solid ${rc.border};margin-top:4px;display:inline-block">${_ROLE_LABEL[role]||role}</span>`;
}

/* ════════════════════════════════════════════════════════
   SYSTEM HEALTH PAGE
   ════════════════════════════════════════════════════════ */
const _HC_SVC_LABEL = {
  api:          'API 接続',
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
    const statusBadge = s =>
      s === 'healthy' ? `<span class="badge badge-confirmed">正常</span>`
      : s === 'warning' ? `<span class="badge badge-review">警告</span>`
      : `<span class="badge badge-cancel">エラー</span>`;
    const overallColor = report.status === 'healthy' ? 'var(--green)' : report.status === 'warning' ? 'var(--yellow)' : 'var(--red)';
    const overallLabel = report.status === 'healthy' ? '✓ 全サービス正常' : report.status === 'warning' ? '⚠ 一部のサービスに警告があります' : '✕ 重大な設定エラーが検出されました';
    const ts = new Date(report.ts).toLocaleString('ja-JP');
    const rows = report.checks.map(c => `<tr>
      <td style="font-weight:500;font-size:13px">${_HC_SVC_LABEL[c.service] || c.service}</td>
      <td>${statusBadge(c.status)}</td>
      <td class="td-mono">${ts}</td>
      <td style="font-size:12px;color:var(--ink-2)">${esc(c.message)}</td>
    </tr>`).join('');
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid var(--line)">
        <span style="font-size:14px;font-weight:700;color:${overallColor}">${overallLabel}</span>
        <span style="font-size:11px;color:var(--gray-2);margin-left:auto">最終チェック: ${ts}</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>サービス</th><th>状態</th><th>チェック日時</th><th>詳細</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  });

  if (!logBody) return;
  const logs = window.HealthCheck.getLog();
  if (!logs.length) { logBody.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--gray-2)">ログなし</div>'; return; }
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
    setTimeout(() => { if (banner.classList.contains('hmhb-healthy')) banner.style.display = 'none'; }, 4000);
    return;
  }
  const isError = report.status === 'error';
  banner.className = isError ? 'hmhb-error' : 'hmhb-warning';
  banner.style.display = 'block';
  const icon = isError
    ? `<svg viewBox="0 0 24 24" width="15" height="15" style="flex-shrink:0"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="15" height="15" style="flex-shrink:0"><path fill="currentColor" d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z"/></svg>`;
  const issues = report.checks.filter(c => c.status !== 'healthy').length;
  banner.innerHTML = `<div class="hmhb-inner">
    ${icon}
    <span>${isError ? '重大な設定エラーが検出されました' : '一部のサービスに問題があります'}</span>
    <span style="opacity:.65;font-size:11px">${issues}件の問題</span>
    <button class="hmhb-link" onclick="go('health')" style="margin-left:4px">詳細を確認</button>
    <button class="hmhb-dismiss" onclick="document.getElementById('hmHealthBanner').style.display='none'">&#215;</button>
  </div>`;
}
