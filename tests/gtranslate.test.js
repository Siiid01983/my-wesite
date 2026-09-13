'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   gtranslate.test.js — Japanese-first guarantee + opt-in Google Translate.

   Replaces tests/public-i18n.test.js. Guards the direction change:
     • Japanese is ALWAYS the source page — no browser-language auto-selection,
       no stored language preference, no custom 日本語|English switch.
     • A small, opt-in Google Translate control exists and is footer-mounted.
     • The retired custom English system is gone and unreferenced.
     • Business-critical values are never sourced from translated DOM text.
   ════════════════════════════════════════════════════════════════════════════ */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

const PUBLIC_PAGES = ['index.html', 'article.html', 'blog.html', 'cancellation-policy.html',
  'login-v2.html', 'portal-v2.html', 'privacy.html', 'reviews.html', 'terms.html'];

const GT = read(path.join('js', 'gtranslate.js'));
// Comments explain what the file deliberately does NOT do, so scan code only.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const GT_CODE = stripComments(GT);

/* ── 1. No automatic language detection anywhere ───────────────────────── */
test('no public code selects a language from the browser', () => {
  assert.ok(!/navigator\.languages?/.test(GT_CODE),
    'gtranslate.js must not read navigator.language(s)');
  PUBLIC_PAGES.forEach((f) => {
    assert.ok(!/navigator\.languages?\s*(\[|\.|\))/.test(read(f)),
      f + ' must not branch on navigator language');
  });
});

