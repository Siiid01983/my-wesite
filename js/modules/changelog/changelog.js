'use strict';

/* ════════════════════════════════════════════════════════
   CHANGELOG
   ════════════════════════════════════════════════════════ */
const CHANGELOG = [
  {
    version: 'v3.6', date: '2026-06-07', label: '最新',
    entries: [
      { type:'feat',    text:'PDF直接出力（Phase 12）：全11印刷機能にPDFダウンロードボタンを追加。html2canvas+jsPDFで印刷HTMLをキャプチャしA4 PDFとして直接保存。印刷ダイアログ不要' },
    ]
  },
  {
    version: 'v3.5', date: '2026-06-07',
    entries: [
      { type:'improve', text:'ウェブサイト管理（Phase 11）をadminから完全削除：#view-webcontent HTML、.wc-* CSS、WC_FIELDS・switchWcTab・renderWebContent等8関数、contentService.jsをリポジトリごと除去' },
    ]
  },
  {
    version: 'v3.4', date: '2026-06-06',
    entries: [
      { type:'improve', text:'getDashboardStats(): 7件のbookings COUNTクエリをArray.filter()に置き換え。_getBookingsRaw()キャッシュを共有利用し、renderDash()のSupabaseリクエスト数を22→9に削減' },
      { type:'improve', text:'getGrowthStats(): 6件のbookings COUNTクエリをArray.filter()に置き換え。同一_rawBkInflightプロミスを共有するため追加リクエスト0件で動作' },
      { type:'fix',     text:'_invalidateKPI()のサービス人気度キャッシュキー不一致バグを修正：monthStartではなくnDaysAgoISO(30)を使用するように統一し、KPI無効化後も古いデータが5分間残り続ける問題を解消' },
      { type:'fix',     text:'booking:cancelledリスナーの欠落を修正：キャンセル操作後にKPI・アクティビティキャッシュが即時無効化されず古い売上・成長率データが最大5分間表示され続けていた問題を解消' },
      { type:'fix',     text:'StatisticsServiceのbookings Realtimeチャンネル重複を削除：bookingsテーブルへの二重購読により1件のINSERTで最大31クエリ・二重再描画が発火していた問題を修正。AdapterのDOMイベント経由に一本化' },
      { type:'improve', text:'SupabaseAdapterをwindow.SupabaseClientシングルトンに統合：アプリ全体でクライアントインスタンスを1つに統一' },
    ]
  },
  {
    version: 'v3.3', date: '2026-06-05',
    entries: [
      { type:'feat',    text:'強制パスワード変更ゲート（Phase 10A）：デフォルトパスワードのまま利用不可、初回ログイン時に新パスワード設定を義務化' },
      { type:'feat',    text:'ログイン画面事前確認バナー（Phase 10B）：env.js 認証情報をページ読み込み時に検証、設定不備をアンバーバナーで即時通知' },
      { type:'feat',    text:'本番グレード HealthCheck システム（Phase 10C）：Supabase 接続・DataProvider・サービスレジストリ・ストレージ・認証を起動時に並列チェック' },
      { type:'feat',    text:'設定 → システム健全性ページ：サービス別ステータス・最終チェック日時・詳細メッセージの一覧表示、再チェック & ログクリアボタン' },
      { type:'feat',    text:'インアプリ健全性バナー：ログイン後に正常（緑）/ 警告（黄）/ エラー（赤）バナーを表示、health:* カスタムイベント送出' },
      { type:'feat',    text:'ヘルスチェックログ：hm_health_log に100件FIFOで記録、サービス・ステータス・メッセージ・タイムスタンプを保存' },
    ]
  },
  {
    version: 'v3.2', date: '2026-06-04',
    entries: [
      { type:'feat',    text:'メール通知連携：EmailJS REST APIを使用して新規予約・ステータス変更時に管理者へ自動メール送信（SDKなし）' },
      { type:'feat',    text:'メール通知設定ページ：通知先メール・EmailJS認証情報・トリガー別ON/OFF・テンプレート変数リスト・送信ログ・テスト送信' },
    ]
  },
  {
    version: 'v3.1', date: '2026-06-04',
    entries: [
      { type:'feat',    text:'LINE通知連携：新規予約・ステータス変更（確定・完了）・見積り受信時にLINE Notifyへ自動送信' },
      { type:'feat',    text:'LINE通知設定ページ：トークン管理・トリガー別ON/OFF・CORSプロキシ設定・送信ログ（最新20件）・テスト送信' },
      { type:'feat',    text:'変更履歴ページに「次のバージョン予定」セクションを追加（優先度付き10件）' },
    ]
  },
  {
    version: 'v3.0', date: '2026-06-04',
    entries: [
      { type:'feat',    text:'全管理ページに印刷機能を追加（予約・見積り・レビュー・顧客・レポート・分析・バックアップ・料金・不用品・容量・カレンダー）' },
      { type:'feat',    text:'分析モジュールを全面刷新：KPIカード6枚・期間フィルター・Canvasグラフ3種・CSV出力・印刷対応' },
      { type:'feat',    text:'分析KPIカードに分析期間ラベルを追加。KPIが選択期間でフィルタリングされるよう変更' },
      { type:'feat',    text:'不用品管理をカテゴリベースに刷新：カテゴリ・アイテムのCRUD、合計処分費用のリアルタイム表示' },
      { type:'feat',    text:'売上レポートをクイック操作に直接印刷ボタンとして追加' },
      { type:'fix',     text:'renderAnalyticsCharts内の const svcCount・const periodLabel 二重宣言バグを修正' },
    ]
  },
  {
    version: 'v2.5', date: '2026-06-03',
    entries: [
      { type:'feat',    text:'顧客管理モジュール追加：顧客一覧・プロフィールモーダル・予約履歴・削除' },
      { type:'feat',    text:'メディアライブラリ追加：画像・動画のアップロード・プレビュー・削除' },
      { type:'feat',    text:'レビュー管理を刷新：タブ表示（保留中・承認済み・却下）・公開切替・顧客投稿フォーム対応' },
      { type:'feat',    text:'バックアップセンター追加：JSON形式のエクスポート/インポート・フルバックアップ・復元' },
      { type:'improve', text:'予約管理に顧客管理との連携（顧客IDの自動生成・履歴追跡）を追加' },
    ]
  },
  {
    version: 'v2.0', date: '2026-06-02',
    entries: [
      { type:'feat',    text:'ヒーローエディター追加：見出し・サブテキスト・CTA・バッジ・背景画像・バージョン履歴管理' },
      { type:'feat',    text:'サービス管理を追加：サービスカードのCRUD・プレビュー・注目カード設定' },
      { type:'feat',    text:'FAQ編集モジュール追加：質問・回答のCRUD・ライブプレビュー' },
      { type:'feat',    text:'会社情報編集モジュール追加：会社概要行のCRUD・プレビュー' },
      { type:'feat',    text:'フッター編集モジュール追加：リンク・列・著作権テキストの編集' },
      { type:'improve', text:'見積り管理に予約変換機能（予約化ボタン）を追加' },
    ]
  },
  {
    version: 'v1.5', date: '2026-06-01',
    entries: [
      { type:'feat',    text:'カレンダー管理追加：日別空き状況（○/△/×）の編集・一括設定' },
      { type:'feat',    text:'料金管理追加：サービスごとの基本料金・距離・階数・割増料金の設定' },
      { type:'feat',    text:'容量設定追加：1日の最大予約数・残りわずか閾値の設定' },
      { type:'feat',    text:'クイック操作パネル追加：主要機能へのショートカットを一覧表示' },
      { type:'feat',    text:'分析ページ追加（初期版）：予約統計・完了率・満了日数のカード表示' },
    ]
  },
  {
    version: 'v1.0', date: '2026-05-30',
    entries: [
      { type:'feat',    text:'管理システム初期リリース' },
      { type:'feat',    text:'ログイン画面：メール・パスワード認証・セッション管理（30分）・ダークモード自動検出' },
      { type:'feat',    text:'ダッシュボード：統計カード・最近の予約・アクティビティフィード・クイックアクション' },
      { type:'feat',    text:'予約管理：一覧・ステータスフィルター・検索・追加・編集・削除・詳細モーダル' },
      { type:'feat',    text:'見積り管理：リクエスト一覧・フィルター・CSV出力・削除' },
      { type:'feat',    text:'CSV エクスポート / インポート機能' },
      { type:'feat',    text:'レスポンシブレイアウト・ダークモード対応' },
    ]
  },
];

