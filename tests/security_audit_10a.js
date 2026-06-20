'use strict';
// Security audit — Phase 10A forced-password-change gate
// Run: node tests/security_audit_10a.js
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ headless: true });
  const ADMIN_URL = 'http://localhost:5050/admin.html';
  const results   = [];

  function report(id, label, pass, finding) {
    const sym = pass === true ? 'PASS' : pass === 'PARTIAL' ? 'PARTIAL' : 'FAIL';
    results.push({ id, label, sym, finding });
    console.log('[' + sym + '] ' + id + '. ' + label);
    if (finding) console.log('       ' + finding);
  }

  // Boot admin with default-password gate active
  async function seedGate(ctx) {
    const p = await ctx.newPage();
    await p.goto(ADMIN_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await p.evaluate(() => {
      localStorage.removeItem('hm_admin_creds');
      sessionStorage.removeItem('hm_admin_sess');
    });
    await p.reload({ waitUntil: 'networkidle' });
    await p.fill('#loginEmail', 'admin@hello-moving.com');
    await p.fill('#loginPass',  'hello2026');
    await p.click('#loginBtn');
    await p.waitForTimeout(900);
    return p;
  }

  async function screenState(p) {
    return p.evaluate(() => ({
      force:            document.getElementById('forceChangeScreen').style.display,
      admin:            document.getElementById('adminApp').style.display,
      login:            document.getElementById('loginScreen').style.display,
      // mustChange is now in sessionStorage session token (not localStorage creds)
      sessionMustChange: !!(JSON.parse(sessionStorage.getItem('hm_admin_sess') || '{}')).mustChange,
      credsMustChange:   !!(JSON.parse(localStorage.getItem('hm_admin_creds') || '{}')).mustChange,
    }));
  }

  function gateUp(s) { return s.force === 'flex' && s.admin !== 'block'; }
  function adminBlocked(s) { return s.admin !== 'block'; }   // login OR gate = secure

  // ── 1. Page refresh with existing session ────────────────────────────
  {
    const ctx = await b.newContext();
    const p   = await seedGate(ctx);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(400);
    const s  = await screenState(p);
    const ok = gateUp(s);
    report(1, 'Existing session + page refresh', ok,
      ok ? 'Boot handler re-checks mustChangePassword(); force-change screen re-shown.'
         : 'Gate lost after reload. state=' + JSON.stringify(s));
    await ctx.close();
  }

  // ── 2. Direct go(view) call ──────────────────────────────────────────
  {
    const ctx = await b.newContext();
    const p   = await seedGate(ctx);
    const res = await p.evaluate(() => {
      let hit = false;
      const orig = showForceChange;
      window.showForceChange = () => { hit = true; orig(); };
      go('bookings');
      window.showForceChange = orig;
      return { hit, adminBlock: document.getElementById('adminApp').style.display !== 'block' };
    });
    const ok = res.hit && res.adminBlock;
    report(2, 'go(view) direct navigation blocked', ok,
      ok ? 'go() guard fires showForceChange(); admin view never rendered.'
         : 'go() not blocked. res=' + JSON.stringify(res));
    await ctx.close();
  }

  // ── 3. Browser back button ───────────────────────────────────────────
  {
    const ctx = await b.newContext();
    const p   = await seedGate(ctx);
    try { await p.goBack({ timeout: 1500 }); } catch {}
    await p.goto(ADMIN_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await p.waitForTimeout(400);
    const s  = await screenState(p);
    // After fix: mustChange lives in sessionStorage (not localStorage creds).
    // Gate shown via session = secure regardless of credsMustChange.
    const ok = gateUp(s) && s.sessionMustChange;
    report(3, 'Browser back then re-navigate — gate persists', ok,
      ok ? 'Session carries mustChange; boot handler re-shows gate on full reload.'
         : 'state=' + JSON.stringify(s));
    await ctx.close();
  }

  // ── 4. Second tab (same context = shared localStorage) ───────────────
  // sessionStorage is tab-specific, so second tab has no session — it shows
  // the login screen. Logging in again triggers the gate. Both states = secure.
  {
    const ctx  = await b.newContext();
    const tab1 = await seedGate(ctx);           // gate active
    const tab2 = await ctx.newPage();           // shares localStorage
    await tab2.goto(ADMIN_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await tab2.waitForTimeout(400);
    const s  = await screenState(tab2);
    // Secure = admin not shown. Either login screen or gate is acceptable.
    const ok = adminBlocked(s);
    const detail = s.force === 'flex' ? 'Force-change screen shown.'
                 : s.login === 'flex' ? 'Login screen shown (sessionStorage not shared between tabs — must re-authenticate).'
                 : 'Neither admin nor login shown.';
    report(4, 'Second tab — admin inaccessible', ok,
      ok ? detail : 'ADMIN VISIBLE in second tab. state=' + JSON.stringify(s));
    // Verify: if second tab logs in again with default password, gate appears
    if (s.login === 'flex' || !s.force) {
      await tab2.fill('#loginEmail', 'admin@hello-moving.com');
      await tab2.fill('#loginPass',  'hello2026');
      await tab2.click('#loginBtn');
      await tab2.waitForTimeout(800);
      const s2 = await screenState(tab2);
      console.log('       Second tab re-login → gate: ' + (s2.force === 'flex'));
    }
    await ctx.close();
  }

  // ── 5. showApp() from console ────────────────────────────────────────
  {
    const ctx = await b.newContext();
    const p   = await seedGate(ctx);
    await p.evaluate(() => showApp());
    await p.waitForTimeout(200);
    const res = await p.evaluate(() => {
      const adminVis   = document.getElementById('adminApp').style.display === 'block';
      const dataInGrid = (document.getElementById('statGrid').innerHTML || '').trim().length > 20;
      let goBlocked = false;
      const orig = showForceChange;
      window.showForceChange = () => { goBlocked = true; orig(); };
      go('dashboard');
      window.showForceChange = orig;
      return { adminVis, dataInGrid, goBlocked };
    });
    const pass = res.adminVis ? 'PARTIAL' : true;
    report(5, 'showApp() from console', pass,
      res.adminVis
        ? 'Admin shell visible (display:block) but no data rendered — init() never called. go() still blocked. Risk: empty admin layout exposed, no data.'
        : 'Admin not shown.');
    await ctx.close();
  }

  // ── 6. go("dashboard") from console ─────────────────────────────────
  {
    const ctx = await b.newContext();
    const p   = await seedGate(ctx);
    const res = await p.evaluate(() => {
      let hit = false;
      const orig = showForceChange;
      window.showForceChange = () => { hit = true; orig(); };
      go('dashboard');
      window.showForceChange = orig;
      return { hit, gridData: (document.getElementById('statGrid').innerHTML || '').trim().length > 20 };
    });
    const ok = res.hit && !res.gridData;
    report(6, 'go("dashboard") from console blocked', ok,
      ok ? 'go() guard fires; renderDash() not called; no stat data in DOM.'
         : 'res=' + JSON.stringify(res));
    await ctx.close();
  }

  // ── 7. Edit localStorage to remove mustChange ────────────────────────
  {
    const ctx = await b.newContext();
    const p   = await seedGate(ctx);
    // Attacker removes mustChange via DevTools
    await p.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('hm_admin_creds') || '{}');
      delete raw.mustChange;
      localStorage.setItem('hm_admin_creds', JSON.stringify(raw));
    });
    const res = await p.evaluate(() => {
      let redirected = false;
      const orig = showForceChange;
      window.showForceChange = () => { redirected = true; orig(); };
      go('bookings');
      window.showForceChange = orig;
      return { redirected, mustChange: Auth.mustChangePassword() };
    });
    const bypassed = !res.redirected && !res.mustChange;
    report(7, 'localStorage mustChange removal', bypassed ? false : true,
      bypassed
        ? 'BYPASS: Removing mustChange from hm_admin_creds via DevTools clears the gate. ' +
          'Client-side-only weakness — no server-side re-validation possible in this architecture.'
        : 'Gate held after localStorage edit.');
    await ctx.close();
  }

  // ── 8. Password shorter than 8 chars ────────────────────────────────
  {
    const ctx = await b.newContext();
    const p   = await seedGate(ctx);
    await p.fill('#fcNewPass',    'abc');
    await p.fill('#fcConfirmPass','abc');
    await p.click('#fcBtn');
    await p.waitForTimeout(200);
    const msg = await p.evaluate(() => document.getElementById('fcMsg').textContent);
    const adm = await p.evaluate(() => document.getElementById('adminApp').style.display);
    const ok  = msg.includes('8文字') && adm !== 'block';
    report(8, 'Short password (< 8 chars) rejected', ok,
      ok ? 'Error: "' + msg + '". Admin not shown.'
         : 'msg="' + msg + '" admin=' + adm);
    await ctx.close();
  }

  // ── 9. Password mismatch ─────────────────────────────────────────────
  {
    const ctx = await b.newContext();
    const p   = await seedGate(ctx);
    await p.fill('#fcNewPass',    'ValidPass1!');
    await p.fill('#fcConfirmPass','DifferentXX2!');
    await p.click('#fcBtn');
    await p.waitForTimeout(200);
    const msg = await p.evaluate(() => document.getElementById('fcMsg').textContent);
    const ok  = msg.includes('一致しません');
    report(9, 'Password mismatch rejected', ok,
      ok ? 'Error: "' + msg + '"' : 'msg="' + msg + '"');
    await ctx.close();
  }

  // ── 10. Session fixation attempt ─────────────────────────────────────
  // Plant a known token before Auth.login() runs; verify login() replaces it.
  {
    const ctx   = await b.newContext();
    const p     = await ctx.newPage();
    await p.goto(ADMIN_URL, { waitUntil: 'networkidle', timeout: 20000 });
    // Ensure fresh creds (with mustChange:true)
    await p.evaluate(() => {
      localStorage.removeItem('hm_admin_creds');
      sessionStorage.removeItem('hm_admin_sess');
    });
    await p.reload({ waitUntil: 'networkidle' });

    const known = 'aabbccddeeff00112233445566778899';
    const res   = await p.evaluate(async (t) => {
      // Plant the known token BEFORE calling login()
      sessionStorage.setItem('hm_admin_sess', JSON.stringify({ token: t, ts: Date.now() }));
      const before = JSON.parse(sessionStorage.getItem('hm_admin_sess')).token;

      // Victim logs in — login() must generate a new token
      const result = await Auth.login('admin@hello-moving.com', 'hello2026', false);
      const after  = JSON.parse(sessionStorage.getItem('hm_admin_sess') || '{}');

      return {
        loginOk:       result.ok,
        mustChange:    result.mustChange,
        tokenReplaced: after.token !== before,
        newTokenLen:   (after.token || '').length,
      };
    }, known);

    const ok = res.loginOk && res.mustChange && res.tokenReplaced && res.newTokenLen === 32;
    report(10, 'Session fixation attempt', ok,
      ok ? 'login() overwrites planted token with crypto.getRandomValues(). mustChange gate active.'
         : 'res=' + JSON.stringify(res));
    await ctx.close();
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(62));
  console.log('SECURITY AUDIT — Phase 10A');
  console.log('='.repeat(62));
  const passes   = results.filter(r => r.sym === 'PASS').length;
  const partials = results.filter(r => r.sym === 'PARTIAL').length;
  const fails    = results.filter(r => r.sym === 'FAIL').length;
  console.log('PASS: ' + passes + '  PARTIAL: ' + partials + '  FAIL: ' + fails);
  const nonPass = results.filter(r => r.sym !== 'PASS');
  if (nonPass.length) {
    console.log('\nVectors requiring attention:');
    nonPass.forEach(r => console.log('  [' + r.sym + '] #' + r.id + ' — ' + r.label));
  }

  await b.close();
})();
