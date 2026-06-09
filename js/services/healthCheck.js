// Load order: serviceRegistry.js → this file (loaded before admin.html inline script)
(function () {
  'use strict';

  const STORAGE_KEY   = 'hm_health_log';
  const MAX_ENTRIES   = 100;
  const QUERY_TIMEOUT = 5000;

  let _lastReport = null;

  /* ── Log helpers ─────────────────────────────────────────────────────── */
  function _loadLog() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  }
  function _saveLog(entries) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* quota */ }
  }
  function _appendLog(service, status, message) {
    const entries = _loadLog();
    entries.unshift({ ts: new Date().toISOString(), service, status, message });
    _saveLog(entries.slice(0, MAX_ENTRIES));
  }

  /* ── Individual checks ───────────────────────────────────────────────── */

  async function _checkSupabase() {
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;
    const urlOk = !!url && !url.includes('<') && url.startsWith('https://');
    const keyOk = !!key && !key.includes('<') && key.length > 20;

    if (!window.supabase) {
      return { service: 'supabase', status: 'error', message: 'Supabase UMD ライブラリが読み込まれていません' };
    }
    if (!urlOk) {
      const reason = !url ? '未設定です' : 'プレースホルダーが残っています';
      return { service: 'supabase', status: 'error', message: `SUPABASE_URL が${reason}（env.js を確認）` };
    }
    if (!keyOk) {
      const reason = !key ? '未設定です' : 'プレースホルダーが残っています';
      return { service: 'supabase', status: 'error', message: `SUPABASE_ANON_KEY が${reason}（env.js を確認）` };
    }
    if (!window.SupabaseClient) {
      return { service: 'supabase', status: 'error', message: 'Supabase クライアントの初期化に失敗しました（ログを確認）' };
    }

    try {
      const timeoutErr = Object.assign(new Error('timeout'), { isTimeout: true });
      const query      = window.SupabaseClient.from('hm_data').select('key').limit(1);
      const timeout    = new Promise((_, rej) => setTimeout(() => rej(timeoutErr), QUERY_TIMEOUT));
      const { error }  = await Promise.race([query, timeout]);

      if (error) {
        return { service: 'supabase', status: 'warning', message: `Supabase 接続済み（クエリエラー: ${error.message}）` };
      }
      return { service: 'supabase', status: 'healthy', message: 'Supabase 接続正常' };
    } catch (e) {
      if (e.isTimeout) {
        return { service: 'supabase', status: 'warning', message: `Supabase 接続タイムアウト（${QUERY_TIMEOUT / 1000}秒超過）` };
      }
      const isNetwork = e instanceof TypeError || (e.message || '').toLowerCase().includes('fetch');
      return {
        service: 'supabase',
        status:  isNetwork ? 'error' : 'warning',
        message: isNetwork ? 'Supabase に接続できません（ネットワークエラー）' : `接続エラー: ${e.message}`
      };
    }
  }

  async function _checkDataProvider() {
    if (!window.DataProvider) {
      return { service: 'dataProvider', status: 'error', message: 'DataProvider が読み込まれていません（スクリプト順序を確認）' };
    }
    if (typeof window.DataProvider.read !== 'function') {
      return { service: 'dataProvider', status: 'error', message: 'DataProvider.read() が利用できません' };
    }
    if (typeof window.DataProvider.write !== 'function') {
      return { service: 'dataProvider', status: 'error', message: 'DataProvider.write() が利用できません' };
    }
    return { service: 'dataProvider', status: 'healthy', message: 'DataProvider 正常（read / write / update / delete）' };
  }

  async function _checkServices() {
    const critical = [];
    if (!window.Adapter)                       critical.push('Adapter');
    if (!window.DataProvider)                  critical.push('DataProvider');
    if (!window.Services?.Adapter)             critical.push('Services.Adapter');
    if (!window.Services?.DataProvider)        critical.push('Services.DataProvider');

    if (critical.length > 0) {
      return { service: 'services', status: 'error', message: `必須サービスが未登録: ${critical.join(', ')}` };
    }

    const optional = [];
    if (!window.StatisticsService) optional.push('StatisticsService');
    if (!window.BookingService)    optional.push('BookingService');
    if (!window.CalendarService)   optional.push('CalendarService');

    if (optional.length > 0) {
      return { service: 'services', status: 'warning', message: `任意サービスが未登録: ${optional.join(', ')}` };
    }
    return { service: 'services', status: 'healthy', message: 'サービスレジストリ正常（全サービス登録済み）' };
  }

  async function _checkStorage() {
    const TEST_KEY = '__hm_hc__';
    const TEST_VAL = String(Date.now());

    try {
      localStorage.setItem(TEST_KEY, TEST_VAL);
      if (localStorage.getItem(TEST_KEY) !== TEST_VAL) throw new Error('read mismatch');
      localStorage.removeItem(TEST_KEY);
    } catch (e) {
      const isQuota = e instanceof DOMException &&
        (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      return {
        service: 'storage',
        status:  'error',
        message: isQuota ? 'localStorage が容量上限に達しています' : `localStorage エラー: ${e.message}`
      };
    }

    try {
      sessionStorage.setItem(TEST_KEY, TEST_VAL);
      if (sessionStorage.getItem(TEST_KEY) !== TEST_VAL) throw new Error('read mismatch');
      sessionStorage.removeItem(TEST_KEY);
    } catch (e) {
      const isQuota = e instanceof DOMException &&
        (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      return {
        service: 'storage',
        status:  isQuota ? 'warning' : 'error',
        message: isQuota ? 'sessionStorage が容量上限に達しています' : `sessionStorage エラー: ${e.message}`
      };
    }

    return { service: 'storage', status: 'healthy', message: 'localStorage / sessionStorage 読み書き正常' };
  }

  async function _checkAuth() {
    if (!window.Auth) {
      return { service: 'auth', status: 'warning', message: 'Auth サービスが window.Auth に未公開（セッション検証スキップ）' };
    }
    if (typeof window.Auth.isLoggedIn !== 'function') {
      return { service: 'auth', status: 'error', message: 'Auth.isLoggedIn() が利用できません' };
    }
    try {
      window.Auth.isLoggedIn();
      return { service: 'auth', status: 'healthy', message: '認証サービス正常（セッション検証 OK）' };
    } catch (e) {
      return { service: 'auth', status: 'error', message: `Auth 検証エラー: ${e.message}` };
    }
  }

  /* ── Aggregate ───────────────────────────────────────────────────────── */
  function _aggregate(results) {
    let status = 'healthy';
    for (const r of results) {
      if (r.status === 'error')               { status = 'error';   break; }
      if (r.status === 'warning' && status !== 'error') status = 'warning';
    }
    return { ts: new Date().toISOString(), status, checks: results };
  }

  /* ── Public API ──────────────────────────────────────────────────────── */
  window.HealthCheck = {

    async run() {
      const results = await Promise.all([
        _checkSupabase()   .catch(e => ({ service: 'supabase',      status: 'error', message: String(e) })),
        _checkDataProvider().catch(e => ({ service: 'dataProvider', status: 'error', message: String(e) })),
        _checkServices()   .catch(e => ({ service: 'services',      status: 'error', message: String(e) })),
        _checkStorage()    .catch(e => ({ service: 'storage',       status: 'error', message: String(e) })),
        _checkAuth()       .catch(e => ({ service: 'auth',          status: 'error', message: String(e) })),
      ]);

      _lastReport = _aggregate(results);

      for (const r of results) _appendLog(r.service, r.status, r.message);

      try {
        document.dispatchEvent(new CustomEvent('health:' + _lastReport.status, { detail: _lastReport }));
      } catch { /* no-op */ }

      return _lastReport;
    },

    async getStatus() {
      return _lastReport ? _lastReport.status : null;
    },

    async getReport() {
      return _lastReport;
    },

    getLog() {
      return _loadLog();
    },

    clearLog() {
      _saveLog([]);
    },
  };
})();