const CL_TYPE = {
  feat:    { label:'新機能',  bg:'rgba(37,99,235,.1)',   color:'#2563eb',  border:'rgba(37,99,235,.2)'  },
  improve: { label:'改善',    bg:'rgba(16,185,129,.1)',  color:'#059669',  border:'rgba(16,185,129,.2)' },
  fix:     { label:'バグ修正', bg:'rgba(239,68,68,.08)', color:'#b91c1c',  border:'rgba(239,68,68,.18)' },
};

const CHANGELOG_NEXT = [
  { priority:'high',   text:'PDF直接出力：印刷ビューをPDFファイルとして直接ダウンロード' },
  { priority:'medium', text:'Google カレンダー同期：予約を Google カレンダーに自動追加' },
  { priority:'medium', text:'一括操作：予約・見積りの複数選択とまとめてステータス変更' },
  { priority:'medium', text:'ダッシュボードカスタマイズ：表示するウィジェットを自由に並び替え' },
  { priority:'medium', text:'英語管理画面対応：管理UIの日英切替サポート' },
  { priority:'low',    text:'自動フォローアップ：引越し完了後の顧客へ自動レビュー依頼メール' },
  { priority:'low',    text:'スタッフ管理：複数管理者アカウントと権限レベルの設定' },
  { priority:'low',    text:'PWA対応：ホーム画面へのインストールとオフライン閲覧' },
];

