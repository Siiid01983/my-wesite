'use strict';

/* ════════════════════════════════════════════════════════
   I18N — ENGLISH ADMIN UI  (Phase 19)
   ════════════════════════════════════════════════════════
   Toggles the admin panel between Japanese (default) and
   English via a DOM-text-replacement pass.

   Strategy: render functions remain Japanese (source of
   truth). After every go() call I18n.applyToDOM() walks
   text nodes in #adminApp and replaces known Japanese
   strings with their English equivalents.  Only exact
   whole-node matches are replaced, so untranslated
   customer data is never accidentally overwritten.

   Public API:
     I18n.getLang()           → 'ja' | 'en'
     I18n.setLang(lang)       → store + re-apply + refresh sidebar
     I18n.t(jaStr)            → English if en-mode, else jaStr
     I18n.applyToDOM(root)    → translate text nodes in root
   ════════════════════════════════════════════════════════ */

window.I18n = (function () {
  'use strict';

  const LANG_KEY = 'hm_lang';
  let _lang = localStorage.getItem(LANG_KEY) || 'ja';

  /* ── Translation map (Japanese → English) ──────────── */
  const EN = {

    /* Sidebar / Navigation labels */
    '管理':              'Manage',
    'コンテンツ':        'Content',
    '設定':              'Settings',
    'その他':            'Other',
    'ダッシュボード':    'Dashboard',
    '予約管理':          'Bookings',
    '顧客管理':          'Customers',
    '見積り管理':        'Quotes',
    'カレンダー管理':    'Calendar',
    '分析':              'Analytics',
    '料金管理':          'Pricing',
    '容量設定':          'Capacity',
    '不用品管理':        'Disposal',
    'サービス管理':      'Services',
    'FAQ編集':           'FAQ Editor',
    '会社情報編集':      'Company Info',
    'フッター編集':      'Footer',
    'ヒーロー編集':      'Hero Section',
    'レビュー管理':      'Reviews',
    'バックアップ':      'Backup',
    'メール通知設定':    'Email Notifications',
    'LINE通知設定':      'LINE Notifications',
    'メディアライブラリ': 'Media Library',
    'セキュリティ':      'Security',
    'システム健全性':    'System Health',
    '変更履歴':          'Changelog',
    'ダークモード':      'Dark Mode',
    'サイトを表示':      'View Site',

    /* Session / auth */
    'ログアウト':                    'Log Out',
    'セッション残り時間: --分':      'Session: --min',
    'ログイン':                      'Login',

    /* Booking statuses */
    '新規':     'New',
    '確認中':   'Pending',
    '確定':     'Confirmed',
    '完了':     'Completed',
    'キャンセル': 'Cancelled',

    /* Calendar availability */
    '空き':       'Available',
    '残りわずか': 'Limited',
    '満了':       'Full',
    '○ 空き':    '○ Available',
    '△ 残りわずか': '△ Limited',
    '× 満了':    '× Full',

    /* Calendar day abbreviations (exact single-char dow headers) */
    '日': 'Su',
    '月': 'Mo',
    '火': 'Tu',
    '水': 'We',
    '木': 'Th',
    '金': 'Fr',
    '土': 'Sa',

    /* Month names */
    '1月':  'Jan', '2月':  'Feb', '3月':  'Mar', '4月':  'Apr',
    '5月':  'May', '6月':  'Jun', '7月':  'Jul', '8月':  'Aug',
    '9月':  'Sep', '10月': 'Oct', '11月': 'Nov', '12月': 'Dec',

    /* Common action buttons */
    '保存':         'Save',
    '追加':         'Add',
    '削除':         'Delete',
    '編集':         'Edit',
    '閉じる':       'Close',
    '更新':         'Update',
    '適用':         'Apply',
    '印刷':         'Print',
    'リセット':     'Reset',
    '全リセット':   'Reset All',
    'テスト送信':   'Test Send',
    '送信':         'Send',
    '取消':         'Cancel',
    'キャンセル済': 'Cancelled',
    '表示':         'Show',
    'コピー':       'Copy',
    'エクスポート': 'Export',
    'インポート':   'Import',
    '検索':         'Search',
    '確認':         'Confirm',
    '一括選択':     'Bulk Select',
    '一括選択を終了': 'Exit Bulk Select',
    '全選択':       'Select All',
    '選択解除':     'Deselect All',
    'プレビュー':   'Preview',
    'ダウンロード': 'Download',
    '公開':         'Publish',
    '非公開':       'Unpublish',
    '承認':         'Approve',
    '却下':         'Reject',
    '複製':         'Duplicate',
    '移動':         'Move',
    '新規作成':     'New',
    '変換':         'Convert',
    '予約に変換':   'Convert to Booking',
    'テスト':       'Test',
    'クリア':       'Clear',
    '戻る':         'Back',
    '次へ':         'Next',
    '前へ':         'Prev',
    '選択日に適用': 'Apply to Selected',
    '今すぐ更新':   'Update Now',
    '今すぐ同期':   'Sync Now',
    '今すぐ確認 & 送信': 'Check & Send Now',
    'Googleで認証': 'Connect with Google',
    '切断':         'Disconnect',
    '接続中':       'Connected',
    '未接続':       'Not Connected',

    /* PDF / Print / CSV */
    'PDF': 'PDF',
    'CSV出力': 'Export CSV',
    'CSV':  'CSV',
    'レポート': 'Report',
    'レポート生成': 'Generate Report',

    /* Common form labels */
    'お客様名':     'Customer Name',
    '電話番号':     'Phone',
    'メールアドレス': 'Email',
    'メール':       'Email',
    '引越し日':     'Move Date',
    '引越し元':     'From Address',
    '引越し先':     'To Address',
    'サービス':     'Service',
    'ステータス':   'Status',
    '備考':         'Notes',
    '金額':         'Amount',
    '合計':         'Total',
    '日付':         'Date',
    '時間':         'Time',
    '住所':         'Address',
    '詳細':         'Details',
    '名前':         'Name',
    '評価':         'Rating',
    '件名':         'Subject',
    'タイトル':     'Title',
    '説明':         'Description',
    '内容':         'Content',
    '価格':         'Price',
    'カテゴリー':   'Category',
    'カテゴリ':     'Category',
    '並び順':       'Order',
    '有効':         'Enabled',
    '無効':         'Disabled',
    '公開中':       'Published',
    '非公開中':     'Unpublished',
    '未承認':       'Pending',
    '承認済み':     'Approved',

    /* Panel / section titles */
    '予約一覧':           'Booking List',
    '予約詳細':           'Booking Details',
    '新規予約':           'New Booking',
    '予約を編集':         'Edit Booking',
    '顧客情報':           'Customer Info',
    '料金設定':           'Pricing Settings',
    '基本料金':           'Base Price',
    '空き状況':           'Availability',
    'カレンダー設定':     'Calendar Settings',
    '通知設定':           'Notification Settings',
    '通知トリガー':       'Notification Triggers',
    '送信ログ':           'Send Log',
    '設定手順':           'Setup Guide',
    '送信済み':           'Sent',
    'テンプレート変数':   'Template Variables',
    'システム監視':       'System Monitor',
    'キャッシュ状態':     'Cache Status',
    'フォローアップメール': 'Follow-up Emails',
    '引越し完了後のフォロー': 'Post-move Follow-up',
    '送信タイミング':     'Send Timing',
    'フォローアップ Template ID': 'Follow-up Template ID',
    'Google カレンダー連携': 'Google Calendar Sync',
    '同期方向':           'Sync Direction',
    '同期ログ':           'Sync Log',
    '双方向（推奨）':     'Two-way (Recommended)',
    'プッシュのみ → Google': 'Push only → Google',
    'プルのみ ← Google':  'Pull only ← Google',

    /* Bookings table headers */
    '予約番号':   'Ref #',
    '引越し元住所': 'From',
    '引越し先住所': 'To',
    '希望時間帯': 'Preferred Time',
    '登録日':     'Registered',
    '操作':       'Actions',
    '絞り込み':   'Filter',
    '全て':       'All',
    '期間':       'Period',
    '今日':       'Today',
    '今週':       'This Week',
    '今月':       'This Month',
    '3ヶ月':      '3 Months',

    /* Topbar quick actions */
    '予約を追加':  'Add Booking',

    /* Dashboard stats */
    '今日の予約':    "Today's Bookings",
    '今週の予約':    'This Week',
    '今月の予約':    'This Month',
    '今月の売上':    'Revenue This Month',
    '確定済み':      'Confirmed',
    '完了済み':      'Completed',
    '満了日数':      'Fully Booked Days',
    'キャンセル率':  'Cancel Rate',
    'フォールバック': 'Fallback',
    'リトライ':      'Retries',
    '最終同期':      'Last Sync',
    'ヒット率':      'Hit Rate',
    'レイテンシ':    'Latency',
    'API':      'API',
    'オンライン':    'Online',
    'オフライン':    'Offline',

    /* Pricing */
    '基本料金を設定':  'Set base prices',
    '追加オプション': 'Add-ons',

    /* Reviews */
    'レビュー一覧':  'Review List',
    '口コミ':        'Reviews',

    /* Security */
    'パスワード変更': 'Change Password',
    '現在のパスワード': 'Current Password',
    '新しいパスワード': 'New Password',
    '確認用パスワード': 'Confirm Password',

    /* Media */
    'アップロード':  'Upload',
    'ファイルを選択': 'Choose File',
    'ドラッグ&ドロップ': 'Drag & Drop',

    /* Misc */
    '件':        ' items',
    '件選択中':  ' selected',
    'まだデータがありません': 'No data yet',
    'まだ送信履歴がありません': 'No send history yet',
    '読み込み中': 'Loading…',
    'エラー':    'Error',
    '成功':      'Success',
    '失敗':      'Failed',
    '接続エラー': 'Connection Error',
    '保存しました': 'Saved',
    '削除しました': 'Deleted',
    '更新しました': 'Updated',
    '追加しました': 'Added',
    'コピーしました': 'Copied',
    'リセットしました': 'Reset',
    'EN':        '日本語',

    /* Topbar title mirror (set by go()) */
    'クイック操作':   'Quick Actions',
  };

  /* ── Public: get / set language ──────────────────────── */
  function getLang() { return _lang; }

  function setLang(lang) {
    _lang = lang;
    localStorage.setItem(LANG_KEY, lang);
    _updateToggleBtn();
    /* Re-render current view so render fns run first, then we translate */
    const active = document.querySelector('.view.active');
    if (active && typeof go === 'function') {
      go(active.id.replace('view-', ''));
    } else {
      applyToDOM(document.getElementById('adminApp') || document.body);
    }
  }

  /* ── Public: translate a single string ───────────────── */
  function t(jaStr) {
    return (_lang === 'en' && EN[jaStr]) ? EN[jaStr] : jaStr;
  }

  /* ── Public: walk DOM and replace text nodes ─────────── */
  function applyToDOM(root) {
    if (!root || _lang !== 'en') return;

    /* Text nodes — exact whole-node match only */
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          const tag = p.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' ||
              tag === 'TEXTAREA' || tag === 'INPUT') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    for (const node of nodes) {
      const raw     = node.textContent;
      const trimmed = raw.trim();
      if (trimmed && EN[trimmed] !== undefined) {
        node.textContent = raw.replace(trimmed, EN[trimmed]);
      }
    }

    /* <option> elements */
    root.querySelectorAll('option').forEach(opt => {
      const tr = EN[opt.textContent.trim()];
      if (tr !== undefined) opt.textContent = tr;
    });

    /* placeholder attributes */
    root.querySelectorAll('[placeholder]').forEach(el => {
      const tr = EN[el.getAttribute('placeholder').trim()];
      if (tr !== undefined) el.setAttribute('placeholder', tr);
    });

    /* title attributes (tooltips) */
    root.querySelectorAll('[title]').forEach(el => {
      const tr = EN[el.getAttribute('title').trim()];
      if (tr !== undefined) el.setAttribute('title', tr);
    });
  }

  /* ── Internal ─────────────────────────────────────────── */
  function _updateToggleBtn() {
    const btn = document.getElementById('langToggleBtn');
    if (btn) btn.textContent = _lang === 'en' ? '日本語' : 'EN';
  }

  /* Apply once on load for static sidebar + login screen */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      _updateToggleBtn();
      applyToDOM(document.body);
    });
  } else {
    _updateToggleBtn();
    applyToDOM(document.body);
  }

  return { getLang, setLang, t, applyToDOM };

})();