test('no language preference is stored or restored', () => {
  // hm_pub_lang may only appear as a one-way purge of the retired key.
  const refs = GT_CODE.match(/hm_pub_lang/g) || [];
  assert.ok(refs.length <= 1, 'hm_pub_lang must not be reintroduced as a preference');
  if (refs.length) {
    assert.ok(/removeItem\('hm_pub_lang'\)/.test(GT_CODE),
      'the only hm_pub_lang reference must be removeItem');
    assert.ok(!/(get|set)Item\('hm_pub_lang'/.test(GT_CODE), 'must never read or write hm_pub_lang');
  }
  PUBLIC_PAGES.forEach((f) => assert.ok(!/hm_pub_lang/.test(read(f)), f + ' references hm_pub_lang'));
});

/* ── 1b. Strict Japanese-first: Google's persisted choice is cleared ────── */
test('Google googtrans cookie is expired on a fresh load', () => {
  assert.ok(/function clearGoogleTranslateState/.test(GT_CODE), 'reset function present');
  assert.ok(/googtrans=;expires=Thu, 01 Jan 1970/.test(GT_CODE), 'cookie is expired');
  assert.ok(/clearGoogleTranslateState\(\);/.test(GT_CODE), 'reset runs at boot');
  // Must expire across the domain scopes Google may have written.
  assert.ok(/'\.' \+ host/.test(GT_CODE) && /parts\.slice\(-2\)/.test(GT_CODE),
    'clears host, dot-host and registrable-domain scopes');
});

test('an explicit in-session choice is not clobbered', () => {
  // The reset bails out while the visitor is mid-translation in this tab…
  assert.ok(/sessionStorage\.getItem\(SESSION_KEY\)\) return;/.test(GT_CODE),
    'reset skips when the session flag is set');
  // …and the flag is set the moment they opt in.
  assert.ok(/sessionStorage\.setItem\(SESSION_KEY, '1'\)/.test(GT_CODE),
    'opting in marks the session');
  // The flag records only that a translation is active — never which language.
  assert.ok(/SESSION_KEY = 'hm_gt_session'/.test(GT_CODE), 'session flag stores no language');
  assert.ok(!/setItem\(SESSION_KEY,\s*['"](en|ja)/.test(GT_CODE), 'must not store a language');
});

test('?lang=en is not interpreted by any public code', () => {
  assert.ok(!/[?&]lang=|queryLang|searchParams\.get\(['"]lang/.test(GT),
    'gtranslate.js must ignore ?lang');
});

/* ── 2. The custom English system is fully retired ─────────────────────── */
test('retired custom i18n files are deleted', () => {
  ['locales/public.en.js', 'js/i18n/publicI18n.js', 'tests/public-i18n.test.js']
    .forEach((f) => assert.ok(!exists(f), 'must be deleted: ' + f));
});

test('nothing references the retired custom i18n system', () => {
  PUBLIC_PAGES.concat(['sw.js']).forEach((f) => {
    const src = read(f);
    assert.ok(!/publicI18n\.js|public\.en\.js/.test(src), f + ' still references the retired system');
    assert.ok(!/PubI18n|HM_PUBLIC_EN/.test(src), f + ' still references the retired globals');
  });
});

test('retired assets are pruned from the server on deploy', () => {
  const dep = read('deploy.js');
  ['locales/public.en.js', 'js/i18n/publicI18n.js']
    .forEach((f) => assert.ok(dep.includes(`'${f}'`), 'deploy PRUNE must list ' + f));
});

test('no custom 日本語 | English switch is rendered', () => {
  assert.ok(!/hm-pub-lang|日本語\s*\|\s*English/.test(GT), 'custom switch must not return');
  PUBLIC_PAGES.forEach((f) => assert.ok(!/hm-pub-lang/.test(read(f)), f + ' renders the old switch'));
});

/* ── 3. The Google Translate control ───────────────────────────────────── */
test('every public page loads the Google Translate control', () => {
  PUBLIC_PAGES.forEach((f) => assert.ok(/js\/gtranslate\.js/.test(read(f)), f + ' missing the control'));
});

test('control is opt-in: Google is only fetched on click', () => {
  assert.ok(/translate\.google\.com\/translate_a\/element\.js/.test(GT), 'uses the official widget');
  // The script tag must be created inside load(), which is bound to the click.
  assert.ok(/addEventListener\('click',\s*load\)/.test(GT), 'load is bound to a click');
  assert.ok(/autoDisplay:\s*false/.test(GT), 'must never auto-translate');
  assert.ok(/pageLanguage:\s*'ja'/.test(GT), 'source page language is Japanese');
});

test('control is footer-mounted and never in the header', () => {
  const m = /var MOUNTS = \[([\s\S]*?)\]/.exec(GT);
  assert.ok(m, 'MOUNTS list present');
  assert.ok(!/header|\.header-cta|#mobileNav/i.test(m[1]),
    'must not mount in the header (that clipped the wordmark previously)');
  assert.ok(/footer/i.test(m[1]), 'mounts in a footer');
});

test('Google chrome that would shift layout is suppressed', () => {
  assert.ok(/goog-te-banner-frame[\s\S]*?display:none/.test(GT), 'top banner hidden');
  assert.ok(/body\{top:0 !important/.test(GT), 'body offset neutralised (no layout shift)');
});

test('sw.js precaches the control and not the retired files', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes("'/js/gtranslate.js'"), 'control precached');
  assert.ok(!/public\.en\.js|publicI18n\.js/.test(sw), 'retired files removed from precache');
});

/* ── 4. Business logic must never come from translated DOM text ────────── */
test('booking payload is built from state/attributes, not DOM text', () => {
  const idx = read('index.html');
  // The submit path reads baState / JS config — not textContent.
  assert.ok(/service:\s*baState\.service/.test(idx), 'service comes from baState');
  assert.ok(/status:\s*'新規'/.test(idx), 'status is a JS literal, not DOM text');
  // Service routing is attribute-driven (attributes are never translated).
  assert.ok(/openBookingApp\(this\.dataset\.service\)/.test(idx),
    'service routing uses the data-service attribute');
  // No DOM text is read back into logic in the booking path. The only permitted
  // read is the cosmetic save/restore of a button's own label while submitting.
  const reads = [...idx.matchAll(/([\w$.]+)\s*=\s*([\w$.\[\]()'"]+)\.(textContent|innerText)\b/g)]
    .map((m) => ({ lhs: m[1], rhs: m[2], all: m[0] }));
  const risky = reads.filter((r) => !/^(label|err|_?prev(Label)?)$/i.test(r.lhs) && !/btn|err/i.test(r.rhs));
  assert.deepEqual(risky.map((r) => r.all), [],
    'DOM text must not feed logic: ' + risky.map((r) => r.all).join(', '));
});

test('customer-data nodes are marked non-translatable', () => {
  ['.ba-val', '.ba-ref-num', '.pchat-bubble', '.pv2-bubble']
    .forEach((sel) => assert.ok(GT.includes(sel), 'NO_TX must cover ' + sel));
  assert.ok(/classList\.add\('notranslate'\)/.test(GT), 'applies the notranslate class');
  assert.ok(/setAttribute\('translate',\s*'no'\)/.test(GT), 'applies translate="no"');
});

test('protected Japanese semantic values are untouched in source', () => {
  const svc = read('bookingService.js');
  ['新規', '確認中', '確定', '完了', 'キャンセル']
    .forEach((s) => assert.ok(svc.includes(s), 'status enum must remain in bookingService.js: ' + s));
  assert.ok(/荷物: /.test(read('index.html')), '_packNotes token preserved');
});
