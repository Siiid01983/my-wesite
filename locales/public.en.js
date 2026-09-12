/* ════════════════════════════════════════════════════════════════════════════
   locales/public.en.js — PUBLIC customer-site English overlay dictionary.

   ADDITIVE ONLY. This is a Japanese→English lookup used by js/i18n/publicI18n.js
   for the public marketing site + the customer booking/estimate (BA) overlay +
   the contact-chat launcher UI. It is NOT loaded on Ops or Admin, and it does not
   touch locales/ja.js, locales/en.js, or the hm_lang engine.

   Rules:
     • Japanese is the source of truth and the fallback. A key MISSING here means
       the existing Japanese text is shown unchanged (never blank, never machine
       translated).
     • Keys are the EXACT trimmed Japanese text as it renders in the DOM. The
       engine only replaces a text node whose trimmed textContent equals a key
       (whole-node match), so partial/customer/dynamic text is never altered.
     • NEVER add keys for values that are semantic (status enums, [data-service]
       routing values, packed-note tokens, prices, service-name keys). Those are
       logic, not display copy — see CLAUDE.md protections.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var EN = {
    /* ── Header / navigation ──────────────────────────────────────────────── */
    '無料見積り': 'Free Estimate',
    'お問い合わせ': 'Contact',
    'マイ予約': 'My Booking',
    'メニュー': 'Menu',
    'お約束': 'Our Promise',
    '引越しの流れ': 'How It Works',
    'お客様の声': 'Reviews',
    '会社情報': 'Company',
    'ブログ': 'Blog',

    /* ── Hero ─────────────────────────────────────────────────────────────── */
    '東京 14年の実績 — 国土交通省 認可': 'Tokyo · 14 years · Ministry-licensed',
    '引越し見積もりから予約まで、スマホ一つでスムーズに。':
      'From estimate to booking — all smoothly from your phone.',
    '無料見積もり依頼': 'Request a Free Estimate',
    '今すぐ無料見積り': 'Get a Free Estimate Now',
    '作業事例を見る': 'See our work',
    '引越し実績': 'moves completed',
    'の経験': 'years of experience',
    '国交省認可': 'Ministry-licensed',
    '返信対応': 'reply time',
    'Scroll': 'Scroll',

    /* ── Booking / estimate (BA) overlay — screen titles & labels ─────────── */
    'サービスを選択': 'Choose a service',
    '現住所：': 'Current address:',
    '現住所を選択': 'Select current address',
    '引越し先：': 'Destination:',
    '引越し先を選択': 'Select destination',
    '荷物：': 'Items:',
    '荷物を選択': 'Select items',
    '作業員：': 'Movers:',
    '2名': '2 movers',
    '1名': '1 mover',
    '希望日：': 'Preferred date:',
    '引越し希望日を選択': 'Select a preferred date',
    '希望時間：': 'Preferred time:',
    '時間帯を選択': 'Select a time slot',
    '絞り込み：': 'Filter:',
    '条件を選択': 'Select conditions',
    'お客様情報の入力へ': 'Continue to your details',
    'お客様情報': 'Your details',
    'お名前': 'Full name',
    'メールアドレス': 'Email address',
    '電話番号': 'Phone number',
    '不用品回収のご希望（任意）': 'Disposal request (optional)',
    'ご要望・備考（任意）': 'Requests / notes (optional)',
    'お名前・メールアドレス・電話番号を正しくご入力ください。':
      'Please enter a valid name, email address and phone number.',
    '確認画面へ': 'Continue to review',
    'ご予約内容の確認': 'Review your request',
    '送信に失敗しました。お電話（090-2489-3402）またはLINEにてご連絡ください。':
      'Submission failed. Please contact us by phone (090-2489-3402) or LINE.',
    '予約を確定する': 'Submit request',

    /* ── BA success (estimate sent) screen ───────────────────────────────── */
    'お見積書を送信しました': 'Your estimate request has been sent',
    '担当者より最短2時間以内にご連絡いたします。':
      'Our team will contact you within 2 hours.',
    '予約番号は控えておいてください。': 'Please keep your reference number.',
    '※こちらは現時点では「お見積り」であり、ご予約（確定）ではございません。内容をご確認のうえ、担当者より改めてご案内いたします。':
      '* This is an estimate only — not a confirmed booking. Our team will review it and follow up with you.',
    '予約番号': 'Reference number',
    '閉じる': 'Close',

    /* ── Common a11y / placeholders (attributes) ─────────────────────────── */
    'メインナビゲーション': 'Main navigation',
    'お問い合わせへ': 'Go to contact',
    'メニューを開く': 'Open menu',
    '下へスクロール': 'Scroll down',
    'ご不明な点・ご要望などをご記入ください。':
      'Please tell us any questions or requests.',
  };

  // Publish for the public i18n engine (browser) and tests (node).
  if (typeof window !== 'undefined') { window.HM_PUBLIC_EN = EN; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = EN; }
})();
