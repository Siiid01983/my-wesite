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
  { group:'不用品回収セクション', key:'disposal_eyebrow', label:'ラベル（英）', def:'Disposal Service' },
  { group:'不用品回収セクション', key:'disposal_title',   label:'見出し',        def:'不用品回収・処分サービス' },
  { group:'不用品回収セクション', key:'disposal_lead',    label:'説明文',        def:'引越しと同時に不要家具・家電をまとめて処分できます。手続き不要、搬出から処分まで一括対応。' },

  { group:'お約束セクション', key:'commit_eyebrow', label:'ラベル（英）', def:'Our Commitments' },
  { group:'お約束セクション', key:'commit_title',   label:'見出し',        def:'私たちの、お約束。' },
  { group:'お約束セクション', key:'commit_lead',    label:'説明文',        def:'引越しは、お客様の生活そのものを動かす大切な仕事です。だからこそ、私たちは派手なことを掲げず、当たり前のことを当たり前に行うことを大切にしています。' },

  { group:'引越しの流れセクション', key:'process_eyebrow', label:'ラベル（英）', def:'How It Works' },
  { group:'引越しの流れセクション', key:'process_title',   label:'見出し',        def:'引越しの流れ' },
  { group:'引越しの流れセクション', key:'process_lead',    label:'説明文',        def:'ご依頼から完了まで、わかりやすく、お客様の負担を最小限に。' },

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
