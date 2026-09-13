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
    // Hero H1. The element carries translate="no" in the Japanese source (brand
    // statement) and is swapped ONLY in English mode by applyHeroTitle(), so the
    // hero never renders half-English. The Japanese source stays untouched.
    '即日対応、スマホで完結。': 'Same-day service, all from your phone.',
    '引越し見積もりから予約まで、スマホ一つでスムーズに。':
      'From estimate to booking — all smoothly from your phone.',
    // CMS-saved hero sub-line (hm_hero) as it renders in production. Display-layer
    // only — the stored Japanese CMS value is never modified.
    '無料見積り対応': 'Free estimates available',
    '無料見積もり依頼': 'Request a Free Estimate',
    // Sticky bar + footer CTA. Kept short so all three sticky labels fit their
    // equal thirds on a 360px screen without clipping.
    '今すぐ無料見積り': 'Free Estimate',
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

    /* ── Shared footer / secondary nav (blog · article · reviews · legal) ─── */
    'ホーム': 'Home',
    'オンライン予約': 'Online booking',
    'よくある質問': 'FAQ',
    '東京を拠点に、丁寧で安心の引越しサービスを提供しています。日本語・英語対応。':
      'Based in Tokyo, we provide careful, reliable moving services. Japanese & English support.',

    /* ── Blog / article ──────────────────────────────────────────────────── */
    '引越しのコツ・お知らせ': 'Moving tips & news',
    '記事を読み込んでいます…': 'Loading articles…',

    /* ── Reviews (public) — review CONTENT stays Japanese (data) ──────────── */
    '← ホームへ戻る': '← Back to home',
    '口コミ': 'Reviews',
    'お客様の口コミ': 'Customer reviews',
    '口コミを読み込んでいます…': 'Loading reviews…',
    'お引越しをご検討中ですか？': 'Planning a move?',
    '最短2時間でご返信。まずはお気軽に無料お見積りをどうぞ。':
      'We reply within 2 hours. Get a free estimate — no obligation.',
    '14年の実績・国交省認可': '14 years · Ministry-licensed',
    'お引越しのご相談': 'Moving consultation',
    '無料見積もり': 'Free estimate',
    '✓ 認証済み': '✓ Verified',
    '口コミをもっと見る': 'Read more reviews',

    /* ── Customer login (login-v2) — display only; auth logic untouched ───── */
    'マイページ ログイン': 'My Page Login',
    'ご予約時のメールアドレスと予約番号（確認番号）を入力してください。':
      'Enter the email address and reference (confirmation) number from your booking.',
    'ご予約時に登録されたメールアドレスをご入力ください。':
      'Enter the email address you registered when booking.',
    '予約番号（確認番号）': 'Reference number (confirmation number)',
    'ご予約確認メールに記載の予約番号をご入力ください。':
      'Enter the reference number shown in your booking confirmation email.',
    '管理者はメールアドレスのみでログインできます':
      'Administrators can log in with email only',
    'ログイン': 'Log in',

    /* ── Customer portal (portal-v2) — display chrome; booking DATA stays JA ─ */
    // Sidebar nav labels. These are pure navigation chrome — NOT status enums,
    // service names or routing keys — so they are safe to translate at the display
    // layer. tests/public-i18n.test.js parses the portal sidebar markup and fails
    // if any label here goes missing again.
    'マイページ': 'My Page',
    'ダッシュボード': 'Dashboard',
    'チャット': 'Chat',
    '写真': 'Photos',
    '口コミ投稿': 'Write a review',
    // Portal header control that sits beside the sidebar (also guarded by a test).
    'ログアウト': 'Log out',
    '連絡先の更新（Update Contact）': 'Update Contact',
    'メールアドレスはログインに使用するため変更できません。':
      'Your email is used for login and cannot be changed.',
    '連絡先を更新': 'Update contact',
    'キャンセルのご依頼（Cancellation）': 'Cancellation',
    'キャンセルのご依頼を受付けました。担当者がご連絡いたします。':
      'Your cancellation request has been received. Our team will contact you.',
    'キャンセルのご依頼（Request Cancellation）': 'Request Cancellation',
    'キャンセル理由（任意）': 'Reason for cancellation (optional)',
    'キャンセルを依頼する': 'Request cancellation',
    'ご依頼後、担当者が確認のうえ手続きいたします。':
      'After your request, our team will review and process it.',
    '予約の管理': 'Manage booking',
    'チャットで相談する': 'Chat with us',
    '予約ステータス': 'Booking status',
    '引越し日': 'Moving date',
    '担当スタッフ': 'Assigned staff',
    '見積もりステータス': 'Estimate status',
    '最新の更新': 'Latest update',
    'お見積もりの承認（Approve Estimate）': 'Approve Estimate',
    '内容をご確認のうえ、お見積もりを承認してください。承認すると予約が確定します。':
      'Please review the details and approve the estimate. Approving confirms your booking.',
    'お見積もりを承認': 'Approve estimate',
    '予約内容': 'Booking details',
    '引越し詳細': 'Move details',
    'ステータス': 'Status',
    '希望日': 'Preferred date',
    '希望時間': 'Preferred time',
    '出発地': 'Origin',
    '到着地': 'Destination',
    '荷物': 'Items',
    'サービス': 'Service',
    '備考': 'Notes',
    '✕ ご予約はキャンセルされました。': '✕ Your booking has been cancelled.',
    '進捗': 'Progress',

    /* ── Contact Chat shell (rendered on index.html by js/contact-chat.js;
          the engine's observer translates it. Message bubbles stay Japanese) ─ */
    'お問い合わせチャット': 'Contact chat',
    'Hello Moving カスタマーサポート': 'Hello Moving Customer Support',
    '前回のお問い合わせを続ける': 'Continue your previous inquiry',
    'ご質問・ご相談をチャットでお受けします。担当者が順次ご返信いたします。':
      'Ask us anything by chat. Our team will reply in order.',
    '新しくお問い合わせ': 'New inquiry',
    'お問い合わせを再開': 'Resume inquiry',
    'お問い合わせ番号とメールアドレスで再開できます':
      'Resume with your inquiry number and email address',
    'お問い合わせ種別': 'Inquiry type',
    'メッセージ': 'Message',
    '送信して番号を発行': 'Send & get a number',
    '送信後、お問い合わせ番号が発行されます。':
      'After sending, an inquiry number will be issued.',
    '← 戻る': '← Back',
    'お名前をご入力ください。': 'Please enter your name.',
    '正しいメールアドレスをご入力ください。': 'Please enter a valid email address.',
    'メッセージをご入力ください。': 'Please enter a message.',
    '送信先が設定されていません。お急ぎの場合はLINEよりご連絡ください。':
      'No destination is configured. If urgent, please contact us via LINE.',
    '送信しています…': 'Sending…',
    'お問い合わせ番号が発行されました': 'Your inquiry number has been issued',
    'お問い合わせ番号': 'Inquiry number',
    '番号をコピー': 'Copy number',
    'チャットを開く': 'Open chat',
    'コピーしました ✓': 'Copied ✓',
    'ご相談内容をご記入ください。': 'Please describe your inquiry.',
  };

  // Publish for the public i18n engine (browser) and tests (node).
  if (typeof window !== 'undefined') { window.HM_PUBLIC_EN = EN; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = EN; }
})();
