'use strict';

/* ════════════════════════════════════════════════════════
   CHANGELOG v2 — Timeline · Filter · Search · Collapse
   ════════════════════════════════════════════════════════ */

const CHANGELOG = [
  {
    version: 'v4.7', date: '2026-07-01', label: '最新',
    entries: [
      { type:'improve', text:'LINE通知をサーバーサイドの LINE Messaging API に移行：チャネルアクセストークンを hm-api/_config.php にサーバー保管し、hm-api/line-push.php 経由でプッシュ送信。ブラウザにトークンを一切露出しない（2025年3月に廃止された LINE Notify を置き換え）' },
      { type:'feat',    text:'LINE push エンドポイント（hm-api/line-push.php）新設：POST /v2/bot/message/push を呼び出し。APIキー＋スタッフ（admin/manager）認証・レート制限（60回/分）・selftest アクション・{ok,data,error} エンベロープに対応' },
      { type:'improve', text:'LINE設定画面を刷新：クライアント側のアクセストークン・CORSプロキシ入力欄を削除し、設定手順を Messaging API フローに書き換え。パネル名を「LINE Notify」→「LINE Messaging API」に変更' },
      { type:'fix',     text:'テスト送信ボタンのクライアント側トークンガードを撤去：トークンがサーバー保管になったため、ガードにより送信がブロックされる問題を解消' },
    ]
  },
  {
    version: 'v4.6', date: '2026-06-08',
    entries: [
      { type:'feat',    text:'メディアライブラリ v2：フォルダ管理（作成・名前変更・削除・画像の移動）を追加。フォルダピルで絞り込み表示' },
      { type:'feat',    text:'メディア検索：ファイル名によるリアルタイムフィルタリング。件数・合計サイズをステータスバーに表示' },
      { type:'feat',    text:'画像圧縮：Canvas APIを使用した最大2000px縮小・JPEG画質82%再エンコード（トグル・デフォルトON）。SVG・GIFはスキップ' },
      { type:'feat',    text:'WebP変換：アップロード時にWebP形式へ変換しファイル名を.webpにリネーム（トグル・デフォルトOFF）。非対応ブラウザはJPEGにフォールバック' },
      { type:'improve', text:'アップロード上限を5MB→10MBに引き上げ。圧縮ON時は節約バイト数をトーストで通知' },
      { type:'improve', text:'カードに圧縮・WebP・フォルダのバッジを追加。プレビューオーバーレイにファイルサイズ・日付を表示' },
    ]
  },
  {
    version: 'v4.5', date: '2026-06-08',
    entries: [
      { type:'feat', text:'モバイル管理 Phase 27A：mobile.css 刷新。ボトムナビ（5タブ）・ドロワー・44pxタッチターゲット・スワイプジェスチャー・クイックバーを実装' },
      { type:'feat', text:'モバイルダッシュボードウィジェット（Phase 27B）：本日の予約数・売上・見積り・顧客・完了率の5枚統計カードをダッシュボードに注入' },
      { type:'feat', text:'プッシュ通知（Phase 27C）：Service Worker + Push API によるブラウザプッシュ通知。新規予約・ステータス変更・見積り受信時に通知' },
      { type:'feat', text:'オフラインモード（Phase 27D）：IndexedDB（hm_offline_db）に予約・カレンダー・見積りをキャッシュ。オフライン時の書き込みをキューに保存し再接続時に自動同期' },
      { type:'feat', text:'カメラアップロード（Phase 27E）：モバイルカメラ・フォトライブラリから直接撮影・アップロード。Canvas圧縮（1200px/0.82q）後にメディアライブラリへ保存' },
    ]
  },
  {
    version: 'v4.4', date: '2026-06-07',
    entries: [
      { type:'feat', text:'高度分析エンジン（Phase 23）：線形回帰・移動平均・異常検知・予測を実装した AnalyticsEngine（純粋数学ライブラリ）' },
      { type:'feat', text:'売上予測：3ヶ月先の売上を線形回帰で予測。成長率・信頼度・異常月を表示する RevenueForecast' },
      { type:'feat', text:'サービスパフォーマンス：件数40%・売上40%・成長20%の複合スコアでサービスをランキング（ServicePerformance）' },
      { type:'feat', text:'顧客インサイト：顧客生涯価値（CLV）・解約リスク・コホート分析・リピート率（CustomerInsights）' },
      { type:'feat', text:'コンバージョン分析：見積り→予約ファネル・変換時間・サービス別コンバージョン率（ConversionAnalytics）' },
      { type:'feat', text:'分析ウィジェット：需要予測チャート・曜日別ヒートマップ・インサイトカード（AnalyticsWidgets）' },
      { type:'feat', text:'分析キャッシュ：5分TTLの localStorage キャッシュで分析計算を最適化（AnalyticsCache）' },
      { type:'feat', text:'予約トレンド：日次・週次・月次トレンド分析、成長率、ピーク検出（BookingTrends）' },
      { type:'feat', text:'分析エクスポート：売上予測・サービスランキング・顧客指標の CSV エクスポート（AnalyticsExport）' },
      { type:'feat', text:'高度分析ダッシュボード：5ウィジェットをタブ管理、go() ラップでシームレスなナビゲーション（AnalyticsDashboard）' },
    ]
  },
  {
    version: 'v4.3', date: '2026-06-07',
    entries: [
      { type:'feat', text:'請求書生成（Phase 22）：予約詳細から請求書を生成・プレビュー・PDF出力。請求書番号を自動採番し hm_invoices に保存（InvoiceManager）' },
      { type:'feat', text:'グローバル検索（Phase 22）：Ctrl+K / ⌘+K でオーバーレイ表示。予約・見積り・顧客・サービスをキーボードナビで横断検索（GlobalSearch）' },
      { type:'feat', text:'監査ログ（Phase 22）：Adapter の全書き込み操作を自動記録する500件FIFOリングバッファ。hm_audit_log に保存し監査ログビューで参照可能（AuditLog）' },
    ]
  },
  {
    version: 'v4.2', date: '2026-06-07',
    entries: [
      { type:'feat', text:'ダッシュボードレイアウト（Phase 21A）：DashboardLayout でウィジェットの表示/非表示・並び順を hm_dashboard_layout に保存' },
      { type:'feat', text:'ウィジェット表示設定モーダル（Phase 21B）：DashboardCustomizer でチェックボックスによる表示管理' },
      { type:'feat', text:'ドラッグ&ドロップ並び替え（Phase 21C）：DashboardReorder で HTML5 DnD によるウィジェットスロット並び替え' },
      { type:'feat', text:'KPI表示設定（Phase 21D）：KPIManager でダッシュボード統計カードの表示/非表示をラベルマッチングで管理' },
      { type:'feat', text:'ダッシュボードプロフィール（Phase 21E）：DashboardProfiles で Owner / Operations / Marketing の3プリセットを実装' },
    ]
  },
  {
    version: 'v4.0', date: '2026-06-07',
    entries: [
      { type:'improve', text:'モジュラーアーキテクチャ刷新（Phase 14）：admin-ui.js（5,543行）を30ファイルに分割。js/core/・js/utils/・js/modules/・js/services/ の4層構成に整理' },
      { type:'improve', text:'js/core/eventBus.js 新設：型付きイベントバス（EventBus.on/emit/off/clear）を追加' },
      { type:'improve', text:'js/core/stateManager.js 新設：エフェメラルUIステートのリアクティブコンテナ（AdminState.get/set/subscribe）を追加' },
      { type:'improve', text:'js/utils/validators.js 新設：required・email・bookingId・starRating・url など共通バリデーションヘルパーを追加' },
      { type:'improve', text:'js/utils/storage.js 新設：型安全な localStorage ラッパー（getArray・pushToArray など）を追加' },
      { type:'improve', text:'serviceRegistry.js 拡張：Auth・EventBus・AdminState・Validators・Storage を window.Services に登録' },
      { type:'improve', text:'admin.html を HTML+CSS のみに整理：インライン JS をすべて外部ファイルに移動' },
    ]
  },
  {
    version: 'v3.6', date: '2026-06-07',
    entries: [
      { type:'feat', text:'PDF直接出力（Phase 12）：全11印刷機能にPDFダウンロードボタンを追加。html2canvas+jsPDF で印刷HTMLをA4 PDFとして直接保存' },
    ]
  },
  {
    version: 'v3.5', date: '2026-06-07',
    entries: [
      { type:'improve', text:'ウェブサイト管理（Phase 11）をadminから完全削除：#view-webcontent HTML・.wc-* CSS・WC_FIELDS等8関数・contentService.js をリポジトリごと除去' },
    ]
  },
  {
    version: 'v3.4', date: '2026-06-06',
    entries: [
      { type:'improve', text:'getDashboardStats(): 7件の bookings COUNT クエリを Array.filter() に置き換え。renderDash() の API リクエスト数を22→9に削減' },
      { type:'improve', text:'getGrowthStats(): 6件の bookings COUNT クエリを Array.filter() に置き換え。追加リクエスト0件で動作' },
      { type:'fix',     text:'_invalidateKPI() のサービス人気度キャッシュキー不一致バグを修正：monthStart ではなく nDaysAgoISO(30) を使用するよう統一' },
      { type:'fix',     text:'booking:cancelled リスナーの欠落を修正：キャンセル操作後にKPI・アクティビティキャッシュが即時無効化されない問題を解消' },
      { type:'fix',     text:'StatisticsService の bookings Realtime チャンネル重複を削除：二重購読により1件の INSERT で最大31クエリ・二重再描画が発火していた問題を修正' },
      { type:'improve', text:'APIAdapter を window.api シングルトンに統合：アプリ全体でクライアントインスタンスを1つに統一' },
    ]
  },
  {
    version: 'v3.3', date: '2026-06-05',
    entries: [
      { type:'feat', text:'強制パスワード変更ゲート（Phase 10A）：デフォルトパスワードのまま利用不可、初回ログイン時に新パスワード設定を義務化' },
      { type:'feat', text:'ログイン画面事前確認バナー（Phase 10B）：env.js 認証情報をページ読み込み時に検証、設定不備をアンバーバナーで即時通知' },
      { type:'feat', text:'本番グレード HealthCheck システム（Phase 10C）：API 接続・DataProvider・サービスレジストリ・ストレージ・認証を起動時に並列チェック' },
      { type:'feat', text:'設定 → システム健全性ページ：サービス別ステータス・最終チェック日時・詳細メッセージ一覧、再チェック & ログクリアボタン' },
      { type:'feat', text:'インアプリ健全性バナー：ログイン後に正常（緑）/ 警告（黄）/ エラー（赤）バナーを表示、health:* カスタムイベント送出' },
      { type:'feat', text:'ヘルスチェックログ：hm_health_log に100件FIFOで記録、サービス・ステータス・メッセージ・タイムスタンプを保存' },
    ]
  },
  {
    version: 'v3.2', date: '2026-06-04',
    entries: [
      { type:'feat', text:'メール通知連携：EmailJS REST API を使用して新規予約・ステータス変更時に管理者へ自動メール送信（SDKなし）' },
      { type:'feat', text:'メール通知設定ページ：通知先メール・EmailJS認証情報・トリガー別ON/OFF・テンプレート変数・送信ログ・テスト送信' },
    ]
  },
  {
    version: 'v3.1', date: '2026-06-04',
    entries: [
      { type:'feat', text:'LINE通知連携：新規予約・ステータス変更（確定・完了）・見積り受信時に LINE Notify へ自動送信' },
      { type:'feat', text:'LINE通知設定ページ：トークン管理・トリガー別ON/OFF・CORSプロキシ設定・送信ログ（最新20件）・テスト送信' },
    ]
  },
  {
    version: 'v3.0', date: '2026-06-04',
    entries: [
      { type:'feat',    text:'全管理ページに印刷機能を追加（予約・見積り・レビュー・顧客・レポート・分析・バックアップ・料金・不用品・容量・カレンダー）' },
      { type:'feat',    text:'分析モジュールを全面刷新：KPIカード6枚・期間フィルター・Canvasグラフ3種・CSV出力・印刷対応' },
      { type:'feat',    text:'不用品管理をカテゴリベースに刷新：カテゴリ・アイテムのCRUD、合計処分費用のリアルタイム表示' },
      { type:'fix',     text:'renderAnalyticsCharts 内の const svcCount・const periodLabel 二重宣言バグを修正' },
    ]
  },
  {
    version: 'v2.5', date: '2026-06-03',
    entries: [
      { type:'feat',    text:'顧客管理モジュール追加：顧客一覧・プロフィールモーダル・予約履歴・削除' },
      { type:'feat',    text:'メディアライブラリ追加（初期版）：画像・動画のアップロード・プレビュー・削除' },
      { type:'feat',    text:'レビュー管理を刷新：タブ表示（保留中・承認済み・却下）・公開切替・顧客投稿フォーム対応' },
      { type:'feat',    text:'バックアップセンター追加：JSON形式のエクスポート/インポート・フルバックアップ・復元' },
      { type:'improve', text:'予約管理に顧客管理との連携（顧客IDの自動生成・履歴追跡）を追加' },
    ]
  },
  {
    version: 'v2.0', date: '2026-06-02',
    entries: [
      { type:'feat', text:'ヒーローエディター追加：見出し・サブテキスト・CTA・バッジ・背景画像・バージョン履歴管理' },
      { type:'feat', text:'サービス管理追加：サービスカードのCRUD・プレビュー・注目カード設定' },
      { type:'feat', text:'FAQ編集モジュール追加：質問・回答のCRUD・ライブプレビュー' },
      { type:'feat', text:'会社情報編集モジュール追加：会社概要行のCRUD・プレビュー' },
      { type:'feat', text:'フッター編集モジュール追加：リンク・列・著作権テキストの編集' },
      { type:'improve', text:'見積り管理に予約変換機能（予約化ボタン）を追加' },
    ]
  },
  {
    version: 'v1.5', date: '2026-06-01',
    entries: [
      { type:'feat', text:'カレンダー管理追加：日別空き状況（○/△/×）の編集・一括設定' },
      { type:'feat', text:'料金管理追加：サービスごとの基本料金・距離・階数・割増料金の設定' },
      { type:'feat', text:'容量設定追加：1日の最大予約数・残りわずか閾値の設定' },
      { type:'feat', text:'クイック操作パネル追加：主要機能へのショートカットを一覧表示' },
      { type:'feat', text:'分析ページ追加（初期版）：予約統計・完了率・満了日数のカード表示' },
    ]
  },
  {
    version: 'v1.0', date: '2026-05-30',
    entries: [
      { type:'feat', text:'管理システム初期リリース' },
      { type:'feat', text:'ログイン画面：メール・パスワード認証・セッション管理（30分）・ダークモード自動検出' },
      { type:'feat', text:'ダッシュボード：統計カード・最近の予約・アクティビティフィード・クイックアクション' },
      { type:'feat', text:'予約管理：一覧・ステータスフィルター・検索・追加・編集・削除・詳細モーダル' },
      { type:'feat', text:'見積り管理：リクエスト一覧・フィルター・CSV出力・削除' },
      { type:'feat', text:'CSV エクスポート / インポート機能' },
      { type:'feat', text:'レスポンシブレイアウト・ダークモード対応' },
    ]
  },
];

