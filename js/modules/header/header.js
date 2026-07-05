'use strict';

/* ════════════════════════════════════════════════════════
   HEADER NAVIGATION MANAGEMENT
   Add / remove / reorder the desktop header nav links.

   Persistence: Adapter.saveHeader() → localStorage 'hm_header' + hm_data KV
   (MySQL, via hm-api). On the public site, ContentLoader._applyHeader rebuilds
   <ul id="headerNavEl"> from this data on every page load. index.html holds the
   static fallback markup only — no file on the server is rewritten.

   SCOPE: the DESKTOP nav only. The mobile menu (#mobileNav) is intentionally
   NOT managed here — it carries a different, longer list plus contact/CTA rows
   and close-on-tap listeners bound in script.js, so rebuilding it would drop
   behaviour. Keeping scope to the desktop nav respects the existing structure.

   The `booking` flag marks the link that opens the BA booking overlay
   (openBookingApp) — preserving the "無料見積り" behaviour through the rebuild.
   ════════════════════════════════════════════════════════ */

/* Working state — the currently-edited link list. Seeded from Adapter on
   render; mutated by add/remove/move; read back from the DOM before each
   structural re-render so in-progress typing is never lost. */
let _hdrLinks = [];

const _HDR_ICON = {
  up:   '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M7 14l5-5 5 5z"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>',
  del:  '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
  add:  '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
  save: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>',
};