const CL_PRIORITY = {
  high:   { label:'優先度：高', bg:'rgba(239,68,68,.08)',  color:'#b91c1c', border:'rgba(239,68,68,.18)'  },
  medium: { label:'優先度：中', bg:'rgba(245,158,11,.1)',  color:'#b45309', border:'rgba(245,158,11,.25)' },
  low:    { label:'優先度：低', bg:'rgba(107,114,128,.1)', color:'#4b5563', border:'rgba(107,114,128,.2)' },
};

function renderChangelog() {
  const el = document.getElementById('changelogContent');
  if (!el) return;

  let h = `<div class="panel" style="margin-bottom:16px">
    <div class="panel-head">
      <span class="panel-title">変更履歴</span>
      <span style="font-size:11px;color:var(--gray-2)">${CHANGELOG.length}バージョン · ${CHANGELOG.reduce((s,v)=>s+v.entries.length,0)}件の変更</span>
    </div>
  </div>`;

  /* ── What's Next panel ── */
  const highCount   = CHANGELOG_NEXT.filter(i=>i.priority==='high').length;
  const mediumCount = CHANGELOG_NEXT.filter(i=>i.priority==='medium').length;
  const lowCount    = CHANGELOG_NEXT.filter(i=>i.priority==='low').length;

  h += `<div class="panel" style="margin-bottom:20px;border-color:rgba(139,92,246,.25)">
    <div class="panel-head" style="background:rgba(139,92,246,.04)">
      <div style="display:flex;align-items:center;gap:10px">
        <svg viewBox="0 0 24 24" width="16" height="16" style="color:#7c3aed;flex-shrink:0"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
        <span class="panel-title" style="color:#7c3aed">次のバージョン予定</span>
        <span style="font-size:11px;color:var(--gray-2)">${CHANGELOG_NEXT.length}件</span>
      </div>
      <div style="display:flex;gap:6px;font-size:11px;flex-wrap:wrap">
        <span style="color:#b91c1c;font-weight:600">高 ${highCount}</span>
        <span style="color:#b45309;font-weight:600">中 ${mediumCount}</span>
        <span style="color:#6b7280;font-weight:600">低 ${lowCount}</span>
      </div>
    </div>
    <div class="panel-body" style="padding:8px 16px">
      ${CHANGELOG_NEXT.map(item => {
        const p = CL_PRIORITY[item.priority];
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--line-2)">
          <span style="flex-shrink:0;margin-top:1px;display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:${p.bg};color:${p.color};border:1px solid ${p.border};white-space:nowrap">${p.label}</span>
          <span style="font-size:13px;color:var(--ink);line-height:1.55">${esc(item.text)}</span>
        </div>`;
      }).join('')}
    </div>
  </div>

  <div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">リリース済み</div>`;

  CHANGELOG.forEach((ver, vi) => {
    const isLatest = vi === 0;
    h += `<div class="panel" style="margin-bottom:14px">
      <div class="panel-head">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:16px;font-weight:700;color:var(--ink)">${esc(ver.version)}</span>
          ${isLatest ? `<span style="display:inline-flex;align-items:center;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(16,185,129,.12);color:var(--green);border:1px solid rgba(16,185,129,.25)">最新</span>` : ''}
          <span style="font-size:12px;color:var(--gray-2)">${esc(ver.date)}</span>
        </div>
        <span style="font-size:12px;color:var(--gray-2)">${ver.entries.length}件</span>
      </div>
      <div class="panel-body" style="padding:8px 16px">`;

    ver.entries.forEach(entry => {
      const t = CL_TYPE[entry.type] || CL_TYPE.feat;
      h += `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--line-2)">
        <span style="flex-shrink:0;margin-top:1px;display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:${t.bg};color:${t.color};border:1px solid ${t.border};white-space:nowrap">${t.label}</span>
        <span style="font-size:13px;color:var(--ink);line-height:1.55">${esc(entry.text)}</span>
      </div>`;
    });

    h += `</div></div>`;
  });

  el.innerHTML = h;
}

