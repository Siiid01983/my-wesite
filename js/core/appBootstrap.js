'use strict';


/* ════════════════════════════════════════════════════════
   AUTH UI
   ════════════════════════════════════════════════════════ */
function showLogin() {
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('adminApp').style.display='none';
  let remembered = '';
  try {
    const raw = localStorage.getItem('hm_admin_remember');
    if (raw) {
      const r = JSON.parse(raw);
      if (r && r.user && r.exp && Date.now() < r.exp) remembered = r.user;
      else localStorage.removeItem('hm_admin_remember');
    }
  } catch(e) { /* legacy plain-string format — discard */ localStorage.removeItem('hm_admin_remember'); }
  document.getElementById('loginEmail').value = remembered;
  document.getElementById('rememberMe').checked = !!remembered;
  document.getElementById('loginPass').value='';
  document.getElementById('loginEmail').classList.remove('has-error');
  document.getElementById('loginPass').classList.remove('has-error');

  const errEl = document.getElementById('loginErr');
  const btn   = document.getElementById('loginBtn');
  if (Auth.isLockedOut()) {
    errEl.textContent = `アカウントがロックされています。${Auth.lockoutMins()}分後に再試行してください。`;
    errEl.className = 'login-err login-err-lock';
    errEl.style.display = 'block';
    btn.disabled = true;
    btn.querySelector('.login-btn-text').textContent = 'ロック中';
  } else {
    errEl.style.display = 'none';
    errEl.className = 'login-err';
    btn.disabled = false;
    btn.querySelector('.login-btn-text').textContent = 'ログイン';
  }

  if (remembered) document.getElementById('loginPass').focus();
  else document.getElementById('loginEmail').focus();
  _applyHcBanner();
}

function showApp() {
  /* Guard: redirect to gate if session still carries mustChange */
  if (Auth.isLoggedIn() && Auth.mustChangePassword()) { showForceChange(); return; }
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('forceChangeScreen').style.display='none';
  document.getElementById('adminApp').style.display='block';
  if (typeof _applyRoleToSidebar === 'function') _applyRoleToSidebar();
  /* Phase 27 — Mobile Experience */
  if (window.MobileNav)  MobileNav.init();
  if (window.MobileCal)  MobileCal.init();
  if (window.OfflineQueue) OfflineQueue.init();
  if (window.PushNotifications) PushNotifications.init();
  if (window.CameraCapture) CameraCapture.init();
}

function showForceChange() {
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('adminApp').style.display='none';
  document.getElementById('forceChangeScreen').style.display='flex';
  setTimeout(() => { const el = document.getElementById('fcNewPass'); if (el) el.focus(); }, 50);
}

async function doForceChange() {
  const newPass = document.getElementById('fcNewPass').value;
  const confirm = document.getElementById('fcConfirmPass').value;
  const msgEl   = document.getElementById('fcMsg');
  const btn     = document.getElementById('fcBtn');

  msgEl.className = 'sec-pass-msg sec-pass-err';
  msgEl.textContent = '';

  if (!newPass || !confirm) {
    msgEl.textContent = '全ての項目を入力してください'; return;
  }
  if (newPass.length < 8) {
    msgEl.textContent = 'パスワードは8文字以上で設定してください'; return;
  }
  if (newPass !== confirm) {
    msgEl.textContent = '新しいパスワードが一致しません'; return;
  }

  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('.login-btn-text').textContent = '変更中...';

  const ok = await Auth.forceChangePassword(newPass);

  btn.classList.remove('loading');
  btn.disabled = false;
  btn.querySelector('.login-btn-text').textContent = 'パスワードを変更して続ける';

  if (ok) {
    document.getElementById('fcNewPass').value = '';
    document.getElementById('fcConfirmPass').value = '';
    showApp(); init();
  } else {
    msgEl.textContent = 'エラーが発生しました。再試行してください。';
  }
}

function logout() { Auth.logout(); }

/* ════════════════════════════════════════════════════════
   EVENT HANDLERS
   ════════════════════════════════════════════════════════ */
