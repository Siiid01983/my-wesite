'use strict';

/* ════════════════════════════════════════════════════════
   GLOBAL CONTENT MANAGER  ("コンテンツ & アイコン")
   A searchable list for editing static site copy that is NOT owned by a
   dedicated CMS module (hero/services/reviews/faq/footer/company/header).

   How it wires together:
     • Each editable element in index.html carries data-content-key="<key>".
     • CONTENT_REGISTRY below defines those keys (group + label + code default).
     • Save writes a flat { key: text } map to hm_data['hm_content'] via Adapter.
     • ContentLoader._applyGlobalContent sets textContent on [data-content-key]
       on every public page load. Blank field = keep the built-in default.

   SCOPE: text only. Icons are inline SVG on this site (no icon-font classes), so
   icon editing is intentionally deferred to its own future decision.

   ADDING A KEY: tag the element in index.html with data-content-key, then add a
   matching row here. Keep to pure-text elements that no other module manages.
   ════════════════════════════════════════════════════════ */

const CONTENT_REGISTRY = [
  /* group, key, label, def(ault code copy shown as placeholder) */
  /* Note: the hero H1 title, sub-text and CTA labels are managed by the Hero tab
     (hm_hero); only the hero's UNMANAGED extras appear here to avoid two sources
     writing one element. */
  { group:'ヒーロー（補足）', key:'hero_eyebrow',       label:'アイキャッチ（上部ラベル）', def:'東京 14年の実績 — 国土交通省 認可' },
  { group:'ヒーロー（補足）', key:'hero_badge1',        label:'サービスバッジ1', def:'🚚 当日対応' },
  { group:'ヒーロー（補足）', key:'hero_badge2',        label:'サービスバッジ2', def:'📦 単身引越し' },
  { group:'ヒーロー（補足）', key:'hero_badge3',        label:'サービスバッジ3', def:'👫 カップル引越し' },
  { group:'ヒーロー（補足）', key:'hero_badge4',        label:'サービスバッジ4', def:'🎓 学生引越し' },
  { group:'ヒーロー（補足）', key:'hero_badge5',        label:'サービスバッジ5', def:'♻️ 不用品回収' },
  { group:'ヒーロー（補足）', key:'hero_urgency_label', label:'空き状況ラベル',   def:'本日の空き状況' },
  { group:'ヒーロー（補足）', key:'hero_urgency_note',  label:'空き状況ノート',   def:'最短当日対応可能' },

  { group:'安心バー', key:'trust_item1_key', label:'項目1 見出し', def:'14 Years of Experience' },
  { group:'安心バー', key:'trust_item1_sub', label:'項目1 補足',   def:'14年の実績' },
  { group:'安心バー', key:'trust_item2_key', label:'項目2 見出し', def:'国土交通省 認可' },
  { group:'安心バー', key:'trust_item2_sub', label:'項目2 補足',   def:'第 431320058126 号' },
  { group:'安心バー', key:'trust_item3_key', label:'項目3 見出し', def:'損害補償保険' },
  { group:'安心バー', key:'trust_item3_sub', label:'項目3 補足',   def:'万一も全額補償' },
  { group:'安心バー', key:'trust_item4_key', label:'項目4 見出し', def:'最短2時間で返信' },
  { group:'安心バー', key:'trust_item4_sub', label:'項目4 補足',   def:'当日引越し対応' },

  { group:'認定バッジ', key:'trust_badge1', label:'バッジ1', def:'国土交通省認可' },
  { group:'認定バッジ', key:'trust_badge2', label:'バッジ2', def:'保険加入済' },
  { group:'認定バッジ', key:'trust_badge3', label:'バッジ3', def:'古物商許可' },
  { group:'認定バッジ', key:'trust_badge4', label:'バッジ4', def:'オンライン予約対応' },

  { group:'不用品回収セクション', key:'disposal_eyebrow', label:'ラベル（英）', def:'Disposal Service' },
  { group:'不用品回収セクション', key:'disposal_title',   label:'見出し',        def:'不用品回収・処分サービス' },
  { group:'不用品回収セクション', key:'disposal_lead',    label:'説明文',        def:'引越しと同時に不要家具・家電をまとめて処分できます。手続き不要、搬出から処分まで一括対応。' },

  { group:'不用品回収カード', key:'disposal_card1_title', label:'カード1 見出し', def:'ベッド・マットレス処分' },
  { group:'不用品回収カード', key:'disposal_card1_body',  label:'カード1 説明文', def:'大型ベッドフレームやマットレスをまとめて搬出・処分。分解作業も対応いたします。' },
  { group:'不用品回収カード', key:'disposal_card2_title', label:'カード2 見出し', def:'ソファ・チェア処分' },
  { group:'不用品回収カード', key:'disposal_card2_body',  label:'カード2 説明文', def:'3人掛けソファや大型チェアも迅速に搬出。重量物でも安心してお任せください。' },
  { group:'不用品回収カード', key:'disposal_card3_title', label:'カード3 見出し', def:'冷蔵庫処分' },
  { group:'不用品回収カード', key:'disposal_card3_body',  label:'カード3 説明文', def:'家電リサイクル法対応の適正処理。フロンガス回収まで安心・合法的に処分します。' },
  { group:'不用品回収カード', key:'disposal_card4_title', label:'カード4 見出し', def:'洗濯機処分' },
  { group:'不用品回収カード', key:'disposal_card4_body',  label:'カード4 説明文', def:'縦型・ドラム式どちらも対応。家電リサイクル料込みで手続き不要です。' },
  { group:'不用品回収カード', key:'disposal_card5_title', label:'カード5 見出し', def:'テーブル・棚処分' },
  { group:'不用品回収カード', key:'disposal_card5_body',  label:'カード5 説明文', def:'ダイニングテーブル、書棚、収納棚など。分解が必要な場合も対応いたします。' },
  { group:'不用品回収カード', key:'disposal_card6_title', label:'カード6 見出し', def:'その他大型ゴミ' },
  { group:'不用品回収カード', key:'disposal_card6_body',  label:'カード6 説明文', def:'自治体では回収できない大型廃棄物もお任せ。まずはお気軽にご相談ください。' },

  { group:'お約束セクション', key:'commit_eyebrow', label:'ラベル（英）', def:'Our Commitments' },
  { group:'お約束セクション', key:'commit_title',   label:'見出し',        def:'私たちの、お約束。' },
  { group:'お約束セクション', key:'commit_lead',    label:'説明文',        def:'引越しは、お客様の生活そのものを動かす大切な仕事です。だからこそ、私たちは派手なことを掲げず、当たり前のことを当たり前に行うことを大切にしています。' },

  { group:'お約束カード', key:'commit_card1_title', label:'カード1 見出し', def:'時間を、必ずお守りします' },
  { group:'お約束カード', key:'commit_card1_body',  label:'カード1 説明文', def:'お約束のお時間に伺うこと。それは、お客様の一日を尊重するための、最も基本的なお約束です。' },
  { group:'お約束カード', key:'commit_card2_title', label:'カード2 見出し', def:'丁寧な養生と、梱包' },
  { group:'お約束カード', key:'commit_card2_body',  label:'カード2 説明文', def:'床・壁・家具を傷つけないための養生を徹底。すべてのお荷物に、ご自身のものを扱うような注意を払います。' },
  { group:'お約束カード', key:'commit_card3_title', label:'カード3 見出し', def:'料金は、明朗に' },
  { group:'お約束カード', key:'commit_card3_body',  label:'カード3 説明文', def:'追加料金が発生する可能性がある場合は、お見積り時に必ずご説明いたします。当日の不意な請求はございません。' },
  { group:'お約束カード', key:'commit_card4_title', label:'カード4 見出し', def:'誠実な対応を、最後まで' },
  { group:'お約束カード', key:'commit_card4_body',  label:'カード4 説明文', def:'お問い合わせから完了確認まで、同じ担当者が一貫して対応いたします。ご不明な点は、何度でもお尋ねください。' },
  { group:'お約束カード', key:'commit_card5_title', label:'カード5 見出し', def:'万一の際の、損害補償' },
  { group:'お約束カード', key:'commit_card5_body',  label:'カード5 説明文', def:'引越し作業中の事故に備え、損害補償保険に加入しております。万が一の際にも、誠実にご対応いたします。' },
  { group:'お約束カード', key:'commit_card6_title', label:'カード6 見出し', def:'静かに、騒がず、整然と' },
  { group:'お約束カード', key:'commit_card6_body',  label:'カード6 説明文', def:'近隣の方々への配慮も、私たちの仕事のうちです。ご挨拶から作業中の所作まで、整えた振る舞いをいたします。' },

  { group:'引越しの流れセクション', key:'process_eyebrow', label:'ラベル（英）', def:'How It Works' },
  { group:'引越しの流れセクション', key:'process_title',   label:'見出し',        def:'引越しの流れ' },
  { group:'引越しの流れセクション', key:'process_lead',    label:'説明文',        def:'ご依頼から完了まで、わかりやすく、お客様の負担を最小限に。' },

  { group:'引越しの流れステップ', key:'process_step1_title', label:'ステップ1 見出し', def:'お問い合わせ' },
  { group:'引越しの流れステップ', key:'process_step1_body',  label:'ステップ1 説明文', def:'お電話・LINE・フォームよりお気軽にご連絡ください。' },
  { group:'引越しの流れステップ', key:'process_step2_title', label:'ステップ2 見出し', def:'無料お見積り' },
  { group:'引越しの流れステップ', key:'process_step2_body',  label:'ステップ2 説明文', def:'訪問またはオンラインで、ご状況を伺い正確な金額をご提示します。' },
  { group:'引越しの流れステップ', key:'process_step3_title', label:'ステップ3 見出し', def:'事前のご準備' },
  { group:'引越しの流れステップ', key:'process_step3_body',  label:'ステップ3 説明文', def:'梱包資材のご手配・当日の段取りまで、しっかりとサポートいたします。' },
  { group:'引越しの流れステップ', key:'process_step4_title', label:'ステップ4 見出し', def:'引越し当日' },
  { group:'引越しの流れステップ', key:'process_step4_body',  label:'ステップ4 説明文', def:'養生・搬出・搬入・設置まで、訓練を受けたスタッフが丁寧に作業します。' },
  { group:'引越しの流れステップ', key:'process_step5_title', label:'ステップ5 見出し', def:'完了のご確認' },
  { group:'引越しの流れステップ', key:'process_step5_body',  label:'ステップ5 説明文', def:'お客様と一緒に最終確認。ご納得いただけるまで、しっかりとお応えします。' },

  { group:'予約バンド', key:'booking_band_title', label:'見出し', def:'オンライン予約 — 最短2時間で確認' },
  { group:'予約バンド', key:'booking_band_text',  label:'説明文', def:'日時・住所を入力してかんたん予約リクエスト。' },
];

