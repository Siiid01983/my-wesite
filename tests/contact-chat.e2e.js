'use strict';
/**
 * Contact Chat — headless regression (js/contact-chat.js + hm-api/contact-chat.php).
 *
 * TWO deterministic layers, no live PHP / MySQL / network / production data:
 *
 *  A. CLIENT (browser, Playwright setContent harness — same pattern as
 *     tests/inbox-thread-view.verify.js). The real js/contact-chat.js is injected
 *     into a minimal page whose window.fetch is STUBBED with an in-page mock that
 *     faithfully emulates the contact-chat.php contract (email-verified resume,
 *     identical generic failure for unknown-id vs wrong-email, 429 rate limiting).
 *     Booking globals are installed as sentinels to prove separation. Drives:
 *       open → new → submit → short Contact ID → chat opens → send →
 *       resume(correct) → resume(wrong email) → resume(unknown id) → rate limit.
 *
 *  B. SERVER SOURCE CONTRACT (static assertions on hm-api/contact-chat.php). The
 *     PHP endpoint can't run here (no DB), so we assert the SECURITY-critical
 *     invariants directly from source so they can't silently regress:
 *       ID alphabet excludes O/0/I/1/S/5 · email is a required second factor ·
 *       unknown-id and wrong-email return the SAME generic 'invalid' · every
 *       message action is rate-limited · no booking table / BookingService touch.
 *
 * This test does NOT touch the booking/Estimate flow and never submits a booking.
 * The known live-PHP smoke failures (501 on POST) are a SEPARATE suite and are
 * neither exercised nor masked here.
 *
 * Run: node tests/contact-chat.e2e.js   (or: npm run test:contact-chat)
 */
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const CONTACT_JS_PATH = path.join(__dirname, '..', 'js', 'contact-chat.js');
const CONTACT_PHP_PATH = path.join(__dirname, '..', 'hm-api', 'contact-chat.php');
const TELEGRAM_PHP_PATH = path.join(__dirname, '..', 'hm-api', '_telegram.php');
const CONTACT_JS  = fs.readFileSync(CONTACT_JS_PATH, 'utf8');
const CONTACT_PHP = fs.readFileSync(CONTACT_PHP_PATH, 'utf8');
const TELEGRAM_PHP = fs.readFileSync(TELEGRAM_PHP_PATH, 'utf8');

// The customer-facing ID alphabet the server MUST use (no O/0, I/1, S/5).
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ23456789';
const ID_RE = new RegExp('^HM[' + ID_ALPHABET + ']{5}$');

