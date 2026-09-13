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
    // Booking/estimate form example placeholders (attributes only — the field
    // values, names and API payloads are untouched).
    '例：山田 太郎': 'e.g. Taro Yamada',
    '例：taro@example.com': 'e.g. taro@example.com',
    '例：090-1234-5678': 'e.g. 090-1234-5678',
    '処分したい家具・家電など（例：古いソファ1点、冷蔵庫1点）':
      'Furniture/appliances to dispose of (e.g. 1 old sofa, 1 fridge)',

    /* ── Legal-page footer nav (privacy · terms · cancellation policy) ───── */
    'トップ': 'Home',
    'プライバシーポリシー': 'Privacy Policy',
    '利用規約': 'Terms of Service',
    'キャンセルポリシー': 'Cancellation Policy',

    /* ── Cancellation Policy (/cancellation-policy.html) ───────────────────
       Reference translation of the Japanese policy. The Japanese page is the
       authoritative version and is never modified; a missing entry here simply
       renders the Japanese. The fee schedule is a faithful rendering — no rule,
       fee or exception is added, removed or reinterpreted here. */
    'キャンセルポリシー ｜ Hello Moving': 'Cancellation Policy | Hello Moving',
    '施行日：2026年9月13日': 'Effective date: September 13, 2026',
    'Hello Moving（ハロームービング。以下「当社」といいます。）のサービスをご利用いただき、誠にありがとうございます。本キャンセルポリシー（以下「本ポリシー」といいます。）は、当社が提供する引越し・運送、不用品回収・処分、家具の組立・分解その他のサービス（以下「本サービス」といいます。）について、ご予約のキャンセルおよび作業日の変更に関する取扱いを定めるものです。ご予約のキャンセルまたは作業日の変更をご希望の場合は、できるだけ早めにご連絡くださいますようお願いいたします。':
      'Thank you for choosing Hello Moving ("we" or "us"). This Cancellation Policy (the "Policy") sets out how cancellations and changes to the service date are handled for the moving and transport, disposal and removal, furniture assembly and disassembly, and other services we provide (the "Services"). If you need to cancel your booking or change the service date, please contact us as early as possible. This English text is a reference translation. In the event of any discrepancy, the Japanese version prevails.',

    /* 1 — Confirmation of your booking */
    'ご予約の確定について': 'Confirmation of Your Booking',
    '本サービスのお申し込み後、当社から作業内容および作業日時の確定についてご連絡した時点で、ご予約が確定したものとします。':
      'Your booking is considered confirmed at the point we contact you to confirm the scope of work and the date and time of service.',
    '本ポリシーに定めるキャンセル料金は、ご予約が確定した後にキャンセルまたは作業日の変更をされた場合に適用されます。':
      'The cancellation fees set out in this Policy apply where a booking is cancelled, or the service date changed, after the booking has been confirmed.',

    /* 2 — Cancellation fees */
    'キャンセル料金': 'Cancellation Fees',
    'ご予約確定後のキャンセルおよび作業日の変更については、そのご連絡をいただいた時期に応じて、以下のキャンセル料金を申し受けます。':
      'If you cancel a confirmed booking or change the service date, the following cancellation fees apply, according to when we receive your notice.',
    'キャンセル・変更の時期': 'Timing of cancellation / change',
    '作業日の3日前まで': 'Up to 3 days before the service date',
    '無料': 'Free',
    '作業日の2日前': '2 days before the service date',
    '予約金額の20%': '20% of the booking amount',
    '作業日の前日': 'The day before the service date',
    '予約金額の30%': '30% of the booking amount',
    '作業日当日': 'On the service date',
    '予約金額の50%': '50% of the booking amount',
    '※ キャンセル料金の対象には、ご予約のキャンセルだけでなく、作業予定日の変更も含まれます。':
      '* Cancellation fees apply not only to cancelling a booking, but also to changing the scheduled service date.',
    '※ キャンセル料金の適用時期は、お客様からのご連絡が当社に到達した日時を基準として判断します。':
      '* The applicable timing is determined by the date and time your notice reaches us.',
    '※ 「予約金額」とは、ご予約確定時に当社からご案内した作業一式の金額をいいます。':
      '* "Booking amount" means the total amount for the work as quoted by us when your booking was confirmed.',

    /* 3 — How to notify us */
    'キャンセル・作業日変更のご連絡方法': 'How to Notify Us of a Cancellation or Date Change',
    'キャンセルまたは作業日の変更をご希望の場合は、マイページ、または当社が指定する連絡方法により、できるだけ早めにご連絡ください。':
      'If you wish to cancel or change the service date, please contact us as early as possible via My Page or another method designated by us.',
    '作業日が近づいてからのキャンセル・変更につきましては、スタッフおよび車両の手配、資材の準備等の関係上、前条のキャンセル料金が発生します。':
      'For cancellations or changes made close to the service date, the cancellation fees above apply, as staff and vehicles must be arranged and materials prepared in advance.',

    /* 4 — Changes to fees and scope of work */
    '料金・作業内容の変更について': 'Changes to Fees and Scope of Work',
    'ご予約後に、次に掲げる事項について当初のお申し込み内容から変更が生じた場合、事前にご案内した料金または作業条件が変更となることがあります。':
      'If any of the following differs from your original request after your booking is made, the fees or service conditions previously quoted may change.',
    '荷物の量、種類または内容': 'The volume, type or contents of your belongings',
    '作業範囲（梱包・開梱、家具の組立・分解、不用品回収の有無等）':
      'The scope of work (packing and unpacking, furniture assembly and disassembly, whether disposal is included, etc.)',
    '搬出先および搬入先の環境（建物の種別、階数、エレベーターの有無等）':
      'The conditions at the pickup and delivery locations (building type, floor, availability of an elevator, etc.)',
    '階段、通路、共用部その他の搬出入経路の状況':
      'The condition of stairs, corridors, common areas and other access routes',
    '作業車両の駐車・接車の可否その他の現地条件':
      'Whether the vehicle can park or pull up to the property, and other on-site conditions',
    'その他お客様から当社にご申告いただいた内容': 'Any other information you provided to us',
    'これらの変更により料金または作業条件が変更となる場合は、作業開始前にお客様へご説明し、ご確認をいただいたうえで対応いたします。':
      'Where such changes affect the fees or service conditions, we will explain them to you and obtain your confirmation before work begins.',

    /* 5 — Work cannot be carried out on the day */
    '当日の作業実施が困難な場合': 'If the Work Cannot Be Carried Out on the Day',
    '作業当日に、前条の変更その他の事情により、ご予約内容のとおりに作業を実施することが困難であると当社が判断した場合は、お客様とご相談のうえ、作業範囲の調整、作業日の変更その他の適切な対応を行います。':
      'If, on the service date, we determine that the work cannot be carried out as booked due to the changes above or other circumstances, we will consult with you and take appropriate action, such as adjusting the scope of work or rescheduling the service date.',

    /* 6 — Weather, disasters, traffic */
    '天候・災害・交通事情等による変更': 'Changes Due to Weather, Disasters or Traffic',
    '悪天候、災害、交通事情その他やむを得ない事情により、予定どおりに本サービスを提供することが困難となる場合があります。':
      'Severe weather, disasters, traffic conditions or other unavoidable circumstances may make it difficult to provide the Services as scheduled.',
    'この場合は、お客様とご相談のうえ、作業日の変更等、適切な対応を行います。':
      'In such cases, we will consult with you and take appropriate action, such as rescheduling the service date.',

    /* 7 — Other */
    'その他': 'Other',
    '本ポリシーに定めのない事項については、個別のご予約内容および当社からのご案内に基づき対応いたします。':
      'Matters not covered by this Policy will be handled in accordance with the terms of your individual booking and the guidance provided by us.',
    '本ポリシーの内容は、必要に応じて変更する場合があります。変更後の内容は、当社ウェブサイトに掲載した時点から適用されます。':
      'This Policy may be revised as necessary. Any revised version applies from the time it is published on our website.',

    /* 8 — Contact */
    '本ポリシーに関するご不明な点は、マイページまたは当社お問い合わせ窓口までご連絡ください。':
      'If you have any questions about this Policy, please contact us via My Page or our customer contact desk.',
    'お問い合わせはこちら': 'Contact us here',
    'Hello Moving（ハロームービング）／ 国土交通省 認可運送事業者 第 431320058126 号':
      'Hello Moving / Licensed moving company, Ministry of Land, Infrastructure, Transport and Tourism — License No. 431320058126',

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
    // Profile card (portalV2 renderProfile) — labels only; the values are customer
    // data and are never translated.
    'お客様プロフィール': 'Customer profile',
    'メール': 'Email',
    'ご利用回数': 'Bookings',
    '初回ご利用': 'First booking',
    '最終ご利用': 'Latest booking',
    // Booking history section + table header + pager.
    'ご利用履歴': 'Booking history',
    '受付日': 'Received',
    '前へ': 'Previous',
    '次へ': 'Next',
    'まだご利用履歴はありません': 'No bookings yet',
    // Message composer + empty state. NOTE: message bubbles themselves are skipped
    // by the engine (customer content) and always stay as written.
    'まだメッセージはありません': 'No messages yet',
    '送信': 'Send',
    'メッセージを入力…': 'Type a message…',
    // Shared loading / error states for the three portal panels.
    '読み込み中…': 'Loading…',
    'プロフィール情報を取得できません': 'Could not load your profile',
    'ご利用履歴を読み込めませんでした。': 'Could not load your booking history.',
    'メッセージを読み込めませんでした。': 'Could not load messages.',
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
