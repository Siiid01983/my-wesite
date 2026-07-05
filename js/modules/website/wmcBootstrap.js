'use strict';

/* ── Startup dependency audit ── */
(function () {
  var required = [
    ['Auth',           'js/core/auth.js'],
    ['Adapter',        'js/services/apiAdapter.js'],
    ['DataProvider',   'js/services/dataProvider.js'],
    ['HealthCheck',    'js/services/healthCheck.js'],
    ['AuditLog',       'js/modules/audit/auditLog.js'],
    ['Services',       'js/services/serviceRegistry.js'],
    ['WMCPermissions', 'js/modules/website/wmcCore.js'],
  ];
  var extended = [
    ['WMCPageManager', 'js/modules/wmc/pageManager.js'],
    ['WMCMedia',       'js/modules/wmc/wmcMedia.js'],
    ['WMCBlockEditor', 'js/modules/wmc/blockEditor.js'],
  ];
  var missing    = required.filter(function (c) { return typeof window[c[0]] === 'undefined'; });
  var missingExt = extended.filter(function (c) { return typeof window[c[0]] === 'undefined'; });
  if (missing.length) {
    console.group('[WMC] Dependency audit — ' + missing.length + ' required global(s) missing');
    missing.forEach(function (c) {
      console.error('[WMC] Missing required: window.' + c[0] + '  ←  ' + c[1]);
    });
    console.groupEnd();
  }
  if (missingExt.length) {
    console.group('[WMC] Dependency audit — ' + missingExt.length + ' extended global(s) missing');
    missingExt.forEach(function (c) {
      console.warn('[WMC] Missing extended: window.' + c[0] + '  ←  ' + c[1]);
    });
    console.groupEnd();
  }
  if (!missing.length && !missingExt.length) {
    console.log('[WMC] Dependency audit — all globals present ✓');
  }
}());

/* Global shim */
function showLogin() { _wmcShowLogin(); }

/* Navigation */
var _wmcCurrentView = 'overview';

var WMC_BREADCRUMBS = {
  overview    : '概要',
  pages       : 'ページ管理',
  blog        : 'ブログ投稿',
  services    : 'サービス管理',
  reviews     : 'レビュー',
  media       : 'メディア',
  seo         : 'SEO設定',
  analytics   : 'アナリティクス',
  theme       : 'テーマカスタマイザー',
  deploy      : 'デプロイメントセンター',
  permissions : '権限管理',
  settings    : 'サイト設定',
};

var _WMC_VIEW_PERMS = {
  theme       : 'manage_theme',
  deploy      : 'manage_deploy',
  settings    : 'modify_settings',
  permissions : 'manage_users',
};

function wmcGo(view) {
  if (!Auth.isLoggedIn()) { _wmcShowLogin(); return; }
  Auth.touch();
  var old     = document.getElementById('wmc-view-' + _wmcCurrentView);
  var oldLink = document.querySelector('.wmc-link[data-view="' + _wmcCurrentView + '"]');
  if (old)     old.classList.remove('active');
  if (oldLink) oldLink.classList.remove('active');
  _wmcCurrentView = view;
  var el   = document.getElementById('wmc-view-' + view);
  var link = document.querySelector('.wmc-link[data-view="' + view + '"]');
  if (el)   el.classList.add('active');
  if (link) link.classList.add('active');
  var bc = document.getElementById('wmcBreadcrumbCurrent');
  if (bc) bc.textContent = WMC_BREADCRUMBS[view] || view;
  var perm = _WMC_VIEW_PERMS[view];
  if (perm && typeof WMCPermissions !== 'undefined') {
    WMCPermissions.applyRestriction(view, perm);
    if (!WMCPermissions.can(perm)) return;
  }
  if (view === 'analytics')   _wmcRenderAnalytics();
  if (view === 'overview')    wmcRefreshOverview();
  if (view === 'pages')       _wmcRenderPages();
  if (view === 'blog')        _wmcRenderBlog();
  if (view === 'services')    _wmcRenderServices();
  if (view === 'seo')         _wmcRenderSeoSettings();
  if (view === 'deploy')      _wmcRenderDeploy();
  if (view === 'permissions') _wmcRenderPermissions();
}

