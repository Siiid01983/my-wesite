'use strict';
/* ══════════════════════════════════════════════════════
   WMC Admin Dashboard — Supabase connection + site status (Phase 28)
   Entry points: wmcRefreshOverview(), _wmcPatchAdapterForTimestamp()
   Depends on: wmcCore.js (_padZ), js/management/content.js
   ══════════════════════════════════════════════════════ */

/* ── Site status ── */
async function _wmcCheckSiteStatus() {
  var banner = document.getElementById('wmcStatusBanner');
  var text   = document.getElementById('wmcStatusText');
  var detail = document.getElementById('wmcStatusDetail');
  var time   = document.getElementById('wmcStatusTime');
  if (!banner) return;

  var now = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  var sbOk = false;
  var hcPassed = false;
  if (window.HealthCheck) {
    try {
      var report = await HealthCheck.run();
      var c = report.checks.find(function (x) { return x.service === 'supabase'; });
      hcPassed = !c || c.status === 'healthy';
      sbOk = hcPassed;
    } catch (_) {}
  } else {
    hcPassed = !!window.SupabaseClient;
    sbOk = hcPassed;
  }

  var siteOk = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase) && hcPassed;

  banner.className = 'wmc-status-banner ' + (siteOk ? 'online' : 'offline');
  if (text)   text.textContent   = siteOk ? 'サイトはオンラインです' : 'サイトに接続できません';
  if (detail) detail.textContent = sbOk
    ? 'Supabase バックエンド: 正常 · すべてのサービスが稼働中'
    : 'Supabase に接続できません — ローカルキャッシュで動作中';
  if (time)   time.textContent = '確認時刻: ' + now;
  if (siteOk && !localStorage.getItem('hm_last_deploy')) {
    localStorage.setItem('hm_last_deploy', new Date().toISOString());
  }
}

/* ── Write test + diagnostics ── */
function _wmcInjectDiagPanel() {
  if (document.getElementById('wmcDiagPanel')) return;
  var banner = document.getElementById('wmcStatusBanner');
  if (!banner) return;

  var adapterReady = typeof Adapter !== 'undefined' && !!Adapter.supabaseReady;
  var clientReady  = !!window.SupabaseClient;

  var panel = document.createElement('div');
  panel.id = 'wmcDiagPanel';
  panel.style.cssText = 'margin-top:10px;padding:8px 10px;background:rgba(0,0,0,.04);border-radius:6px;font-size:11px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;';
  panel.innerHTML =
    '<span>Adapter.supabaseReady: <strong style="color:' + (adapterReady ? '#10b981' : '#ef4444') + '">' + adapterReady + '</strong></span>' +
    '<span>SupabaseClient: <strong style="color:' + (clientReady ? '#10b981' : '#ef4444') + '">' + (clientReady ? 'OK' : 'null') + '</strong></span>' +
    '<button id="wmcWriteTestBtn" style="padding:3px 10px;border:1px solid #2563eb;border-radius:4px;background:#fff;color:#2563eb;cursor:pointer;font-size:11px;">Write Test Record</button>' +
    '<span id="wmcWriteTestResult"></span>';
  banner.appendChild(panel);

  document.getElementById('wmcWriteTestBtn').addEventListener('click', _wmcRunWriteTest);
}

async function _wmcRunWriteTest() {
  var btn = document.getElementById('wmcWriteTestBtn');
  var out = document.getElementById('wmcWriteTestResult');
  if (btn) btn.disabled = true;
  if (out) out.textContent = '書き込み中…';

  var payload = { key: 'test_connection', value: { timestamp: Date.now() }, updated_at: new Date().toISOString() };
  console.log('[SAVE] write test payload:', payload);

  if (!window.SupabaseClient) {
    var msg = 'SupabaseClient is null — writes cannot reach Supabase. Verify env.js has window.ENV={ready:true} and valid credentials.';
    console.error('[SUPABASE ERROR]', msg);
    if (out) out.innerHTML = '<span style="color:#ef4444">' + msg + '</span>';
    if (btn) btn.disabled = false;
    return;
  }

  try {
    var r = await window.SupabaseClient
      .from('hm_data')
      .upsert(payload, { onConflict: 'key' });

    if (r.error) {
      console.error('[SUPABASE ERROR] write test failed:', r.error.message, r.error);
      if (out) out.innerHTML = '<span style="color:#ef4444">Error: ' + r.error.message + '</span>';
    } else {
      console.log('[SUPABASE RESPONSE] write test succeeded:', r.data);
      if (out) out.innerHTML = '<span style="color:#10b981">✓ Supabase write OK — check: select count(*) from hm_data;</span>';
      if (typeof toast !== 'undefined') toast('テスト書き込み成功 — Supabase confirmed');
    }
  } catch (e) {
    console.error('[SUPABASE ERROR] write test exception:', e.message, e);
    if (out) out.innerHTML = '<span style="color:#ef4444">Exception: ' + e.message + '</span>';
  }

  if (btn) btn.disabled = false;
}

/* ── Adapter timestamp patch ── */
function _wmcPatchAdapterForTimestamp() {
  if (typeof Adapter === 'undefined') return;
  ['saveHero', 'saveFaq', 'saveFooter', 'saveCompany', 'saveCompanyMeta', 'savePrices'].forEach(function (m) {
    var orig = Adapter[m];
    if (typeof orig !== 'function') return;
    Adapter[m] = function () {
      localStorage.setItem('hm_last_content_update', new Date().toISOString());
      return orig.apply(Adapter, arguments);
    };
  });
}

/* ── Main refresh ── */
async function wmcRefreshOverview() {
  var tsEl = document.getElementById('wmcOverviewTs');
  if (tsEl) tsEl.textContent = '更新中…';

  _wmcRenderOverviewGrid(_wmcBuildCards());
  _wmcRenderSeoPanel(_wmcCalcSeo());
  _wmcRenderHealthCards();
  _wmcUpdateBadges();

  await _wmcCheckSiteStatus();

  /* Update site-status stat card after live check */
  var banner     = document.getElementById('wmcStatusBanner');
  var statusCard = document.getElementById('wmcCardStatus');
  if (statusCard && banner) {
    var online = banner.classList.contains('online');
    var valEl  = statusCard.querySelector('.wmc-stat-value');
    var badEl  = statusCard.querySelector('.wmc-stat-badge');
    if (valEl) valEl.textContent = online ? 'オンライン' : 'オフライン';
    if (badEl) { badEl.className = 'wmc-stat-badge ' + (online ? 'green' : 'red'); badEl.textContent = online ? '正常稼働中' : '接続エラー'; }
  }

  if (tsEl) {
    var n = new Date();
    tsEl.textContent = '最終更新: ' + n.getHours() + ':' + _padZ(n.getMinutes()) + ':' + _padZ(n.getSeconds());
  }
  _wmcInjectDiagPanel();
  if (typeof AuditLog !== 'undefined') AuditLog.record('other', 'wmc', 'overview', 'WMC 概要ページを表示');
}