function handleForgot() {
  alert('ログイン後、サイドバーの「セキュリティ」ページからパスワードを変更できます。\n\nお問い合わせ: hellomoving1@gmail.com');
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const emailEl   = document.getElementById('loginEmail');
  const passEl    = document.getElementById('loginPass');
  const btn       = document.getElementById('loginBtn');
  const errEl     = document.getElementById('loginErr');
  const emailHint = document.getElementById('loginEmailHint');
  const passHint  = document.getElementById('loginPassHint');

  emailEl.classList.remove('has-error'); emailHint.style.display='none';
  passEl.classList.remove('has-error');  passHint.style.display='none';
  errEl.style.display='none';
  errEl.className='login-err';

  if (Auth.isLockedOut()) {
    errEl.textContent = `アカウントがロックされています。${Auth.lockoutMins()}分後に再試行してください。`;
    errEl.className = 'login-err login-err-lock';
    errEl.style.display='block';
    btn.disabled=true;
    btn.querySelector('.login-btn-text').textContent='ロック中';
    return;
  }

  const u = emailEl.value.trim();
  const p = passEl.value;
  let valid = true;
  if (!u) { emailEl.classList.add('has-error'); emailHint.style.display='block'; emailEl.focus(); valid=false; }
  if (!p) { passEl.classList.add('has-error');  passHint.style.display='block'; if(valid)passEl.focus(); valid=false; }
  if (!valid) return;

  btn.disabled=true;
  btn.classList.add('loading');
  btn.querySelector('.login-btn-text').textContent='ログイン中...';

  const result = await Auth.login(u, p, document.getElementById('rememberMe').checked);

  btn.classList.remove('loading');

  if (result.ok) {
    if (result.mustChange) { showForceChange(); return; }
    showApp(); init();
    return;
  }

  btn.disabled=false;
  btn.querySelector('.login-btn-text').textContent='ログイン';

  if (result.locked) {
    emailEl.classList.add('has-error');
    passEl.classList.add('has-error');
    errEl.textContent=`ログイン試行回数が上限を超えました。${Auth.lockoutMins()}分間ロックされています。`;
    errEl.className='login-err login-err-lock';
    btn.disabled=true;
    btn.querySelector('.login-btn-text').textContent='ロック中';
  } else if (result.system) {
    /* Server-side / network problem — NOT a wrong password. Don't flag the
       fields and don't imply bad credentials; tell the operator what to fix. */
    errEl.textContent = _loginSystemMsg(result.code);
    errEl.className='login-err login-err-lock';
  } else {
    emailEl.classList.add('has-error');
    passEl.classList.add('has-error');
    const left=result.left;
    errEl.textContent = left>0
      ? `メールアドレスまたはパスワードが正しくありません（残り${left}回）`
      : 'メールアドレスまたはパスワードが正しくありません';
  }
  errEl.style.display='block';
});

/* Map a server/network error code to an actionable, non-credential message.
   Used by the login handler so a backend misconfiguration is never reported as
   "incorrect email or password" (see js/core/auth.js Auth.login classification). */
function _loginSystemMsg(code) {
  switch (code) {
    case 'admin_users_unprovisioned':
      return 'サーバーに管理者アカウントが未設定です。移行スクリプト（admin-migrate.php）を実行してください。';
    case 'admin_secret_missing':
      return 'サーバーの認証設定が未完了です（署名キー未設定）。_config.php の admin_session_secret を設定してください。';
    case 'api_key':
      return 'APIキーが一致しません。サーバー設定（_config.php の api_key）をご確認ください。';
    case 'network':
    case 'no_api':
    case 'bad_response':
      return 'サーバーに接続できません。ネットワーク状況とAPI設定（API_BASE）をご確認ください。';
    case 'rate_limited':
    case 'rate_limit':
      return 'リクエストが多すぎます。しばらくしてから再試行してください。';
    default:
      return 'サーバーエラーが発生しました。しばらくしてから再試行するか、管理者にお問い合わせください。';
  }
}

document.getElementById('loginPass').addEventListener('keydown', e => {
  if (e.key==='Enter') document.getElementById('loginBtn').click();
});
document.getElementById('loginEmail').addEventListener('keydown', e => {
  if (e.key==='Enter') document.getElementById('loginPass').focus();
});

/* Modal backdrop-close wiring — defensive: revModal/svcModal were migrated to
   the Website CMS in Phase 4 and no longer exist here, so guard every lookup. */
[
  ['editModal',   () => closeEdit()],
  ['detailModal', () => closeDetail()],
  ['reportModal', () => document.getElementById('reportModal').classList.remove('open')],
  ['revModal',    () => { if (typeof closeRevModal === 'function') closeRevModal(); }],
  ['svcModal',    () => { if (typeof closeSvcModal === 'function') closeSvcModal(); }],
  ['custModal',   () => closeCustModal()],
].forEach(([id, close]) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', e => { if (e.target === e.currentTarget) close(); });
});

document.addEventListener('keydown', e => {
  if (e.key==='Escape') {
    if (typeof closeEdit === 'function') closeEdit();
    if (typeof closeDetail === 'function') closeDetail();
    if (typeof closeRevModal === 'function') closeRevModal();
    if (typeof closeSvcModal === 'function') closeSvcModal();
    if (typeof closeCustModal === 'function') closeCustModal();
    if (typeof closeMediaPreview === 'function') closeMediaPreview();
    const _rm = document.getElementById('reportModal'); if (_rm) _rm.classList.remove('open');
    if (window.AutomationUI) AutomationUI.closeModal();
  }
  Auth.touch();
});
document.addEventListener('click', () => Auth.touch());

/* Resize charts on window resize */
let _resizeT;
window.addEventListener('resize', () => {
  clearTimeout(_resizeT);
  _resizeT = setTimeout(() => {
    if (document.getElementById('view-analytics').classList.contains('active')) renderAnalyticsCharts();
    if (document.getElementById('view-dashboard').classList.contains('active')) {
      if (window._biLastTrendData) _renderBITrendData(window._biLastTrendData);
    }
  }, 150);
});