/* Working state: current value per key (empty string = use the code default). */
let _contentVals = {};

const _CONTENT_ICON = {
  save:   '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14z"/></svg>',
};

/* ── Render ─────────────────────────────────────────────── */
function renderContent() {
  const host = document.getElementById('view-content');
  if (!host) return;
  const saved = Adapter.getContent() || {};
  _contentVals = {};
  CONTENT_REGISTRY.forEach(r => { _contentVals[r.key] = (saved[r.key] != null ? saved[r.key] : ''); });

  host.innerHTML =
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
       <button class="btn btn-primary" onclick="saveContentAll()">${_CONTENT_ICON.save}変更を保存</button>
       <span class="footer-save-ind" id="contentSaveInd">サイトに保存しました ✓</span>
     </div>
     <div class="panel" style="margin-bottom:16px">
       <div class="panel-body">
         <div class="settings-sub" style="margin-bottom:10px">
           サイトの固定テキストを検索して編集できます。空欄のままにすると、サイトに元から入っている文言が表示されます。
           （各項目は index.html の <code>data-content-key</code> と対応。ロゴ・色・各セクション専用の項目は他のタブで管理します）
         </div>
         <div class="m-field" style="margin-bottom:0">
           <div style="position:relative">
             <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--gray-2)">${_CONTENT_ICON.search}</span>
             <input class="m-input" id="contentSearch" placeholder="キーワードで検索（例：流れ / disposal / 予約）" oninput="_contentSearch(this.value)" style="padding-left:34px" />
           </div>
         </div>
       </div>
     </div>
     <div id="contentListWrap">${_contentListHtml()}</div>
     <div class="panel" style="margin-top:16px">
       <div class="panel-head"><span class="panel-title">バージョン履歴</span></div>
       <div class="panel-body"><div id="contentHistoryList"></div></div>
     </div>`;
  renderContentHistory();
}

function _contentListHtml() {
  /* Group registry rows in declaration order. */
  const groups = [];
  const byGroup = {};
  CONTENT_REGISTRY.forEach(r => {
    if (!byGroup[r.group]) { byGroup[r.group] = []; groups.push(r.group); }
    byGroup[r.group].push(r);
  });
  return groups.map(g =>
    `<div class="panel content-group" data-group="${esc(g)}" style="margin-bottom:12px">
       <div class="panel-head"><span class="panel-title">${esc(g)}</span></div>
       <div class="panel-body">
         ${byGroup[g].map(r => _contentRowHtml(r)).join('')}
       </div>
     </div>`
  ).join('');
}

function _contentRowHtml(r) {
  const val   = _contentVals[r.key] || '';
  const hay   = (r.key + ' ' + r.label + ' ' + r.def + ' ' + val).toLowerCase();
  const multi = r.def.length > 42;
  const field = multi
    ? `<textarea class="m-input content-inp" data-key="${esc(r.key)}" oninput="_contentEdit('${esc(r.key)}',this.value)" placeholder="${esc(r.def)}" style="height:64px">${esc(val)}</textarea>`
    : `<input class="m-input content-inp" data-key="${esc(r.key)}" value="${esc(val)}" oninput="_contentEdit('${esc(r.key)}',this.value)" placeholder="${esc(r.def)}" />`;
  return `<div class="content-row" data-search="${esc(hay)}" style="margin-bottom:12px">
     <label class="m-label" style="display:flex;align-items:baseline;gap:8px">
       <span>${esc(r.label)}</span>
       <span style="font-size:11px;color:var(--gray-2);font-weight:400">${esc(r.key)}</span>
     </label>
     ${field}
   </div>`;
}

/* ── Edit / search ──────────────────────────────────────── */
function _contentEdit(key, val) { _contentVals[key] = val; }

function _contentSearch(q) {
  const needle = (q || '').trim().toLowerCase();
  document.querySelectorAll('#contentListWrap .content-group').forEach(group => {
    let anyVisible = false;
    group.querySelectorAll('.content-row').forEach(row => {
      const match = !needle || (row.getAttribute('data-search') || '').indexOf(needle) > -1;
      row.style.display = match ? '' : 'none';
      if (match) anyVisible = true;
    });
    group.style.display = anyVisible ? '' : 'none';
  });
}

/* ── Save ───────────────────────────────────────────────── */
function saveContentAll() {
  const out = {};
  CONTENT_REGISTRY.forEach(r => {
    const v = (_contentVals[r.key] || '').trim();
    if (v) out[r.key] = v;               // store only real overrides; blank → default
  });
  Adapter.pushContentHistory(Adapter.getContent());
  Adapter.saveContent(out);
  renderContentHistory();
  const ind = document.getElementById('contentSaveInd');
  if (ind) {
    ind.style.opacity = '1';
    clearTimeout(ind._t);
    ind._t = setTimeout(() => { ind.style.opacity = '0'; }, 2400);
  }
  if (typeof toast === 'function') toast('コンテンツを保存しました');
}

/* ── API sync (parity with other modules; CMS freshness also comes from
   Adapter.syncFromApi() on login). ─────────────────────────────── */
function _syncContentFromApi() {
  if (typeof _dpSync === 'undefined' || !Adapter.apiReady) return;
  _dpSync('hm_data', { key: 'hm_content' }, () => Adapter.syncContent(), 'view-content', renderContent);
}

/* ── Version history ────────────────────────────────────── */
function renderContentHistory() {
  const el = document.getElementById('contentHistoryList');
  if (!el) return;
  const hist = Adapter.getContentHistory();
  if (!hist.length) {
    el.innerHTML = '<div class="empty" style="padding:16px 0"><p>まだバージョンがありません</p></div>';
    return;
  }
  el.innerHTML = hist.map((entry, i) => {
    const d  = new Date(entry.ts);
    const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const n  = (entry.data && typeof entry.data === 'object') ? Object.keys(entry.data).length : 0;
    return `<div class="hhist-item">
      <div class="hhist-meta">
        <div class="hhist-time">${ts}</div>
        <div class="hhist-snap">${n}件の上書き</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="restoreContentVersion(${i})">復元</button>
    </div>`;
  }).join('');
}

function restoreContentVersion(idx) {
  if (!confirm('このバージョンを復元しますか？\n現在の内容はバージョン履歴に保存されます。')) return;
  const hist = Adapter.getContentHistory();
  if (!hist[idx]) return;
  Adapter.pushContentHistory(Adapter.getContent());
  Adapter.saveContent(hist[idx].data);
  renderContent();
  if (typeof toast === 'function') toast('バージョンを復元しました');
}