/* ── Render ─────────────────────────────────────────────── */
function renderHeader() {
  const host = document.getElementById('view-header');
  if (!host) return;
  _hdrLinks = _hdrClone(Adapter.getHeader().links || []);
  host.innerHTML =
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
       <button class="btn btn-primary" onclick="saveHeaderAll()">${_HDR_ICON.save}変更を保存</button>
       <span class="footer-save-ind" id="headerSaveInd">サイトに保存しました ✓</span>
     </div>
     <div class="hero-layout">
       <div style="display:flex;flex-direction:column;gap:16px">
         <div class="panel">
           <div class="panel-head"><span class="panel-title">ナビゲーションリンク</span></div>
           <div class="panel-body">
             <div class="settings-sub" style="margin-bottom:10px">
               PCヘッダーのメニュー項目です。上下ボタンで並び替え、「予約」にチェックを入れると
               クリックで予約フォームが開きます。（モバイルメニューは対象外です）
             </div>
             <div id="headerLinksWrap"></div>
             <button class="btn btn-ghost btn-sm" onclick="addHeaderLink()" style="margin-top:10px">
               ${_HDR_ICON.add}リンクを追加
             </button>
           </div>
         </div>
       </div>
       <div style="display:flex;flex-direction:column;gap:16px">
         <div class="panel">
           <div class="panel-head"><span class="panel-title">プレビュー</span></div>
           <div class="panel-body">
             <nav class="header-prev-nav"><ul id="hdrPrevList" style="list-style:none;display:flex;flex-wrap:wrap;gap:14px;margin:0;padding:0"></ul></nav>
           </div>
         </div>
         <div class="panel">
           <div class="panel-head"><span class="panel-title">バージョン履歴</span></div>
           <div class="panel-body"><div id="headerHistoryList"></div></div>
         </div>
       </div>
     </div>`;
  _paintHeaderRows();
  liveHeaderPreview();
  renderHeaderHistory();
}

function _hdrClone(arr) { try { return JSON.parse(JSON.stringify(arr)); } catch { return []; } }

function _paintHeaderRows() {
  const wrap = document.getElementById('headerLinksWrap');
  if (!wrap) return;
  wrap.innerHTML = _hdrLinks.map((lnk, i) =>
    `<div class="header-link-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
       <div style="display:flex;flex-direction:column;gap:2px">
         <button class="btn btn-ghost btn-sm btn-icon" onclick="moveHeaderLink(${i},-1)" title="上へ移動" ${i === 0 ? 'disabled' : ''}>${_HDR_ICON.up}</button>
         <button class="btn btn-ghost btn-sm btn-icon" onclick="moveHeaderLink(${i},1)" title="下へ移動" ${i === _hdrLinks.length - 1 ? 'disabled' : ''}>${_HDR_ICON.down}</button>
       </div>
       <input class="m-input hdr-link-text" value="${esc(lnk.text || '')}" placeholder="表示テキスト" oninput="_hdrEdit(${i},'text',this.value)" style="flex:1;min-width:90px" />
       <input class="m-input hdr-link-href" value="${esc(lnk.href || '')}" placeholder="#anchor か /page.html" oninput="_hdrEdit(${i},'href',this.value)" style="flex:1;min-width:110px" />
       <label style="display:flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap;cursor:pointer" title="クリックで予約フォームを開く">
         <input type="checkbox" class="hdr-link-booking" ${lnk.booking ? 'checked' : ''} onchange="_hdrEdit(${i},'booking',this.checked)" />予約
       </label>
       <button class="btn btn-danger btn-sm btn-icon" onclick="removeHeaderLink(${i})" title="削除">${_HDR_ICON.del}</button>
     </div>`
  ).join('');
}

/* ── Mutations ──────────────────────────────────────────── */
function _hdrEdit(i, field, val) {
  if (!_hdrLinks[i]) return;
  _hdrLinks[i][field] = (field === 'booking') ? !!val : val;
  liveHeaderPreview();
}

function addHeaderLink() {
  _hdrLinks.push({ text: '', href: '', booking: false });
  _paintHeaderRows();
  liveHeaderPreview();
  const rows = document.querySelectorAll('#headerLinksWrap .hdr-link-text');
  if (rows.length) rows[rows.length - 1].focus();
}

function removeHeaderLink(i) {
  _hdrLinks.splice(i, 1);
  _paintHeaderRows();
  liveHeaderPreview();
}

function moveHeaderLink(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= _hdrLinks.length) return;
  const tmp = _hdrLinks[i];
  _hdrLinks[i] = _hdrLinks[j];
  _hdrLinks[j] = tmp;
  _paintHeaderRows();
  liveHeaderPreview();
}

/* ── Live preview ───────────────────────────────────────── */
function liveHeaderPreview() {
  const list = document.getElementById('hdrPrevList');
  if (!list) return;
  list.innerHTML = _hdrLinks
    .filter(l => (l.text || '').trim())
    .map(l => `<li><a href="${esc(l.href || '#')}" onclick="return false" style="color:var(--navy,#0a1f44);text-decoration:none;font-weight:600;font-size:14px">${esc(l.text)}${l.booking ? ' <span style="font-size:10px;color:var(--gray-2)">(予約)</span>' : ''}</a></li>`)
    .join('');
}

/* ── Save ───────────────────────────────────────────────── */
function saveHeaderAll() {
  const links = _hdrLinks
    .map(l => ({ text: (l.text || '').trim(), href: (l.href || '').trim(), booking: !!l.booking }))
    .filter(l => l.text);
  Adapter.pushHeaderHistory(Adapter.getHeader());
  Adapter.saveHeader({ links });
  renderHeaderHistory();
  const ind = document.getElementById('headerSaveInd');
  if (ind) {
    ind.style.opacity = '1';
    clearTimeout(ind._t);
    ind._t = setTimeout(() => { ind.style.opacity = '0'; }, 2400);
  }
  if (typeof toast === 'function') toast('ヘッダーを保存しました');
}

/* ── API sync (parity with footer; CMS freshness also comes from
   Adapter.syncFromApi() on login). ─────────────────────────────── */
function _syncHeaderFromApi() {
  if (typeof _dpSync === 'undefined' || !Adapter.apiReady) return;
  _dpSync('hm_data', { key: 'hm_header' }, () => Adapter.syncHeader(), 'view-header', renderHeader);
}

/* ── Version history ────────────────────────────────────── */
function renderHeaderHistory() {
  const el = document.getElementById('headerHistoryList');
  if (!el) return;
  const hist = Adapter.getHeaderHistory();
  if (!hist.length) {
    el.innerHTML = '<div class="empty" style="padding:16px 0"><p>まだバージョンがありません</p></div>';
    return;
  }
  el.innerHTML = hist.map((entry, i) => {
    const d  = new Date(entry.ts);
    const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const n  = (entry.data && Array.isArray(entry.data.links)) ? entry.data.links.length : 0;
    return `<div class="hhist-item">
      <div class="hhist-meta">
        <div class="hhist-time">${ts}</div>
        <div class="hhist-snap">${n}件のリンク</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="restoreHeaderVersion(${i})">復元</button>
    </div>`;
  }).join('');
}

function restoreHeaderVersion(idx) {
  if (!confirm('このバージョンを復元しますか？\n現在の内容はバージョン履歴に保存されます。')) return;
  const hist = Adapter.getHeaderHistory();
  if (!hist[idx]) return;
  Adapter.pushHeaderHistory(Adapter.getHeader());
  Adapter.saveHeader(hist[idx].data);
  renderHeader();
  if (typeof toast === 'function') toast('バージョンを復元しました');
}