/* Auth flow */
function _wmcShowLogin() {
  document.getElementById('wmcLogin').style.display = 'flex';
  document.getElementById('wmcApp').style.display   = 'none';
  document.getElementById('wmcLoginErr').style.display = 'none';
  document.getElementById('wmcEmail').value = '';
  document.getElementById('wmcPass').value  = '';
  document.getElementById('wmcEmail').classList.remove('has-error');
  document.getElementById('wmcPass').classList.remove('has-error');
  try {
    var r = JSON.parse(localStorage.getItem('hm_admin_remember') || 'null');
    if (r && r.user && r.exp && Date.now() < r.exp) document.getElementById('wmcEmail').value = r.user;
  } catch (_) {}
}

function _wmcShowApp() {
  document.getElementById('wmcLogin').style.display = 'none';
  document.getElementById('wmcApp').style.display   = 'block';
  var nameEl = document.getElementById('wmcUserName');
  if (nameEl) nameEl.textContent = Auth.getUser().name || 'Admin';
  if (typeof WMCPermissions !== 'undefined') {
    var ri   = WMCPermissions.getRoleInfo();
    var chip = document.getElementById('wmcUserChipRole');
    if (chip) { chip.textContent = ri.label; chip.className = 'wmc-stat-badge ' + ri.badge; chip.style.marginLeft = '6px'; }
  }
}

function wmcLogout() {
  if (typeof AuditLog !== 'undefined') AuditLog.record('logout', 'wmc', '-', 'Website Management ログアウト');
  Auth.logout();
}

/* ════════════════════════════════════════════════════════
   HEALTH BANNER — WMC parity with admin (appBootstrap.js)
   Previously WMC LOADED healthCheck.js but never ran it, so admin showed a
   connectivity banner while WMC showed nothing. This runs the SAME shared
   HealthCheck service (and shares the hm_health_report_v2 cache), and clears
   the banner immediately on recovery via the health:* events run() dispatches.
   Self-injecting — no dependency on a pre-existing element in the WMC HTML.
   ════════════════════════════════════════════════════════ */
function _wmcApplyHealthBanner(report) {
  var existing = document.getElementById('wmcHealthBanner');
  var api = report && Array.isArray(report.checks)
    ? report.checks.find(function (c) { return c.service === 'api'; }) : null;
  /* Healthy / no report → remove any banner so a recovered status clears at once. */
  if (!api || api.status === 'healthy') { if (existing) existing.remove(); return; }

  var isError = api.status === 'error';
  var banner  = existing || document.createElement('div');
  banner.id = 'wmcHealthBanner';
  Object.assign(banner.style, {
    position: 'fixed', top: '0', left: '0', right: '0', zIndex: '9998',
    background: isError ? '#7f1d1d' : '#92400e', color: '#fff',
    font: "13px/1.5 'Noto Sans JP','Inter',system-ui,sans-serif",
    padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,.25)',
  });
  banner.textContent = '';
  var msg = document.createElement('div'); msg.style.flex = '1';
  var title = document.createElement('strong');
  title.textContent = isError ? '設定の確認が必要です' : 'API 接続の警告';
  var detail = document.createElement('div'); detail.style.opacity = '.9';
  /* textContent — never innerHTML — so a server-supplied message can't inject markup. */
  detail.textContent = (api.message || '') + ' — データはローカルキャッシュから読み込まれます。';
  msg.appendChild(title); msg.appendChild(detail);
  var close = document.createElement('button');
  close.textContent = '✕';
  Object.assign(close.style, { background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '16px', lineHeight: '1' });
  close.onclick = function () { banner.remove(); };
  banner.appendChild(msg); banner.appendChild(close);
  if (!existing) document.body.appendChild(banner);
}

/* Wire the live health:* events ONCE at module load so the banner tracks every
   subsequent check (parity with appBootstrap.js:321-328). */
(function () {
  ['health:healthy', 'health:warning', 'health:error'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      try { _wmcApplyHealthBanner(e.detail); } catch (_) {}
    });
  });
}());