// ── In-page mock of contact-chat.php (installed as window.fetch) ─────────────
// Kept faithful to the real contract: resume/list/send REQUIRE contact_id+email;
// unknown id and wrong email BOTH yield an identical generic 401; a per-run
// counter trips a 429 after RL_LIMIT resume attempts.
function harness() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <script>
    window.API_BASE = 'https://api.test/hm-api';
    window.API_KEY  = 'test-key';

    // Sentinels — Contact Chat must NEVER call or overwrite the booking surface.
    window.__bookingCalls = 0;
    window.openBookingApp = function () { window.__bookingCalls++; };
    window.BookingService = { createBooking: function () { window.__createBookingCalls = (window.__createBookingCalls||0)+1; } };
    window.__openBookingApp_ref = window.openBookingApp;   // identity check later

    // Deterministic mock server.
    window.__reqs = [];
    var RL_LIMIT = 5;
    var store = {};            // code -> { email, name, category, messages:[] }
    var resumeAttempts = 0;
    var ALPHA = ${JSON.stringify(ID_ALPHABET)};
    function genCode() { var s='HM'; for (var i=0;i<5;i++) s+=ALPHA[Math.floor(Math.random()*ALPHA.length)]; return s; }
    function J(status, obj) { return Promise.resolve(new Response(JSON.stringify(obj), { status: status, headers: { 'Content-Type':'application/json' } })); }
    var GENERIC = { ok:false, data:null, error:{ message:'invalid', code:'invalid' } };

    window.fetch = function (url, opts) {
      opts = opts || {};
      var action = (String(url).match(/action=([a-z-]+)/) || [])[1] || '';
      var body = {}; try { body = JSON.parse(opts.body || '{}'); } catch (e) {}
      window.__reqs.push({ action: action, body: body });

      // create-booking must never be reached from here.
      if (String(url).indexOf('create-booking') >= 0) { window.__bookingFetch = true; return J(200, { ok:true }); }

      if (action === 'start') {
        if (!body.name || !body.email || !body.message) return J(400, { ok:false, data:null, error:{message:'missing',code:'missing'} });
        var code = genCode();
        store[code] = { email: String(body.email).toLowerCase(), name: body.name, category: body.category||'', messages: [] };
        store[code].messages.push({ id:'m1', sender_type:'customer', sender_name:body.name, text:body.message, created_at:'2026-08-21T10:00:00' });
        return J(200, { ok:true, data:{ public_contact_id: code, category: body.category||'', status:'open' }, error:null });
      }

      // Every message action requires BOTH contact_id and email (second factor).
      var code = String(body.contact_id || '').toUpperCase();
      var email = String(body.email || '').toLowerCase();

      if (action === 'resume') {
        resumeAttempts++;
        if (resumeAttempts > RL_LIMIT) return J(429, { ok:false, data:null, error:{ message:'Too many requests', code:'rate_limited' } });
      }
      if (action === 'resume' || action === 'list' || action === 'send') {
        var conv = store[code];
        // IDENTICAL generic response for unknown-id and wrong-email (no leak).
        if (!conv || conv.email !== email) return J(401, GENERIC);
        if (action === 'send') {
          conv.messages.push({ id:'m'+(conv.messages.length+1), sender_type:'customer', sender_name:conv.name, text:body.message, created_at:'2026-08-21T10:05:00' });
          return J(200, { ok:true, data:{ id:'ok' }, error:null });
        }
        if (action === 'resume') return J(200, { ok:true, data:{ public_contact_id:code, category:conv.category, status:'open', name:conv.name, messages:conv.messages }, error:null });
        return J(200, { ok:true, data:{ public_contact_id:code, status:'open', messages:conv.messages }, error:null }); // list
      }
      return J(400, { ok:false, data:null, error:{ message:'unknown_action', code:'unknown_action' } });
    };
  </script>
  <script>${CONTACT_JS}</script>
  </body></html>`;
}

(async () => {
  const results = [];
  const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail: detail || '' }); };

  // ═══════════ Layer B — server SOURCE CONTRACT (static, deterministic) ═══════════
  check('server ID alphabet excludes confusable O/I/S letters and 0/1 (keeps digits 2–9)',
    /const CC_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ23456789'/.test(CONTACT_PHP) &&
    !/const CC_ALPHABET = '[^']*[OIS01]/.test(CONTACT_PHP));
  check('server generates the short code server-side (random_int over the alphabet)',
    /random_int\(0, \$n - 1\)/.test(CONTACT_PHP) && /'HM'/.test(CONTACT_PHP));
  check('resume/list/send verify contact_id AND email (email second factor)',
    /filter_var\(\$email, FILTER_VALIDATE_EMAIL\)/.test(CONTACT_PHP) && /cc_valid_code\(\$code\)/.test(CONTACT_PHP));
  check('unknown-id and wrong-email return the SAME generic invalid (anti-enumeration)',
    /!\$row \|\| strtolower\(trim\(\(string\)\(\$row\['email'\] \?\? ''\)\)\) !== \$email/.test(CONTACT_PHP));
  check('auth failures are logged (hm_log_auth_fail on contact_access)',
    /hm_log_auth_fail\('contact_access'\)/.test(CONTACT_PHP));
  check('every public action is rate-limited (start/resume/list/send)',
    /hm_rate_limit\('contact_start'/.test(CONTACT_PHP) &&
    /hm_rate_limit\('contact_resume'/.test(CONTACT_PHP) &&
    /hm_rate_limit\('contact_list'/.test(CONTACT_PHP) &&
    /hm_rate_limit\('contact_send'/.test(CONTACT_PHP));
  check('admin actions require a staff token (X-ADMIN-TOKEN verified inline)',
    /cc_require_staff\(\)/.test(CONTACT_PHP) && /hm_admin_token_verify/.test(CONTACT_PHP));
  check('retention window is server-side/config-driven (contact_retention_days) with a safe default',
    /\$cfg\['contact_retention_days'\] \?\? 180/.test(CONTACT_PHP));
  check('SERVER never queries the bookings table / BookingService / create-booking',
    !/(FROM|INTO|UPDATE|JOIN)\s+bookings\b/i.test(CONTACT_PHP) &&
    !/BookingService/.test(CONTACT_PHP) && !/create-booking/.test(CONTACT_PHP));

  // Notifications: Telegram REPLACES LINE for Contact Chat (fire-and-forget).
  check('Contact Chat notifies via Telegram, not LINE',
    /hm_telegram_send\(/.test(CONTACT_PHP) && !/hm_line_push/.test(CONTACT_PHP));
  check('Contact Chat requires the Telegram helper (not _line.php)',
    /require_once __DIR__ \. '\/_telegram\.php'/.test(CONTACT_PHP) && !/_line\.php/.test(CONTACT_PHP));
  check('Telegram helper uses the official Bot API sendMessage endpoint',
    /https:\/\/api\.telegram\.org\/bot' \. \$token \. '\/sendMessage/.test(TELEGRAM_PHP));
  check('Telegram helper is fire-and-forget (gated by telegram_enabled, returns bool)',
    /empty\(\$cfg\['telegram_enabled'\]\)\) return false/.test(TELEGRAM_PHP));
  check('Telegram helper sets a network timeout',
    /CURLOPT_TIMEOUT/.test(TELEGRAM_PHP) && /'timeout'/.test(TELEGRAM_PHP));
  check('Telegram helper never logs the token or the token-bearing URL',
    !/hm_log_error\([^;]*\$token/.test(TELEGRAM_PHP) && !/hm_log_error\([^;]*\$url/.test(TELEGRAM_PHP));
  check('Telegram helper sends plain text (no parse_mode parameter → no formatting injection)',
    !/'parse_mode'\s*=>/.test(TELEGRAM_PHP));

  // ═══════════ Layer A — CLIENT behavior (browser) ═══════════
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // Serve the harness over a real (offline, intercepted) http origin so
  // localStorage is available — setContent's opaque origin disables it, which the
  // same-device session-resume path needs. The API itself is still stubbed in-page.
  await page.route('http://contact.test/', route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: harness() }));
  await page.goto('http://contact.test/', { waitUntil: 'load' });

  check('window.openContactChat is defined (entry point present)',
    await page.evaluate(() => typeof window.openContactChat === 'function'));

  // 1) New Contact Chat opens on the NEW screen
  await page.evaluate(() => window.openContactChat('new'));
  await page.waitForSelector('#hmccSubmit', { timeout: 5000 });
  check('「新しくお問い合わせ」 opens the new-inquiry form', await page.isVisible('#hmccName'));

  // 2) Client-side validation blocks an empty submit (no conversation created)
  await page.click('#hmccSubmit');
  check('empty submit is blocked client-side (no ID card, no request sent)',
    (await page.isVisible('.hmcc-idcard')) === false &&
    (await page.evaluate(() => window.__reqs.filter(r => r.action === 'start').length === 0)));

  // 3) Valid submission → short Contact ID returned + shown
  await page.fill('#hmccName', '山田 太郎');
  await page.fill('#hmccEmail', 'taro@example.com');
  await page.fill('#hmccMsg', '見積りについて相談したいです。');
  await page.click('#hmccSubmit');
  await page.waitForSelector('.hmcc-idcard .code', { timeout: 5000 });
  const code = (await page.textContent('.hmcc-idcard .code')).trim();
  check('a valid short Contact ID (HM + 5 safe chars) is returned and shown', ID_RE.test(code), 'got: ' + code);
  check('start request carried name + email + message', await page.evaluate(() => {
    const r = window.__reqs.find(x => x.action === 'start');
    return r && r.body.name && r.body.email && r.body.message;
  }));

  // 4) Chat opens with the created conversation (first message visible)
  await page.click('#hmccGoChat');
  await page.waitForSelector('#hmccStream .hmcc-b', { timeout: 5000 });
  check('chat opens showing the created conversation',
    (await page.textContent('#hmccStream')).includes('見積りについて'));

  // 5) Customer message can be sent (second bubble appears)
  await page.fill('#hmccInput', '来週の火曜は空いていますか？');
  await page.click('#hmccSendBtn');
  await page.waitForFunction(() => document.querySelectorAll('#hmccStream .hmcc-b').length >= 2, { timeout: 5000 });
  check('customer can send a follow-up message', true);
  check('send request carried contact_id AND email (never ID-only)', await page.evaluate(() => {
    const r = window.__reqs.filter(x => x.action === 'send').pop();
    return r && !!r.body.contact_id && !!r.body.email;
  }));

  // 6) Resume with correct ID + email
  await page.click('.hmcc-x');
  await page.evaluate(() => window.openContactChat('resume'));
  await page.waitForSelector('#hmccResume', { timeout: 5000 });
  check('resume screen is prefilled from the saved same-device session',
    (await page.inputValue('#hmccRid')) === code);
  await page.fill('#hmccRem', 'taro@example.com');
  await page.click('#hmccResume');
  await page.waitForSelector('#hmccStream .hmcc-b', { timeout: 5000 });
  check('resume with correct Contact ID + email opens the conversation',
    (await page.textContent('#hmccStream')).includes('見積りについて'));
  check('resume request always sends BOTH contact_id and email', await page.evaluate(() => {
    const r = window.__reqs.find(x => x.action === 'resume');
    return r && !!r.body.contact_id && !!r.body.email;
  }));

  // 7) Resume with WRONG email is rejected — capture the exact generic message
  await page.click('.hmcc-x');
  await page.evaluate(() => window.openContactChat('resume'));
  await page.waitForSelector('#hmccResume', { timeout: 5000 });
  await page.fill('#hmccRid', code);
  await page.fill('#hmccRem', 'attacker@example.com');
  await page.click('#hmccResume');
  await page.waitForSelector('.hmcc-status.err', { timeout: 5000 });
  const wrongEmailMsg = (await page.textContent('.hmcc-status.err')).trim();
  check('resume with wrong email is rejected (no conversation opens)',
    (await page.evaluate(() => !document.getElementById('hmccStream'))) && wrongEmailMsg.length > 0);

  // 8) Unknown Contact ID + wrong email → IDENTICAL generic failure
  await page.fill('#hmccRid', 'HM2Z4K9');   // valid format, does not exist
  await page.fill('#hmccRem', 'nobody@example.com');
  await page.click('#hmccResume');
  await page.waitForSelector('.hmcc-status.err', { timeout: 5000 });
  const unknownMsg = (await page.textContent('.hmcc-status.err')).trim();
  check('unknown ID + wrong email yields the SAME generic failure as wrong-email (no enumeration)',
    unknownMsg === wrongEmailMsg, 'wrong="' + wrongEmailMsg + '" unknown="' + unknownMsg + '"');

  // 9) Rate limiting — repeated resume attempts eventually get a 429 the client
  //    surfaces without crashing.
  let sawRateLimit = false;
  for (let i = 0; i < 5; i++) {
    await page.fill('#hmccRid', 'HM2Z4K9');
    await page.fill('#hmccRem', 'nobody@example.com');
    await page.click('#hmccResume');
    await page.waitForTimeout(120);
  }
  sawRateLimit = await page.evaluate(() => window.__reqs.filter(r => r.action === 'resume').length > 5);
  check('rate-limit path is exercised (resume attempts exceed the limit) and handled gracefully',
    sawRateLimit && (await page.isVisible('.hmcc-status.err')));

  // 10) Booking / Estimate flow untouched — no calls, globals intact, no fetch
  check('booking overlay never invoked by Contact Chat',
    await page.evaluate(() => (window.__bookingCalls === 0) && !window.__createBookingCalls && !window.__bookingFetch));
  check('booking globals were not overwritten by Contact Chat',
    await page.evaluate(() => window.openBookingApp === window.__openBookingApp_ref && typeof window.BookingService.createBooking === 'function'));

  // 11) Zero JS errors across the whole flow
  check('no JS errors during the Contact Chat flow', errors.length === 0, errors.join(' | '));

  await browser.close();

  // ── Report ──
  console.log('──────── Contact Chat regression ────────');
  let pass = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.ok || !r.detail ? '' : ' — ' + r.detail}`);
    if (r.ok) pass++;
  }
  console.log('──────────────────────────────────────────');
  console.log(`${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS FAILURE:', e); process.exit(1); });