const CL_TYPE = {
  feat:    { label:'新機能',   bg:'rgba(37,99,235,.1)',   color:'#2563eb', border:'rgba(37,99,235,.2)'  },
  improve: { label:'改善',     bg:'rgba(16,185,129,.1)',  color:'#059669', border:'rgba(16,185,129,.2)' },
  fix:     { label:'バグ修正', bg:'rgba(239,68,68,.08)', color:'#b91c1c', border:'rgba(239,68,68,.18)' },
};

const CHANGELOG_NEXT = [
  { priority:'high',   text:'API Storage 統合：メディア画像をローカルストレージではなく API クラウドストレージに直接アップロード・管理' },
  { priority:'high',   text:'Google カレンダー同期：確定予約を Google カレンダーに自動追加・更新・削除' },
  { priority:'medium', text:'一括操作：予約・見積りの複数選択とまとめてステータス変更・削除・エクスポート' },
  { priority:'medium', text:'予約カレンダービュー：月次カレンダー形式で予約を視覚的に一覧表示' },
  { priority:'medium', text:'英語管理画面対応（i18n）：管理UIの日英切替サポート' },
  { priority:'medium', text:'自動バックアップ：設定した間隔で API データを自動エクスポートし、バックアップ履歴を保持' },
  { priority:'low',    text:'自動フォローアップ：引越し完了後の顧客へ自動レビュー依頼メールを送信' },
  { priority:'low',    text:'スタッフ管理：複数管理者アカウントと権限レベル（オーナー・スタッフ）の設定' },
];

