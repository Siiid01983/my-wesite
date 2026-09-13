'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   public-i18n.test.js — public-site English layer: detection, fallback, URL.

   Pure-logic tests (no DOM/network) for js/i18n/publicI18n.js + the overlay
   dictionary locales/public.en.js. Guards the approved behavior:
     • detection precedence: query > stored > browser > default(ja)
     • en tags → en, ja tags and everything else → ja
     • missing English key → Japanese fallback (never blank, never machine-tx)
     • ?lang=en URL behavior; Japanese returns to a clean (no-lang) URL
     • the dictionary never translates protected semantic keys
   ════════════════════════════════════════════════════════════════════════════ */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const I = require(path.join(ROOT, 'js', 'i18n', 'publicI18n.js'));
const EN = require(path.join(ROOT, 'locales', 'public.en.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ── tagToLang ─────────────────────────────────────────────────────────── */
test('tagToLang: en* → en, ja* → ja, other → null', () => {
  ['en', 'en-US', 'en-GB', 'EN-us'].forEach((t) => assert.equal(I.tagToLang(t), 'en'));
  ['ja', 'ja-JP', 'JA'].forEach((t) => assert.equal(I.tagToLang(t), 'ja'));
  ['fr', 'de-DE', 'zh', 'ko', ''].forEach((t) => assert.equal(I.tagToLang(t), null));
});

/* ── queryLang ─────────────────────────────────────────────────────────── */
test('queryLang parses ?lang and validates', () => {
  assert.equal(I.queryLang('?lang=en'), 'en');
  assert.equal(I.queryLang('?a=1&lang=EN&b=2'), 'en');
  assert.equal(I.queryLang('?lang=ja'), 'ja');
  assert.equal(I.queryLang('?lang=fr'), null);   // unsupported → ignored
  assert.equal(I.queryLang(''), null);
});

/* ── decide: precedence query > stored > browser > default ─────────────── */
test('decide: ?lang=en wins and persists', () => {
  const r = I.decide({ query: '?lang=en', stored: 'ja', navigatorLanguages: ['ja-JP'] });
  assert.deepEqual(r, { lang: 'en', persist: true, source: 'query' });
});
test('decide: ?lang=ja returns Japanese and persists', () => {
  const r = I.decide({ query: '?lang=ja', stored: 'en' });
  assert.equal(r.lang, 'ja'); assert.equal(r.persist, true); assert.equal(r.source, 'query');
});
test('decide: stored beats browser', () => {
  const r = I.decide({ query: '', stored: 'en', navigatorLanguages: ['ja-JP'] });
  assert.deepEqual(r, { lang: 'en', persist: false, source: 'stored' });
});
test('decide: English browser → en', () => {
  const r = I.decide({ query: '', stored: null, navigatorLanguages: ['en-US', 'ja'] });
  assert.equal(r.lang, 'en'); assert.equal(r.source, 'browser');
});
test('decide: Japanese browser → ja', () => {
  const r = I.decide({ query: '', stored: null, navigatorLanguages: ['ja-JP'] });
  assert.equal(r.lang, 'ja'); assert.equal(r.source, 'browser');
});
test('decide: other language → Japanese default', () => {
  const r = I.decide({ query: '', stored: null, navigatorLanguages: ['fr-FR', 'de'] });
  assert.equal(r.lang, 'ja'); assert.equal(r.source, 'default');
});
test('decide: first decidable browser tag wins (fr ignored, en picked)', () => {
  const r = I.decide({ query: '', stored: null, navigatorLanguages: ['fr', 'en-GB'] });
  assert.equal(r.lang, 'en'); assert.equal(r.source, 'browser');
});
test('decide: empty everything → default ja', () => {
  assert.equal(I.decide({}).lang, 'ja');
  assert.equal(I.decide({}).source, 'default');
});
test('decide: navigatorLanguage (singular) fallback works', () => {
  const r = I.decide({ query: '', stored: null, navigatorLanguage: 'en-US' });
  assert.equal(r.lang, 'en');
});

/* ── translate: English with Japanese fallback ─────────────────────────── */
test('translate: en mode returns English for a known key', () => {
  assert.equal(I.translate(EN, '無料見積り', 'en'), 'Free Estimate');
});
test('translate: en mode falls back to Japanese for an unknown key', () => {
  assert.equal(I.translate(EN, '未登録の日本語テキスト', 'en'), '未登録の日本語テキスト');
});
test('translate: ja mode always returns Japanese (even if key exists)', () => {
  assert.equal(I.translate(EN, '無料見積り', 'ja'), '無料見積り');
});
test('translate: null-safe', () => {
  assert.equal(I.translate(EN, null, 'en'), null);
});

/* ── switchHref: query-based URL behavior ──────────────────────────────── */
test('switchHref: English adds ?lang=en, preserving path/params/hash', () => {
  const loc = { pathname: '/', search: '?utm=x', hash: '#booking' };
  assert.equal(I.switchHref(loc, 'en'), '/?utm=x&lang=en#booking');
});
test('switchHref: Japanese strips lang → clean current URL', () => {
  const loc = { pathname: '/', search: '?lang=en&utm=x', hash: '#faq' };
  assert.equal(I.switchHref(loc, 'ja'), '/?utm=x#faq');
});
test('switchHref: Japanese with only lang param → bare path (no ?)', () => {
  assert.equal(I.switchHref({ pathname: '/index.html', search: '?lang=en', hash: '' }, 'ja'),
    '/index.html');
});

/* ── dictionary guards ─────────────────────────────────────────────────── */
test('dictionary: covers key public UI strings', () => {
  ['無料見積り', 'お問い合わせ', 'サービスを選択', 'お見積書を送信しました', '予約番号']
    .forEach((k) => assert.ok(EN[k] && EN[k] !== k, 'missing EN for ' + k));
});
/* ── each public page loads the shared engine (single system) ──────────── */
test('every targeted public page loads the shared i18n engine + dictionary', () => {
  ['index.html', 'blog.html', 'article.html', 'reviews.html', 'privacy.html',
    'terms.html', 'login-v2.html', 'portal-v2.html'].forEach((f) => {
    const html = read(f);
    assert.ok(/locales\/public\.en\.js/.test(html), f + ' loads locales/public.en.js');
    assert.ok(/js\/i18n\/publicI18n\.js/.test(html), f + ' loads js/i18n/publicI18n.js');
  });
});
test('no second localization system introduced on public pages', () => {
  // Public pages must NOT pull in the Ops/Admin engines (localeManager / utils/i18n).
  ['blog.html', 'article.html', 'reviews.html', 'privacy.html', 'terms.html',
    'login-v2.html', 'portal-v2.html'].forEach((f) => {
    const html = read(f);
    assert.ok(!/lib\/localeManager\.js/.test(html), f + ' must not load localeManager');
    assert.ok(!/utils\/i18n\.js/.test(html), f + ' must not load admin utils/i18n');
  });
});

/* ── no visible language switch (invisible selection only) ─────────────── */
test('engine renders NO visible language switch', () => {
  const src = read(path.join('js', 'i18n', 'publicI18n.js'));
  assert.ok(!/hm-pub-lang/.test(src), 'switch element/class must not be reintroduced');
  assert.ok(!/mountSwitch|switchEl\s*\(/.test(src), 'switch mounting must not be reintroduced');
  // …but invisible selection must still work.
  assert.ok(/hm_pub_lang/.test(src), 'hm_pub_lang preference key retained');
  assert.ok(/queryLang|lang=/.test(src), '?lang= handling retained');
  assert.ok(/navigatorLanguages|navigator\.languages/.test(src), 'browser detection retained');
});

/* ── English-only CSS must never leak into the Japanese render ─────────── */
test('injected responsive CSS is scoped to html[lang="en"] only', () => {
  const src = read(path.join('js', 'i18n', 'publicI18n.js'));
  const m = /function injectEnCss\(\)[\s\S]*?\n  }/.exec(src);
  assert.ok(m, 'injectEnCss present');
  // Every selector line that styles a site class must carry the html[lang="en"] scope.
  m[0].split('\n')
    .filter((l) => /\.(header-cta|sticky-btn|v2btn|v2hero)/.test(l))
    .forEach((l) => assert.ok(/html\[lang="en"\]/.test(l), 'unscoped EN rule: ' + l.trim()));
});

/* ── hero: English hero copy exists so the hero is never half-translated ── */
test('dictionary provides the English hero H1 and CMS sub-line', () => {
  assert.equal(EN['即日対応、スマホで完結。'], 'Same-day service, all from your phone.');
  assert.ok(EN['無料見積り対応'] && EN['無料見積り対応'] !== '無料見積り対応',
    'CMS hero sub has an English display-layer value');
});

/* ── new page strings translate; content/data stays Japanese ───────────── */
test('dictionary: covers the newly added page chrome', () => {
  ['ホーム', 'よくある質問', 'お客様の口コミ', '口コミをもっと見る',
    'マイページ ログイン', 'ログイン', '連絡先を更新', 'チャットで相談する',
    '新しくお問い合わせ', 'お問い合わせを再開', '送信して番号を発行']
    .forEach((k) => assert.ok(EN[k] && EN[k] !== k, 'missing EN for ' + k));
});

test('dictionary: NEVER translates protected semantic values (status/service keys)', () => {
  // Status enums (bookingService.js), service-name keys, packed-note tokens, and
  // routing values must not be display-translated — they are logic.
  ['新規', '確認中', '確定', '完了', 'キャンセル',
    '単身引越し', 'カップル・ご夫婦引越し', '学生・新生活引越し',
    '当日・お急ぎ引越しプラン', '不用品回収・処分サービス', '家具組立・分解',
    '荷物: ', '作業員: ', 'locmode', 'from:', 'to:'
  ].forEach((k) => assert.ok(!(k in EN), 'protected key must NOT be in dictionary: ' + k));
});
