'use strict';
/**
 * End-to-end smoke test — Phase 9 (go-live validation)
 *
 * Boots admin.html, logs in, navigates every admin page, and asserts
 * no JS errors occur. Also verifies all infrastructure globals are
 * correctly wired and DataProvider is functioning.
 *
 * Requires the dev server running on localhost:5050 (node serve.js).
 * Run: npm run test:smoke
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// All navigable admin views (must mirror the #view-<id> elements in admin.html)
const VIEWS = [
  'dashboard', 'bookings',  'calendar',  'quotes',     'customers',
  'analytics', 'capacity',  'pricing',   'disposal',   'inbox',
  'email',     'line',      'crm',       'automation', 'actions',
  'staff',     'camera',    'health',    'changelog',  'security',
];

let browser, page;
const jsErrors = [];  // accumulated across the entire run

// ── Setup ────────────────────────────────────────────────────────────────
before(async () => {
  browser = await chromium.launch({ headless: true });
  page    = await browser.newPage();

  // Capture every JS error and console.error for later assertion
  page.on('pageerror', e => jsErrors.push({ phase: 'load', msg: e.message }));
  page.on('console',  m => {
    if (m.type() === 'error') jsErrors.push({ phase: 'load', msg: m.text() });
  });

  await page.goto('http://localhost:5050/admin.html', {
    waitUntil: 'networkidle',
    timeout:   20000,
  });
});

after(async () => { await browser.close(); });

// ═══════════════════════════════════════════════════════════════════════════
// Infrastructure globals
// ═══════════════════════════════════════════════════════════════════════════
describe('Globals', () => {

  it('all infrastructure globals are present and typed correctly', async () => {
    const g = await page.evaluate(() => ({
      HM_CONFIG:      typeof window.HM_CONFIG      === 'object',
      FallbackLogger: typeof window.FallbackLogger === 'object',
      DataProvider:   typeof window.DataProvider   === 'object',
      Services:       typeof window.Services       === 'object',
      Adapter:        typeof window.Adapter        === 'object',
      SupabaseClient: window.SupabaseClient !== null,
    }));
    for (const [k, v] of Object.entries(g)) {
      assert.ok(v, `window.${k} should be present`);
    }
  });

  it('Services registry contains Adapter and DataProvider', async () => {
    const s = await page.evaluate(() => ({
      hasAdapter:      typeof window.Services?.Adapter      === 'object',
      hasDataProvider: typeof window.Services?.DataProvider === 'object',
    }));
    assert.ok(s.hasAdapter,      'Services.Adapter should be registered');
    assert.ok(s.hasDataProvider, 'Services.DataProvider should be registered');
  });

  it('HM_CONFIG has all required keys', async () => {
    const keys = await page.evaluate(() => Object.keys(window.HM_CONFIG));
    for (const k of ['FORCE_FALLBACK', 'LOG_FALLBACK', 'CACHE_TTL', 'RETRY']) {
      assert.ok(keys.includes(k), `HM_CONFIG.${k} should exist`);
    }
  });

  it('DataProvider exposes all required methods', async () => {
    const results = await page.evaluate(() =>
      ['read','write','update','delete','invalidate',
       'clearAllCache','cacheStatus','getMetrics','resetMetrics']
        .map(m => ({ m, ok: typeof window.DataProvider[m] === 'function' }))
    );
    for (const { m, ok } of results) {
      assert.ok(ok, `DataProvider.${m} should be a function`);
    }
  });

  it('FallbackLogger exposes log / getAll / clear', async () => {
    const results = await page.evaluate(() =>
      ['log', 'getAll', 'clear']
        .map(m => ({ m, ok: typeof window.FallbackLogger[m] === 'function' }))
    );
    for (const { m, ok } of results) {
      assert.ok(ok, `FallbackLogger.${m} should be a function`);
    }
  });

  it('no JS errors during page load', () => {
    const loadErrors = jsErrors.filter(e => e.phase === 'load');
    assert.equal(loadErrors.length, 0,
      `JS errors during load:\n${loadErrors.map(e => '  ' + e.msg).join('\n')}`
    );
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// Login
// ═══════════════════════════════════════════════════════════════════════════
describe('Login', () => {

  it('login screen is shown before authentication', async () => {
    const visible = await page.evaluate(() => {
      const el = document.getElementById('loginScreen');
      return !!el && el.style.display !== 'none';
    });
    assert.ok(visible, 'login screen should be visible before login');
  });

  it('login with default password shows force-change screen', async () => {
    await page.fill('#loginEmail', 'admin@hello-moving.com');
    await page.fill('#loginPass',  'hello2026');
    await page.click('#loginBtn');

    // Phase 10A: default password triggers the mandatory change gate
    await page.waitForFunction(
      () => document.getElementById('forceChangeScreen')?.style.display === 'flex',
      { timeout: 10000 }
    );
    const forceVisible = await page.evaluate(
      () => document.getElementById('forceChangeScreen')?.style.display === 'flex'
    );
    assert.ok(forceVisible, 'force-change screen should appear when using default password');
  });

  it('completing force-change shows admin panel', async () => {
    // Force-change screen is already visible from the previous test
    await page.fill('#fcNewPass',    'SmokeTest99!');
    await page.fill('#fcConfirmPass','SmokeTest99!');
    await page.click('#fcBtn');

    // Wait for init() to complete after forced password change
    await page.waitForFunction(
      () => document.getElementById('adminApp')?.style.display === 'block',
      { timeout: 15000 }
    );
    const appVisible = await page.evaluate(
      () => document.getElementById('adminApp')?.style.display === 'block'
    );
    assert.ok(appVisible, 'admin panel should be visible after completing force-change');
  });

  it('session token is stored in sessionStorage with correct format', async () => {
    const ok = await page.evaluate(() => {
      try {
        const s = JSON.parse(sessionStorage.getItem('hm_admin_sess') || 'null');
        return typeof s?.token === 'string' && s.token.length === 32 &&
               typeof s?.ts    === 'number'  && s.ts > 0;
      } catch { return false; }
    });
    assert.ok(ok, 'session token should be a 32-char hex string with a timestamp');
  });

  it('no JS errors during login', () => {
    const loginErrors = jsErrors.filter(e => e.phase === 'login');
    assert.equal(loginErrors.length, 0,
      `JS errors during login:\n${loginErrors.map(e => '  ' + e.msg).join('\n')}`
    );
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// Page navigation — one test per view
// ═══════════════════════════════════════════════════════════════════════════
describe('Page navigation', () => {

  // Update error phase tag after login
  before(async () => {
    page.removeAllListeners('pageerror');
    page.removeAllListeners('console');
    page.on('pageerror', e => jsErrors.push({ phase: 'nav', view: '?', msg: e.message }));
    page.on('console',   m => {
      if (m.type() === 'error') jsErrors.push({ phase: 'nav', view: '?', msg: m.text() });
    });
  });

  for (const view of VIEWS) {
    it(`navigates to '${view}' without JS errors`, async () => {
      const errsBefore = jsErrors.length;

      await page.evaluate(v => go(v), view);

      // Wait for the view to become active
      await page.waitForFunction(
        v => document.getElementById('view-' + v)?.classList.contains('active'),
        view,
        { timeout: 5000 }
      );

      // Allow async renders (DataProvider syncs, UI updates) to settle
      await page.waitForTimeout(400);

      const isActive = await page.evaluate(
        v => document.getElementById('view-' + v)?.classList.contains('active'),
        view
      );

      const newErrors = jsErrors.slice(errsBefore);

      assert.ok(isActive,
        `view-${view} should have class 'active'`);
      assert.equal(newErrors.length, 0,
        `JS errors on '${view}':\n${newErrors.map(e => '  ' + e.msg).join('\n')}`);
    });
  }

});

// ═══════════════════════════════════════════════════════════════════════════
// DataProvider integration (post-navigation)
// ═══════════════════════════════════════════════════════════════════════════
describe('DataProvider integration', () => {

  it('read() returns {data, source, error} shape', async () => {
    const r = await page.evaluate(async () => {
      const res = await window.DataProvider.read('bookings');
      return {
        hasSource: 'source' in res,
        hasData:   'data'   in res,
        hasError:  'error'  in res,
        isArray:   Array.isArray(res.data),
      };
    });
    assert.ok(r.hasSource, 'result should have source');
    assert.ok(r.hasData,   'result should have data');
    assert.ok(r.hasError,  'result should have error');
    assert.ok(r.isArray,   'data should be an array');
  });

  it('metrics.reads is positive after navigation', async () => {
    const m = await page.evaluate(() => window.DataProvider.getMetrics());
    assert.ok(m.reads > 0, `reads should be > 0; got ${m.reads}`);
  });

  it('cacheStatus() has entries for at least two tables after navigation', async () => {
    const cs = await page.evaluate(() => window.DataProvider.cacheStatus());
    assert.ok(cs.length >= 2, `expected ≥2 cached tables; got ${cs.length}`);
    for (const entry of cs) {
      assert.ok(typeof entry.table === 'string', 'each entry needs a table name');
      assert.ok(typeof entry.valid === 'boolean','each entry needs a valid flag');
    }
  });

  it('no Supabase fallback failures logged during the smoke run', async () => {
    const entries  = await page.evaluate(() => window.FallbackLogger.getAll());
    const failures = entries.filter(e => !e.success);
    assert.equal(failures.length, 0,
      `Unexpected fallback failures (${failures.length}):\n` +
      failures.slice(0, 5).map(f =>
        `  [${f.operation}] ${f.table}: ${f.error}`
      ).join('\n')
    );
  });

  it('no JS errors during the entire smoke run', () => {
    assert.equal(jsErrors.length, 0,
      `Total JS errors across smoke run (${jsErrors.length}):\n` +
      jsErrors.slice(0, 10).map(e => `  [${e.phase}] ${e.msg}`).join('\n')
    );
  });

});