const CL_PRIORITY = {
  high:   { label:'優先度：高', bg:'rgba(239,68,68,.08)',  color:'#b91c1c', border:'rgba(239,68,68,.18)'  },
  medium: { label:'優先度：中', bg:'rgba(245,158,11,.1)',  color:'#b45309', border:'rgba(245,158,11,.25)' },
  low:    { label:'優先度：低', bg:'rgba(107,114,128,.1)', color:'#4b5563', border:'rgba(107,114,128,.2)' },
};

/* ════ State ════ */
let _clFilter = 'all';
let _clSearch = '';
let _clNextOpen = true;
let _clInitialized = false;
const _clCollapsed = new Set();

/* ════ Main render ════ */
function renderChangelog() {
  const el = document.getElementById('changelogContent');
  if (!el) return;

  // Auto-collapse older versions on first render
  if (!_clInitialized) {
    CHANGELOG.forEach((_, i) => { if (i >= 2) _clCollapsed.add(i); });
    _clInitialized = true;
  }

  const totalEntries = CHANGELOG.reduce((s, v) => s + v.entries.length, 0);
  const featCount    = CHANGELOG.reduce((s, v) => s + v.entries.filter(e => e.type === 'feat').length, 0);
  const impCount     = CHANGELOG.reduce((s, v) => s + v.entries.filter(e => e.type === 'improve').length, 0);
  const fixCount     = CHANGELOG.reduce((s, v) => s + v.entries.filter(e => e.type === 'fix').length, 0);

  const isFiltered = _clFilter !== 'all' || _clSearch.trim();
  let filteredTotal = 0;
  if (isFiltered) CHANGELOG.forEach(v => { filteredTotal += _clFilterEntries(v.entries).length; });

  const iconSearch = `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
  const iconPrint  = `<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>`;

  const versionRows = CHANGELOG.map((v, i) => _renderClVersion(v, i)).join('');

  el.innerHTML = `
    <div class="cl-header">
      <div class="cl-header-info">
        <div class="cl-header-title">変更履歴</div>
        <div class="cl-stats">
          <span>${CHANGELOG.length} バージョン</span>
          <span class="cl-dot">·</span>
          ${isFiltered ? `<span>${filteredTotal} / ${totalEntries} 件</span>` : `<span>${totalEntries} 件の変更</span>`}
          <span class="cl-dot">·</span>
          <span class="cl-stat-feat">${featCount} 新機能</span>
          <span class="cl-dot">·</span>
          <span class="cl-stat-imp">${impCount} 改善</span>
          <span class="cl-dot">·</span>
          <span class="cl-stat-fix">${fixCount} 修正</span>
        </div>
      </div>
      <div class="cl-header-controls">
        <div class="media-search-wrap" style="min-width:190px">
          ${iconSearch}
          <input class="media-search" id="clSearch" type="text" placeholder="変更内容を検索..." value="${esc(_clSearch)}" oninput="filterChangelog(this.value)" />
        </div>
        <div class="cl-type-filters">
          ${_clTypeBtn('all',     'すべて',   totalEntries)}
          ${_clTypeBtn('feat',    '新機能',   featCount)}
          ${_clTypeBtn('improve', '改善',     impCount)}
          ${_clTypeBtn('fix',     'バグ修正', fixCount)}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="printChangelog()" title="変更履歴を印刷">${iconPrint}印刷</button>
      </div>
    </div>

    ${_renderClNext()}

    <div class="cl-released-row">
      <span class="cl-section-label">リリース済み</span>
      <div style="display:flex;gap:6px">
        <button class="cl-text-btn" onclick="expandAllCl()">すべて展開</button>
        <span class="cl-dot">·</span>
        <button class="cl-text-btn" onclick="collapseAllCl()">すべて折りたたむ</button>
      </div>
    </div>

    <div class="cl-timeline">${versionRows}</div>`;
}

/* ════ Type filter button ════ */
function _clTypeBtn(type, label, count) {
  const active = _clFilter === type;
  return `<button class="cl-type-btn${active ? ' active' : ''}" onclick="setClFilter('${type}')">${label}<span class="cl-pill">${count}</span></button>`;
}

/* ════ "What's Next" panel ════ */
function _renderClNext() {
  const chevron = `<svg viewBox="0 0 24 24" width="14" height="14" class="cl-chevron${_clNextOpen ? '' : ' collapsed'}"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>`;
  const high = CHANGELOG_NEXT.filter(i => i.priority === 'high').length;
  const med  = CHANGELOG_NEXT.filter(i => i.priority === 'medium').length;
  const low  = CHANGELOG_NEXT.filter(i => i.priority === 'low').length;

  let h = `<div class="cl-next-panel">
    <div class="cl-next-head" onclick="toggleClNext()">
      <svg viewBox="0 0 24 24" width="15" height="15" style="color:#7c3aed;flex-shrink:0"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
      <span class="cl-next-title">次のバージョン予定</span>
      <span class="cl-next-count">${CHANGELOG_NEXT.length}件</span>
      <span class="cl-priority-summary">
        <span style="color:#b91c1c;font-weight:600">高 ${high}</span>
        <span class="cl-dot">·</span>
        <span style="color:#b45309;font-weight:600">中 ${med}</span>
        <span class="cl-dot">·</span>
        <span style="color:#6b7280;font-weight:600">低 ${low}</span>
      </span>
      ${chevron}
    </div>`;

  if (_clNextOpen) {
    h += `<div class="cl-next-body">` +
      CHANGELOG_NEXT.map(item => {
        const p = CL_PRIORITY[item.priority];
        return `<div class="cl-next-item">
          <span class="cl-badge" style="background:${p.bg};color:${p.color};border:1px solid ${p.border}">${p.label}</span>
          <span class="cl-entry-text">${esc(item.text)}</span>
        </div>`;
      }).join('') +
      `</div>`;
  }

  return h + `</div>`;
}

/* ════ Version block ════ */
function _renderClVersion(ver, vi) {
  const isLatest    = vi === 0;
  const isCollapsed = _clCollapsed.has(vi);
  const filtered    = _clFilterEntries(ver.entries);

  // Hide version entirely when filter yields no results
  if (filtered.length === 0 && (_clFilter !== 'all' || _clSearch.trim())) return '';

  const chevron = `<svg viewBox="0 0 24 24" width="14" height="14" class="cl-chevron${isCollapsed ? ' collapsed' : ''}"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>`;
  const latestBadge = isLatest
    ? `<span class="cl-latest-badge">最新</span>` : '';
  const countLabel = filtered.length !== ver.entries.length
    ? `${filtered.length} / ${ver.entries.length}件` : `${ver.entries.length}件`;

  let h = `<div class="cl-ver${isLatest ? ' cl-ver-latest' : ''}${isCollapsed ? ' cl-ver-collapsed' : ''}" id="clver-${vi}">
    <div class="cl-ver-head" onclick="toggleClVersion(${vi})">
      <span class="cl-ver-num">${esc(ver.version)}</span>
      ${latestBadge}
      <span class="cl-ver-date">${esc(ver.date)}</span>
      <span class="cl-ver-count">${countLabel}</span>
      ${chevron}
    </div>`;

  if (!isCollapsed) {
    h += `<div class="cl-ver-body">` +
      (filtered.length === 0
        ? `<div class="cl-empty">このバージョンには一致する変更がありません</div>`
        : filtered.map(entry => {
            const t = CL_TYPE[entry.type] || CL_TYPE.feat;
            return `<div class="cl-entry">
              <span class="cl-badge" style="background:${t.bg};color:${t.color};border:1px solid ${t.border}">${t.label}</span>
              <span class="cl-entry-text">${_clHighlight(entry.text)}</span>
            </div>`;
          }).join('')
      ) +
      `</div>`;
  }

  return h + `</div>`;
}

/* ════ Filter helpers ════ */
function _clFilterEntries(entries) {
  let out = entries;
  if (_clFilter !== 'all') out = out.filter(e => e.type === _clFilter);
  if (_clSearch.trim()) {
    const q = _clSearch.toLowerCase();
    out = out.filter(e => e.text.toLowerCase().includes(q));
  }
  return out;
}

function _clHighlight(rawText) {
  const escaped = esc(rawText);
  if (!_clSearch.trim()) return escaped;
  try {
    const q = _clSearch.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(`(${q})`, 'gi'), '<mark class="cl-mark">$1</mark>');
  } catch(e) {
    return escaped;
  }
}

/* ════ Interactions ════ */
function setClFilter(type) {
  _clFilter = type;
  renderChangelog();
  setTimeout(() => document.getElementById('clSearch')?.focus(), 0);
}

function filterChangelog(val) {
  _clSearch = val;
  renderChangelog();
}

function toggleClNext() {
  _clNextOpen = !_clNextOpen;
  renderChangelog();
}

function toggleClVersion(vi) {
  if (_clCollapsed.has(vi)) _clCollapsed.delete(vi);
  else _clCollapsed.add(vi);
  // Partial DOM swap — no full re-render needed
  const el = document.getElementById(`clver-${vi}`);
  if (!el) { renderChangelog(); return; }
  const tmp = document.createElement('div');
  tmp.innerHTML = _renderClVersion(CHANGELOG[vi], vi);
  if (tmp.firstElementChild) el.replaceWith(tmp.firstElementChild);
}

function expandAllCl() {
  _clCollapsed.clear();
  renderChangelog();
}

function collapseAllCl() {
  CHANGELOG.forEach((_, i) => _clCollapsed.add(i));
  renderChangelog();
}

/* ════ Print ════ */
function printChangelog() {
  const totalEntries = CHANGELOG.reduce((s, v) => s + v.entries.length, 0);
  const e = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const now = new Date();

  const badge = (bg, color, border, label) =>
    `<span style="display:inline-flex;align-items:center;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${bg};color:${color};border:1px solid ${border};white-space:nowrap;flex-shrink:0">${label}</span>`;

  const versionsHtml = CHANGELOG.map(ver => {
    const entries = ver.entries.map(entry => {
      const t = CL_TYPE[entry.type] || CL_TYPE.feat;
      return `<div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #f0f2f5">
        ${badge(t.bg, t.color, t.border, t.label)}
        <span style="font-size:12px;color:#374151;line-height:1.55">${e(entry.text)}</span>
      </div>`;
    }).join('');

    return `<div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f8f9fa;border-bottom:1px solid #e5e7eb">
        <span style="font-size:14px;font-weight:700;color:#0b0f17">${e(ver.version)}</span>
        ${ver.label === '最新' ? badge('rgba(16,185,129,.12)','#059669','rgba(16,185,129,.25)','最新') : ''}
        <span style="font-size:11px;color:#9ca3af">${e(ver.date)}</span>
        <span style="font-size:11px;color:#9ca3af;margin-left:auto">${ver.entries.length}件</span>
      </div>
      <div style="padding:0 14px">${entries}</div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>変更履歴 — Hello Moving 管理システム</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,'Hiragino Sans','Meiryo',sans-serif;font-size:13px;color:#0b0f17;background:#fff;padding:32px 36px}@media print{body{padding:0}@page{margin:16mm 14mm;size:A4 portrait}}</style>
</head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #0a1f44;margin-bottom:24px">
  <div style="display:flex;align-items:center;gap:12px">
    <div style="width:40px;height:40px;border-radius:10px;background:#1D9E75;color:#fff;font-size:20px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">H</div>
    <div><div style="font-size:17px;font-weight:700;color:#0a1f44">Hello Moving</div><div style="font-size:10px;color:#6b7280;margin-top:1px">管理システム</div></div>
  </div>
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:700;color:#0a1f44">変更履歴</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:4px">${CHANGELOG.length} バージョン · ${totalEntries} 件 · ${now.toLocaleDateString('ja-JP')} 出力</div>
  </div>
</div>
${versionsHtml}
<div style="padding-top:14px;border-top:1px solid #e5e7eb;margin-top:8px;font-size:10px;color:#9ca3af;text-align:center">Hello Moving 管理システム — 変更履歴</div>
<script>window.onload=function(){setTimeout(function(){window.print();},300);window.onafterprint=function(){window.close();};}<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=860,height=760');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}

/* ════ System Status Report (kept for backward compatibility) ════ */
function printBackup() {
  const bk      = Adapter.getBookings();
  const quotes  = Adapter.getQuotes();
  const reviews = Adapter.getReviews();
  const custs   = Adapter.getCustomers();
  const prices  = Adapter.getPrices();
  const disp    = Adapter.getDisposal();
  const e       = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const now     = new Date();

  const bkStatus = {新規:0,確認中:0,確定:0,完了:0,キャンセル:0};
  bk.forEach(b => { if (bkStatus[b.status]!==undefined) bkStatus[b.status]++; });
  const lastBk = bk.slice().sort((a,b)=>(b.createdAt||'')>(a.createdAt||'')?1:-1)[0];

  const revPending   = reviews.filter(r=>r.status==='pending').length;
  const revApproved  = reviews.filter(r=>r.status==='approved').length;
  const revPublished = reviews.filter(r=>r.status==='approved'&&r.published).length;
  const avgRating    = reviews.length ? (reviews.reduce((s,r)=>s+(r.rating||5),0)/reviews.length).toFixed(1) : '—';

  const priceRows = Object.entries(prices).map(([svc, cfg]) => {
    const base = typeof cfg==='number' ? cfg : (cfg&&cfg.base)||0;
    return `<tr><td style="padding:6px 12px;font-size:12px;color:#374151;border-bottom:1px solid #f0f2f5">${e(svc)}</td><td style="padding:6px 12px;font-size:12px;font-weight:600;color:#0b0f17;border-bottom:1px solid #f0f2f5;text-align:right">¥${base.toLocaleString()}</td></tr>`;
  }).join('');

  const totalDispItems   = disp.categories.reduce((s,c)=>s+c.items.length,0);
  const enabledDispItems = disp.categories.reduce((s,c)=>s+c.items.filter(i=>i.enabled).length,0);

  const statCard = (label, value, sub='', color='#0b0f17') =>
    `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${e(label)}</div>
      <div style="font-size:20px;font-weight:700;color:${color};line-height:1.1">${e(value)}</div>
      ${sub?`<div style="font-size:10px;color:#9ca3af;margin-top:3px">${e(sub)}</div>`:''}
    </div>`;

  const section = title =>
    `<div style="font-size:12px;font-weight:700;color:#0a1f44;letter-spacing:.05em;text-transform:uppercase;padding-bottom:6px;border-bottom:1px solid #e5e7eb;margin:24px 0 10px">${title}</div>`;

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>システム状況レポート — Hello Moving</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,'Hiragino Sans','Meiryo','Yu Gothic',sans-serif;font-size:13px;color:#0b0f17;background:#fff;padding:32px 36px}@media print{body{padding:0}@page{margin:16mm 14mm;size:A4 portrait}}</style>
</head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #0a1f44;margin-bottom:24px">
  <div style="display:flex;align-items:center;gap:12px">
    <div style="width:40px;height:40px;border-radius:10px;background:#1D9E75;color:#fff;font-size:20px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">H</div>
    <div><div style="font-size:17px;font-weight:700;color:#0a1f44;line-height:1.2">Hello Moving</div><div style="font-size:10px;color:#6b7280;margin-top:1px">ハローム―ビング</div></div>
  </div>
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:700;color:#0a1f44">システム状況レポート</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:4px">出力日時: ${now.toLocaleString('ja-JP')}</div>
  </div>
</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
  ${statCard('総予約数',bk.length+'件',`最終受付: ${lastBk?lastBk.createdAt.slice(0,10):'—'}`)}
  ${statCard('見積り',quotes.length+'件','受付済み合計','#2563eb')}
  ${statCard('レビュー',reviews.length+'件',`公開中 ${revPublished}件`,'#8b5cf6')}
  ${statCard('顧客',custs.length+'件','登録済み合計','#059669')}
</div>
${section('予約ステータス別')}
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
  ${Object.entries(bkStatus).map(([st,n])=>statCard(st,n+'件')).join('')}
</div>
${section('レビュー内訳')}
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
  ${statCard('保留中',revPending+'件','','#b45309')}
  ${statCard('承認済み',revApproved+'件','','#059669')}
  ${statCard('公開中',revPublished+'件','','#059669')}
  ${statCard('平均評価',avgRating+'★',`${reviews.length}件のレビュー`,'#f59e0b')}
</div>
${section('料金設定スナップショット')}
<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
  <thead><tr>
    <th style="background:#f8f9fa;font-weight:600;text-align:left;padding:7px 12px;border-bottom:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">サービス</th>
    <th style="background:#f8f9fa;font-weight:600;text-align:right;padding:7px 12px;border-bottom:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">基本料金</th>
  </tr></thead>
  <tbody>${priceRows}</tbody>
</table>
${section('不用品管理')}
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
  ${statCard('カテゴリ数',disp.categories.length+'件')}
  ${statCard('総アイテム数',totalDispItems+'件')}
  ${statCard('有効アイテム',enabledDispItems+'件','','#059669')}
</div>
<div style="display:flex;justify-content:space-between;align-items:flex-end;padding-top:14px;border-top:1px solid #e5e7eb;margin-top:24px">
  <div style="font-size:10px;color:#9ca3af;line-height:1.7"><div>Hello Moving — 管理システム</div><div>このドキュメントは管理システムから自動生成されました</div></div>
  <div style="text-align:right;font-size:11px;color:#6b7280;line-height:1.7"><div style="font-weight:600;color:#0b0f17">Hello Moving</div><div>contact@hello-moving.com</div></div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},350);window.onafterprint=function(){window.close();};}<\/script>
</body></html>`;

  const w = window.open('','_blank','width=860,height=760');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}