function printBackup() {
  const bk      = Adapter.getBookings();
  const quotes  = Adapter.getQuotes();
  const reviews = Adapter.getReviews();
  const custs   = Adapter.getCustomers();
  const prices  = Adapter.getPrices();
  const disp    = Adapter.getDisposal();
  const e       = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const now     = new Date();

  /* booking breakdown */
  const bkStatus = {新規:0,確認中:0,確定:0,完了:0,キャンセル:0};
  bk.forEach(b => { if (bkStatus[b.status]!==undefined) bkStatus[b.status]++; });
  const lastBk = bk.slice().sort((a,b)=>(b.createdAt||'')>(a.createdAt||'')?1:-1)[0];

  /* review breakdown */
  const revPending  = reviews.filter(r=>r.status==='pending').length;
  const revApproved = reviews.filter(r=>r.status==='approved').length;
  const revPublished= reviews.filter(r=>r.status==='approved'&&r.published).length;
  const revRejected = reviews.filter(r=>r.status==='rejected').length;
  const avgRating   = reviews.length
    ? (reviews.reduce((s,r)=>s+(r.rating||5),0)/reviews.length).toFixed(1) : '—';

  /* price table rows */
  const priceRows = Object.entries(prices).map(([svc, cfg]) => {
    const base = typeof cfg==='number' ? cfg : (cfg&&cfg.base)||0;
    return `<tr>
      <td style="padding:6px 12px;font-size:12px;color:#374151;border-bottom:1px solid #f0f2f5">${e(svc)}</td>
      <td style="padding:6px 12px;font-size:12px;font-weight:600;color:#0b0f17;border-bottom:1px solid #f0f2f5;text-align:right">¥${base.toLocaleString()}</td>
    </tr>`;
  }).join('');

  /* disposal summary */
  const totalDispItems = disp.categories.reduce((s,c)=>s+c.items.length,0);
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
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Hiragino Sans','Meiryo','Yu Gothic',sans-serif;font-size:13px;color:#0b0f17;background:#fff;padding:32px 36px}
@media print{body{padding:0}@page{margin:16mm 14mm;size:A4 portrait}}
</style></head><body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #0a1f44;margin-bottom:24px">
  <div style="display:flex;align-items:center;gap:12px">
    <div style="width:40px;height:40px;border-radius:10px;background:#1D9E75;color:#fff;font-size:20px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">H</div>
    <div>
      <div style="font-size:17px;font-weight:700;color:#0a1f44;line-height:1.2">Hello Moving</div>
      <div style="font-size:10px;color:#6b7280;margin-top:1px">ハローム―ビング</div>
    </div>
  </div>
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:700;color:#0a1f44">システム状況レポート</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:4px">出力日時: ${now.toLocaleString('ja-JP')}</div>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
  ${statCard('総予約数',   bk.length+'件',       `最終受付: ${lastBk?lastBk.createdAt.slice(0,10):'—'}`)}
  ${statCard('見積り',     quotes.length+'件',    '受付済み合計', '#2563eb')}
  ${statCard('レビュー',   reviews.length+'件',   `公開中 ${revPublished}件`, '#8b5cf6')}
  ${statCard('顧客',       custs.length+'件',     '登録済み合計', '#059669')}
</div>

${section('予約ステータス別')}
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
  ${Object.entries(bkStatus).map(([st,n])=>statCard(st,n+'件')).join('')}
</div>

${section('レビュー内訳')}
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
  ${statCard('保留中',  revPending+'件',  '', '#b45309')}
  ${statCard('承認済み',revApproved+'件', '', '#059669')}
  ${statCard('公開中',  revPublished+'件','', '#059669')}
  ${statCard('平均評価',avgRating+'★',   `${reviews.length}件のレビュー`, '#f59e0b')}
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
  ${statCard('カテゴリ数',  disp.categories.length+'件')}
  ${statCard('総アイテム数',totalDispItems+'件')}
  ${statCard('有効アイテム',enabledDispItems+'件', '', '#059669')}
</div>

<div style="display:flex;justify-content:space-between;align-items:flex-end;padding-top:14px;border-top:1px solid #e5e7eb;margin-top:24px">
  <div style="font-size:10px;color:#9ca3af;line-height:1.7">
    <div>Hello Moving — 管理システム</div>
    <div>このドキュメントは管理システムから自動生成されました</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#6b7280;line-height:1.7">
    <div style="font-weight:600;color:#0b0f17">Hello Moving</div>
    <div>info@hello-moving.com</div>
  </div>
</div>

<script>window.onload=function(){setTimeout(function(){window.print();},350);window.onafterprint=function(){window.close();}}<\/script>
</body></html>`;

  const w = window.open('','_blank','width=860,height=760');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}