/* ════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════ */
async function init() {
  if (Adapter.apiReady) {
    try { await Adapter.syncFromApi(); }
    catch(e) { console.warn('[Admin] API sync failed, using local cache:', e.message); }
  }
  Adapter.migrate();
  BookingService.bootstrap();
  Adapter.initializeRealtime();
  if (window.StatisticsService) StatisticsService.initializeRealtime();
  renderDash();
  Auth.startTimer();
  /* Check follow-ups after sync settles — fire-and-forget, never blocks init */
  if (window.FollowUp) setTimeout(() => FollowUp.checkAndSend(true), 4000);
  /* Start automation engine after data is ready */
  if (window.AutomationEngine) setTimeout(() => AutomationEngine.init(), 5000);
}

/* ════════════════════════════════════════════════════════
   HEALTH BANNER — LOGIN SCREEN
   Driven by the HealthCheck service (js/services/healthCheck.js).
   Shows a non-blocking amber banner when API is unreachable.
   ════════════════════════════════════════════════════════ */
var _hcReport = null;

function _applyHcBanner() {
  const banner = document.getElementById('hcBanner');
  if (!banner) return;
  if (!_hcReport) { banner.style.display = 'none'; return; }
  const apiCheck = _hcReport.checks.find(c => c.service === 'api');
  if (!apiCheck || apiCheck.status === 'healthy') { banner.style.display = 'none'; return; }
  const isError = apiCheck.status === 'error';
  banner.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px">
      <svg viewBox="0 0 24 24" width="18" height="18" style="flex-shrink:0;margin-top:1px">
        <path fill="currentColor" d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z"/>
      </svg>
      <div style="flex:1">
        <div style="font-weight:700;font-size:12px;margin-bottom:3px">${isError ? '設定の確認が必要です' : 'API 接続の警告'}</div>
        <div style="font-size:12px;line-height:1.5">${esc(apiCheck.message)}</div>
        <div style="font-size:11px;margin-top:5px;opacity:.75">API との同期は機能しません。データはローカルキャッシュから読み込まれます。</div>
      </div>
      <button onclick="document.getElementById('hcBanner').style.display='none'"
        style="background:none;border:none;cursor:pointer;padding:0;font-size:18px;line-height:1;opacity:.6;color:inherit">&#215;</button>
    </div>`;
  banner.style.display = 'block';
}

/* ════════════════════════════════════════════════════════
   STARTUP
   Sequence: Auth.initCreds → show screen → HealthCheck.run()
   (async, non-blocking) → apply banners on completion.
   Application never crashes — HealthCheck errors are caught.
   ════════════════════════════════════════════════════════ */
(async () => {
  await Auth.initCreds();

  /* Dev-only bypass: dev-reset.html writes hm_admin_bypass to localStorage.
     Consumed once — calls showApp() directly without touching sessionStorage,
     so it works even when sessionStorage is blocked by browser privacy settings.
     Only active on localhost / 127.0.0.1. Never runs on the production domain. */
  let _devBypass = false;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    try {
      const _bp = JSON.parse(localStorage.getItem('hm_admin_bypass') || 'null');
      if (_bp && _bp.exp > Date.now()) {
        localStorage.removeItem('hm_admin_bypass');
        _devBypass = true;
      }
    } catch(e) { /* storage blocked — fall through to normal login */ }
  }

  if (window.location.hash === '#review') {
    showPublicReviewForm();
  } else if (_devBypass) {
    showApp(); await init();
  } else if (Auth.isLoggedIn()) {
    if (Auth.mustChangePassword()) { showForceChange(); }
    else { showApp(); await init(); }
    /* Validate the restored token against the server (admin-session.php). The
       client only trusts its own marker; this catches a token revoked SERVER-side
       (account disabled/deleted, or logged out elsewhere) while the marker still
       looks valid. Fire-and-forget; log out ONLY on an explicit invalid so a
       transient network outage never ejects a working admin. */
    Auth.verifySession().then(function (v) {
      if (v && v.valid === false) { Auth._addLog('logout', 'revoked'); Auth.logout(); }
    }).catch(function () {});
  } else {
    showLogin();
  }

  /* Run health check after the screen is shown — non-blocking */
  if (window.HealthCheck) {
    window.HealthCheck.run().then(report => {
      _hcReport = report;
      _applyHcBanner();
      if (Auth.isLoggedIn()) _applyAppHealthBanner(report);
    }).catch(e => console.warn('[HealthCheck] startup check failed:', e));
  }

  /* Keep the login/app health banners in sync with EVERY health check — not just
     the boot one — so a recovered (healthy) status clears stale error banners
     immediately, with no page reload. Driven by the health:* event run() fires. */
  ['health:healthy', 'health:warning', 'health:error'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      _hcReport = e.detail;
      console.info('[HealthCheck] banner update (appBootstrap) → status=' + (e.detail && e.detail.status));
      try { _applyHcBanner(); } catch (_) {}
      try { if (Auth.isLoggedIn() && typeof _applyAppHealthBanner === 'function') _applyAppHealthBanner(e.detail); } catch (_) {}
    });
  });
})();
