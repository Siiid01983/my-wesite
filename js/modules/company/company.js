'use strict';

/* ════════════════════════════════════════════════════════
   COMPANY INFO MANAGEMENT
   ════════════════════════════════════════════════════════ */
let _compRowId = null;

function _renderCompanyUI() {
  const meta = Adapter.getCompanyMeta();
  document.getElementById('compMetaEyebrow').value = meta.eyebrow || '';
  document.getElementById('compMetaTitle').value   = meta.title   || '';
  const rows = Adapter.getCompanyRows();
  if (!rows.length) {
    document.getElementById('companyRowsWrap').innerHTML = emptyHTML('行がありません');
  } else {
    const trs = rows.map((r, i) => `<tr>
      <td style="text-align:center;font-weight:700;color:var(--gray-2);width:36px">${i+1}</td>
      <td style="white-space:nowrap;font-weight:600">${esc(r.label||'—')}</td>
      <td class="td-truncate td-sm" style="max-width:260px">${esc(r.value||'—')}</td>
      <td>
        <div style="display:flex;gap:4px;align-items:center">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="moveCompanyRow('${esc(r.id)}',-1)" ${i===0?'disabled':''} title="上へ">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm btn-icon" onclick="moveCompanyRow('${esc(r.id)}',1)" ${i===rows.length-1?'disabled':''} title="下へ">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="openCompanyEdit('${esc(r.id)}')">編集</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="delCompanyRow('${esc(r.id)}')" title="削除">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('');
    document.getElementById('companyRowsWrap').innerHTML = `
      <table><thead><tr>
        <th style="width:36px">#</th><th>項目名</th><th>内容</th><th>操作</th>
      </tr></thead><tbody>${trs}</tbody></table>`;
  }
  liveCompanyPreview();
  renderCompanyHistory();
}

function liveCompanyPreview() {
  const get = id => document.getElementById(id);
  get('compPrevEyebrow').textContent = get('compMetaEyebrow').value;
  get('compPrevTitle').textContent   = get('compMetaTitle').value;
  const rows = Adapter.getCompanyRows();
  get('compPrevRows').innerHTML = rows.length
    ? rows.map(r =>
        `<div class="comp-prev-row">
           <div class="comp-prev-dt">${esc(r.label||'')}</div>
           <div class="comp-prev-dd">${esc(r.value||'')}</div>
         </div>`
      ).join('')
    : '<div style="font-size:11px;color:var(--gray-2);padding:8px 0">行がありません。</div>';
}

function moveCompanyRow(id, dir) {
  const rows = Adapter.getCompanyRows();
  const idx  = rows.findIndex(r => r.id === id);
  if (idx < 0) return;
  const next = idx + dir;
  if (next < 0 || next >= rows.length) return;
  [rows[idx], rows[next]] = [rows[next], rows[idx]];
  Adapter.saveCompanyRows(rows);
  renderCompany();
}

function openCompanyModal() {
  _compRowId = null;
  document.getElementById('companyModalTitle').textContent = '行を追加';
  document.getElementById('compRowLabel').value = '';
  document.getElementById('compRowValue').value = '';
  updateCompanyModalPrev();
  document.getElementById('companyModal').classList.add('open');
}

function openCompanyEdit(id) {
  const r = Adapter.getCompanyRows().find(r => r.id === id); if (!r) return;
  _compRowId = id;
  document.getElementById('companyModalTitle').textContent = '行を編集';
  document.getElementById('compRowLabel').value = r.label || '';
  document.getElementById('compRowValue').value = r.value || '';
  updateCompanyModalPrev();
  document.getElementById('companyModal').classList.add('open');
}

function closeCompanyModal() { document.getElementById('companyModal').classList.remove('open'); }

function updateCompanyModalPrev() {
  document.getElementById('compPrevModalLabel').textContent = document.getElementById('compRowLabel').value || '（項目名）';
  document.getElementById('compPrevModalValue').textContent = document.getElementById('compRowValue').value || '';
}

function saveCompanyRow() {
  const label = document.getElementById('compRowLabel').value.trim();
  const value = document.getElementById('compRowValue').value.trim();
  if (!label) { alert('項目名を入力してください'); return; }
  if (!value) { alert('内容を入力してください'); return; }
  const rows = Adapter.getCompanyRows();
  if (_compRowId) {
    const idx = rows.findIndex(r => r.id === _compRowId);
    if (idx >= 0) rows[idx] = { ...rows[idx], label, value };
    Adapter.saveCompanyRows(rows);
    toast('行を更新しました');
  } else {
    rows.push({ id: 'CR-' + Date.now(), label, value });
    Adapter.saveCompanyRows(rows);
    toast('行を追加しました');
  }
  closeCompanyModal();
  renderCompany();
}

function delCompanyRow(id) {
  if (!confirm('この行を削除しますか？')) return;
  Adapter.saveCompanyRows(Adapter.getCompanyRows().filter(r => r.id !== id));
  toast('削除しました');
  renderCompany();
}

function saveCompanyAll() {
  const meta = {
    eyebrow: document.getElementById('compMetaEyebrow').value.trim(),
    title:   document.getElementById('compMetaTitle').value.trim()
  };
  Adapter.pushCompanyHistory({ meta: Adapter.getCompanyMeta(), rows: Adapter.getCompanyRows() });
  Adapter.saveCompanyMeta(meta);
  renderCompanyHistory();
  const ind = document.getElementById('companySaveInd');
  ind.style.opacity = '1';
  clearTimeout(ind._t);
  ind._t = setTimeout(() => { ind.style.opacity = '0'; }, 2400);
}

function renderCompany() { _renderCompanyUI(); }

function _syncCompanyFromApi() {
  if (!Adapter.apiReady) return;
  _dpSync('hm_data', {key:'hm_company_rows'}, () => Adapter.syncCompany(), 'view-company', _renderCompanyUI);
}

function renderCompanyHistory() {
  const hist = Adapter.getCompanyHistory();
  const el   = document.getElementById('companyHistoryList');
  if (!hist.length) {
    el.innerHTML = '<div class="empty" style="padding:16px 0"><p>まだバージョンがありません</p></div>';
    return;
  }
  el.innerHTML = hist.map((entry, i) => {
    const d  = new Date(entry.ts);
    const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const snap = (entry.meta && entry.meta.title) || '（タイトルなし）';
    return `<div class="hhist-item">
      <div class="hhist-meta">
        <div class="hhist-time">${ts}</div>
        <div class="hhist-snap">${esc(snap)} — ${(entry.rows||[]).length}行</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="restoreCompanyVersion(${i})">復元</button>
    </div>`;
  }).join('');
}

function restoreCompanyVersion(idx) {
  if (!confirm('このバージョンを復元しますか？\n現在の内容はバージョン履歴に保存されます。')) return;
  const hist = Adapter.getCompanyHistory();
  if (!hist[idx]) return;
  Adapter.pushCompanyHistory({ meta: Adapter.getCompanyMeta(), rows: Adapter.getCompanyRows() });
  Adapter.saveCompanyMeta(hist[idx].meta);
  Adapter.saveCompanyRows(hist[idx].rows);
  renderCompany();
  toast('バージョンを復元しました');
}
