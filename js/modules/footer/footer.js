'use strict';

/* ════════════════════════════════════════════════════════
   FOOTER MANAGEMENT
   ════════════════════════════════════════════════════════ */
function _renderFooterColsHtml(cols) {
  const colLabels = ['列1', '列2', '列3'];
  return (cols || []).map((col, ci) => {
    const linkRows = (col.links || []).map((lnk, li) =>
      `<div class="footer-link-row">
         <input class="footer-link-inp" value="${esc(lnk.text||'')}" placeholder="テキスト" oninput="liveFooterPreview()" />
         <input class="footer-link-inp href" value="${esc(lnk.href||'')}" placeholder="#anchor" oninput="liveFooterPreview()" />
         <button class="btn btn-danger btn-sm btn-icon" onclick="removeFooterLink(${ci},${li})" title="削除">
           <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
         </button>
       </div>`
    ).join('');
    return `<div style="padding:16px;${ci < cols.length-1 ? 'border-bottom:1px solid var(--line);' : ''}">
      <div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">${colLabels[ci]||''}</div>
      <div class="m-field">
        <label class="m-label">列タイトル</label>
        <input class="m-input" id="footerCol${ci}Title" value="${esc(col.title||'')}" oninput="liveFooterPreview()" />
      </div>
      <div style="font-size:11px;font-weight:600;color:var(--gray-1);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">リンク</div>
      <div id="footerCol${ci}Links">${linkRows}</div>
      <button class="btn btn-ghost btn-sm" onclick="addFooterLink(${ci})" style="margin-top:8px">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>リンクを追加
      </button>
    </div>`;
  }).join('');
}

function _reindexFooterLinks(colIdx) {
  document.querySelectorAll(`#footerCol${colIdx}Links .footer-link-row`).forEach((row, li) => {
    row.querySelector('button[title="削除"]').setAttribute('onclick', `removeFooterLink(${colIdx},${li})`);
  });
}

function addFooterLink(colIdx) {
  const container = document.getElementById(`footerCol${colIdx}Links`);
  const li = container.children.length;
  const div = document.createElement('div');
  div.className = 'footer-link-row';
  div.innerHTML = `
    <input class="footer-link-inp" placeholder="テキスト" oninput="liveFooterPreview()" />
    <input class="footer-link-inp href" placeholder="#anchor" oninput="liveFooterPreview()" />
    <button class="btn btn-danger btn-sm btn-icon" onclick="removeFooterLink(${colIdx},${li})" title="削除">
      <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
    </button>`;
  container.appendChild(div);
  div.querySelector('.footer-link-inp').focus();
  liveFooterPreview();
}

function removeFooterLink(colIdx, linkIdx) {
  const rows = document.querySelectorAll(`#footerCol${colIdx}Links .footer-link-row`);
  if (rows[linkIdx]) rows[linkIdx].remove();
  _reindexFooterLinks(colIdx);
  liveFooterPreview();
}

function _readFooterFromForm() {
  const cols = [0, 1, 2].map(ci => {
    const titleEl = document.getElementById(`footerCol${ci}Title`);
    const title   = titleEl ? titleEl.value.trim() : '';
    const linkRows = document.querySelectorAll(`#footerCol${ci}Links .footer-link-row`);
    const links = Array.from(linkRows).map(row => {
      const inps = row.querySelectorAll('.footer-link-inp');
      return { text: (inps[0]?.value||'').trim(), href: (inps[1]?.value||'').trim() };
    }).filter(l => l.text);
    return { title, links };
  });
  return {
    brand_desc: document.getElementById('footerBrandDesc').value.trim(),
    cols,
    copyright: document.getElementById('footerCopyright').value.trim(),
    license:   document.getElementById('footerLicense').value.trim()
  };
}

function _renderFooterUI() {
  const d = Adapter.getFooter();
  document.getElementById('footerBrandDesc').value = d.brand_desc || '';
  document.getElementById('footerCopyright').value = d.copyright  || '';
  document.getElementById('footerLicense').value   = d.license    || '';
  document.getElementById('footerColsWrap').innerHTML = _renderFooterColsHtml(d.cols);
  liveFooterPreview();
  renderFooterHistory();
}

function liveFooterPreview() {
  const d = _readFooterFromForm();
  document.getElementById('fpPrevBrandDesc').textContent = d.brand_desc;
  document.getElementById('fpPrevCols').innerHTML = d.cols.map(col =>
    `<div>
       <div class="footer-prev-col-h4">${esc(col.title)}</div>
       ${(col.links||[]).map(l => `<div class="footer-prev-link">${esc(l.text)}</div>`).join('')}
     </div>`
  ).join('');
  document.getElementById('fpPrevBottom').innerHTML =
    `<div>${esc(d.copyright)}</div><div style="margin-top:2px">${esc(d.license)}</div>`;
}

function saveFooterAll() {
  const d = _readFooterFromForm();
  Adapter.pushFooterHistory(Adapter.getFooter());
  Adapter.saveFooter(d);
  renderFooterHistory();
  const ind = document.getElementById('footerSaveInd');
  ind.style.opacity = '1';
  clearTimeout(ind._t);
  ind._t = setTimeout(() => { ind.style.opacity = '0'; }, 2400);
}

function renderFooter() { _renderFooterUI(); }

function _syncFooterFromApi() {
  if (!Adapter.apiReady) return;
  _dpSync('hm_data', {key:'hm_footer'}, () => Adapter.syncFooter(), 'view-footer', _renderFooterUI);
}

function renderFooterHistory() {
  const hist = Adapter.getFooterHistory();
  const el   = document.getElementById('footerHistoryList');
  if (!hist.length) {
    el.innerHTML = '<div class="empty" style="padding:16px 0"><p>まだバージョンがありません</p></div>';
    return;
  }
  el.innerHTML = hist.map((entry, i) => {
    const d  = new Date(entry.ts);
    const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const snap = (entry.data && entry.data.brand_desc) ? entry.data.brand_desc.substring(0, 30) + '…' : '（スナップショット）';
    return `<div class="hhist-item">
      <div class="hhist-meta">
        <div class="hhist-time">${ts}</div>
        <div class="hhist-snap">${esc(snap)}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="restoreFooterVersion(${i})">復元</button>
    </div>`;
  }).join('');
}

function restoreFooterVersion(idx) {
  if (!confirm('このバージョンを復元しますか？\n現在の内容はバージョン履歴に保存されます。')) return;
  const hist = Adapter.getFooterHistory();
  if (!hist[idx]) return;
  Adapter.pushFooterHistory(Adapter.getFooter());
  Adapter.saveFooter(hist[idx].data);
  renderFooter();
  toast('バージョンを復元しました');
}
