// @ts-check
// ════════════════════════════════════════════════════════════════════════════
//  admin-auth.spec.js — Playwright validation for MySQL-backed admin auth.
//
//  PHP/MySQL are not installed locally, so this spec is written to run against a
//  DEPLOYED environment (staging first, then production-like) — the validation
//  contract agreed for this change:
//      1. static validation (node --check / npm run test:all)  ← pre-deploy
//      2. deploy to a staging/feature branch
//      3. run THIS spec against the deployed URL                ← post-deploy
//
//  USAGE:
//      ADMIN_URL=https://staging.hello-moving.com/admin.html \
//      ADMIN_EMAIL=admin@hello-moving.com \
//      ADMIN_PASSWORD='...' \
//      npx playwright test tests/admin-auth.spec.js
//
//  The spec is SAFE: it only logs in, opens the Security page, and logs out. It
//  never creates/deletes accounts (to avoid mutating a shared environment). The
//  account-management actions are listed in ADMIN_AUTH_MIGRATION.md as a manual
//  post-deploy checklist.
// ════════════════════════════════════════════════════════════════════════════
const { test, expect } = require('playwright/test');

const URL   = process.env.ADMIN_URL || '';
const EMAIL = process.env.ADMIN_EMAIL || '';
const PASS  = process.env.ADMIN_PASSWORD || '';

test.describe('admin authentication (deployed)', () => {
  test.skip(!URL || !EMAIL || !PASS,
    'Set ADMIN_URL / ADMIN_EMAIL / ADMIN_PASSWORD to run against a deployed environment.');

  test.beforeEach(async ({ page }) => {
    await page.goto(URL, { waitUntil: 'networkidle' });
  });

  test('rejects an invalid password', async ({ page }) => {
    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPass', 'definitely-wrong-password');
    await page.click('#loginBtn');
    // Login screen stays; an error is shown; the app does not appear.
    await expect(page.locator('#loginErr')).toBeVisible();
    await expect(page.locator('#adminApp')).toBeHidden();
  });

  test('logs in with valid credentials and mints an admin token', async ({ page }) => {
    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPass', PASS);

    const loginResp = page.waitForResponse(r => r.url().includes('/admin-login.php') && r.request().method() === 'POST');
    await page.click('#loginBtn');
    const resp = await loginResp;
    const body = await resp.json();
    expect(body.ok).toBeTruthy();
    expect(body.data && body.data.token).toBeTruthy();

    // The dashboard becomes visible (unless a forced password change is pending).
    await expect(page.locator('#adminApp, #forceChangeScreen')).toBeVisible();

    // The HMAC token is held in sessionStorage (not localStorage credentials).
    const token = await page.evaluate(() => sessionStorage.getItem('hm_admin_token'));
    expect(token).toBeTruthy();

    // No legacy credential blob should exist in localStorage anymore.
    const legacy = await page.evaluate(() => localStorage.getItem('hm_admin_creds'));
    expect(legacy).toBeNull();
  });

  test('logout destroys the session and returns to the login screen', async ({ page }) => {
    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPass', PASS);
    await page.click('#loginBtn');
    await expect(page.locator('#adminApp, #forceChangeScreen')).toBeVisible();

    await page.evaluate(() => window.logout && window.logout());
    await expect(page.locator('#loginScreen')).toBeVisible();
    const token = await page.evaluate(() => sessionStorage.getItem('hm_admin_token'));
    expect(token).toBeNull();
  });
});