/* Dark mode — apply before first paint */
(function () {
  if (localStorage.getItem('hm_dark') === '1') document.documentElement.classList.add('dark');
}());

document.addEventListener('DOMContentLoaded', function () {
  var btn = document.getElementById('wmcDarkToggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var d = document.documentElement.classList.toggle('dark');
    localStorage.setItem('hm_dark', d ? '1' : '0');
    btn.textContent = d ? '☀️' : '🌙';
  });
  btn.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
});

/* Startup IIFE */
(async function () {
  await Auth.initCreds();
  document.querySelectorAll('.wmc-link[data-view]').forEach(function (btn) {
    btn.addEventListener('click', function () { wmcGo(this.dataset.view); });
  });
  var _analyticsRefreshBtn = document.getElementById('wmcAnalyticsRefreshBtn');
  if (_analyticsRefreshBtn) {
    _analyticsRefreshBtn.addEventListener('click', function () { _waTabRendered = {}; _wmcRenderAnalytics(); });
  }
  document.getElementById('wmcLoginBtn').addEventListener('click', async function () {
    var emailEl = document.getElementById('wmcEmail');
    var passEl  = document.getElementById('wmcPass');
    var errEl   = document.getElementById('wmcLoginErr');
    var btn     = document.getElementById('wmcLoginBtn');
    emailEl.classList.remove('has-error'); passEl.classList.remove('has-error');
    errEl.style.display = 'none';
    if (Auth.isLockedOut()) {
      errEl.textContent = 'アカウントがロックされています。' + Auth.lockoutMins() + '分後に再試行してください。';
      errEl.style.display = 'block'; return;
    }
    var u = emailEl.value.trim(); var p = passEl.value;
    if (!u || !p) { if (!u) emailEl.classList.add('has-error'); if (!p) passEl.classList.add('has-error'); return; }
    btn.disabled = true; btn.classList.add('loading');
    btn.querySelector('.login-btn-text').textContent = 'ログイン中…';
    var result = await Auth.login(u, p, false);
    btn.classList.remove('loading'); btn.disabled = false;
    btn.querySelector('.login-btn-text').textContent = 'ログイン';
    if (result.ok) { _wmcShowApp(); await _wmcInit(); }
    else {
      emailEl.classList.add('has-error'); passEl.classList.add('has-error');
      errEl.textContent = result.locked
        ? 'ログイン試行が多すぎます。' + Auth.lockoutMins() + '分後に再試行してください。'
        : 'メールアドレスまたはパスワードが正しくありません。';
      errEl.style.display = 'block';
    }
  });
  document.getElementById('wmcPass').addEventListener('keydown',  function (e) { if (e.key === 'Enter') document.getElementById('wmcLoginBtn').click(); });
  document.getElementById('wmcEmail').addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('wmcPass').focus(); });
  if (Auth.isLoggedIn()) {
    _wmcShowApp(); await _wmcInit();
    /* Validate the restored token server-side (admin-session.php) — catches a
       token revoked elsewhere (disabled account / logout) while the local marker
       still looks valid. Log out only on an explicit invalid; ignore network. */
    Auth.verifySession().then(function (v) {
      if (v && v.valid === false) { Auth._addLog('logout', 'revoked'); Auth.logout(); }
    }).catch(function () {});
  } else { _wmcShowLogin(); }

  /* Run the shared health check after the screen is shown — non-blocking, and
     it dispatches health:* events that keep the banner in sync thereafter. */
  if (window.HealthCheck) {
    window.HealthCheck.run()
      .then(function (r) { _wmcApplyHealthBanner(r); })
      .catch(function (e) { console.warn('[WMC][HealthCheck] startup check failed:', e); });
  }
}());

async function _wmcInit() {
  _wmcPatchAdapterForTimestamp();
  if (typeof Adapter !== 'undefined' && Adapter.apiReady) {
    try { await Adapter.syncFromApi(); } catch (_) {}
  }
  if (typeof AuditLog !== 'undefined' && AuditLog.init) AuditLog.init();
  await wmcRefreshOverview();
  document.addEventListener('click',   function () { Auth.touch(); });
  document.addEventListener('keydown', function () { Auth.touch(); });
}
