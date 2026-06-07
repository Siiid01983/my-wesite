'use strict';

/* ════════════════════════════════════════════════════════
   DISPOSAL MANAGEMENT (v2 — category-based)
   ════════════════════════════════════════════════════════ */
let _dispCatEditId  = null;
let _dispItemCatId  = null;
let _dispItemEditId = null;

function _duid() { return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function calcDisposalTotal(data) {
  return data.categories.reduce((sum, cat) =>
    sum + cat.items.filter(i => i.enabled).reduce((s, i) => s + (i.fee || 0), 0), 0);
}

function _renderDisposalUI() {
  const data = Adapter.getDisposal();
  const total = calcDisposalTotal(data);

  let h = `<div class="panel" style="margin-bottom:16px">
    <div class="panel-head">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <span class="panel-title">不用品カテゴリ管理</span>
        <span style="font-size:12px;color:var(--gray-1)">合計処分費用:
          <strong id="disposalTotal" style="color:var(--ink);font-size:15px;font-variant-numeric:tabular-nums">¥${total.toLocaleString()}</strong>
        </span>
      </div>
      <div style="display:flex;gap:5px">
        <button class="btn btn-ghost btn-sm" onclick="downloadPDFDisposal()">
          <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>PDF
        </button>
        <button class="btn btn-ghost btn-sm" onclick="printDisposal()">
          <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>印刷
        </button>
        <button class="btn btn-primary btn-sm" onclick="openDisposalCatModal(null)">
          <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>カテゴリを追加
        </button>
      </div>
    </div>
  </div>`;

  if (!data.categories.length) {
    h += `<div class="empty"><svg viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg><p>カテゴリがありません。上のボタンで追加してください。</p></div>`;
  } else {
    data.categories.forEach(cat => {
      h += `<div class="panel" style="margin-bottom:14px">
        <div class="panel-head">
          <span class="panel-title" style="font-size:13px">${esc(cat.name)}</span>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="openDisposalItemModal('${cat.id}',null)">
              <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>アイテム追加
            </button>
            <button class="btn btn-ghost btn-sm" onclick="openDisposalCatModal('${cat.id}')">
              <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>編集
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteDisposalCat('${cat.id}')">
              <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>削除
            </button>
          </div>
        </div>`;

      if (!cat.items.length) {
        h += `<div style="padding:18px 16px;text-align:center;font-size:13px;color:var(--gray-2)">アイテムがありません。「アイテム追加」で追加してください。</div>`;
      } else {
        h += `<div class="table-wrap"><table><thead><tr>
          <th>アイテム名</th>
          <th style="text-align:right">処分料金</th>
          <th style="text-align:center">有効</th>
          <th style="text-align:right">操作</th>
        </tr></thead><tbody>`;
        cat.items.forEach(item => {
          h += `<tr>
            <td style="font-weight:500">${esc(item.name)}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">¥${(item.fee||0).toLocaleString()}</td>
            <td style="text-align:center">
              <label class="toggle" title="${item.enabled?'無効にする':'有効にする'}">
                <input type="checkbox" ${item.enabled?'checked':''} onchange="toggleDisposalItem('${cat.id}','${item.id}')" />
                <div class="toggle-track"></div>
                <div class="toggle-thumb"></div>
              </label>
            </td>
            <td style="text-align:right">
              <div style="display:flex;gap:4px;justify-content:flex-end">
                <button class="btn btn-ghost btn-sm btn-icon" onclick="openDisposalItemModal('${cat.id}','${item.id}')" title="編集">
                  <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                </button>
                <button class="btn btn-danger btn-sm btn-icon" onclick="deleteDisposalItem('${cat.id}','${item.id}')" title="削除">
                  <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </td>
          </tr>`;
        });
        h += `</tbody></table></div>`;
      }
      h += `</div>`;
    });
  }

  document.getElementById('disposalContent').innerHTML = h;
}

function renderDisposal() { _renderDisposalUI(); }

function _syncDisposalFromSupabase() {
  if (!Adapter.supabaseReady) return;
  _dpSync('hm_data', {key:'hm_disposal'}, () => Adapter.syncDisposal(), 'view-disposal', _renderDisposalUI);
}

function updateDisposalTotal() {
  const el = document.getElementById('disposalTotal');
  if (el) el.textContent = '¥' + calcDisposalTotal(Adapter.getDisposal()).toLocaleString();
}

/* ── Category modal ── */
function openDisposalCatModal(catId) {
  _dispCatEditId = catId;
  const cat = catId ? Adapter.getDisposal().categories.find(c => c.id === catId) : null;
  document.getElementById('disposalCatModalTitle').textContent = catId ? 'カテゴリを編集' : 'カテゴリを追加';
  document.getElementById('disposalCatName').value = cat ? cat.name : '';
  document.getElementById('disposalCatModal').classList.add('open');
  setTimeout(() => document.getElementById('disposalCatName').focus(), 50);
}
function closeDisposalCatModal() { document.getElementById('disposalCatModal').classList.remove('open'); }
function saveDisposalCat() {
  const name = document.getElementById('disposalCatName').value.trim();
  if (!name) { toast('カテゴリ名を入力してください'); return; }
  const data = Adapter.getDisposal();
  if (_dispCatEditId) {
    const cat = data.categories.find(c => c.id === _dispCatEditId);
    if (cat) cat.name = name;
  } else {
    data.categories.push({ id: _duid(), name, items: [] });
  }
  Adapter.saveDisposal(data);
  closeDisposalCatModal();
  renderDisposal();
  toast(_dispCatEditId ? 'カテゴリを更新しました' : 'カテゴリを追加しました');
}
function deleteDisposalCat(catId) {
  const data = Adapter.getDisposal();
  const cat = data.categories.find(c => c.id === catId);
  if (!cat || !confirm(`「${cat.name}」カテゴリとその全アイテムを削除しますか？`)) return;
  data.categories = data.categories.filter(c => c.id !== catId);
  Adapter.saveDisposal(data);
  renderDisposal();
  toast('カテゴリを削除しました');
}

/* ── Item modal ── */
function openDisposalItemModal(catId, itemId) {
  _dispItemCatId  = catId;
  _dispItemEditId = itemId;
  const data = Adapter.getDisposal();
  const cat  = data.categories.find(c => c.id === catId);
  const item = itemId && cat ? cat.items.find(i => i.id === itemId) : null;
  document.getElementById('disposalItemModalTitle').textContent = itemId ? 'アイテムを編集' : 'アイテムを追加';
  document.getElementById('disposalItemName').value = item ? item.name : '';
  document.getElementById('disposalItemFee').value  = item ? item.fee  : '';
  document.getElementById('disposalItemModal').classList.add('open');
  setTimeout(() => document.getElementById('disposalItemName').focus(), 50);
}
function closeDisposalItemModal() { document.getElementById('disposalItemModal').classList.remove('open'); }
function saveDisposalItem() {
  const name = document.getElementById('disposalItemName').value.trim();
  const fee  = parseInt(document.getElementById('disposalItemFee').value) || 0;
  if (!name) { toast('アイテム名を入力してください'); return; }
  const data = Adapter.getDisposal();
  const cat  = data.categories.find(c => c.id === _dispItemCatId);
  if (!cat) return;
  if (_dispItemEditId) {
    const item = cat.items.find(i => i.id === _dispItemEditId);
    if (item) { item.name = name; item.fee = fee; }
  } else {
    cat.items.push({ id: _duid(), name, fee, enabled: true });
  }
  Adapter.saveDisposal(data);
  closeDisposalItemModal();
  renderDisposal();
  toast(_dispItemEditId ? 'アイテムを更新しました' : 'アイテムを追加しました');
}
function deleteDisposalItem(catId, itemId) {
  const data = Adapter.getDisposal();
  const cat  = data.categories.find(c => c.id === catId);
  if (!cat) return;
  const item = cat.items.find(i => i.id === itemId);
  if (!item || !confirm(`「${item.name}」を削除しますか？`)) return;
  cat.items = cat.items.filter(i => i.id !== itemId);
  Adapter.saveDisposal(data);
  renderDisposal();
  toast('アイテムを削除しました');
}
function toggleDisposalItem(catId, itemId) {
  const data = Adapter.getDisposal();
  const cat  = data.categories.find(c => c.id === catId);
  if (!cat) return;
  const item = cat.items.find(i => i.id === itemId);
  if (!item) return;
  item.enabled = !item.enabled;
  Adapter.saveDisposal(data);
  updateDisposalTotal();
}

function printDisposal() {
  const data  = Adapter.getDisposal();
  const total = calcDisposalTotal(data);
  const e = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const categorySections = data.categories.map(cat => {
    if (!cat.items.length) return '';
    const rows = cat.items.map((item, fi) => {
      const bg = fi % 2 === 1 ? 'background:#fafafa' : '';
      return `<tr>
        <td style="padding:8px 14px;border:1px solid #f0f2f5;font-size:12px;color:#374151;${bg}">${e(item.name)}</td>
        <td style="padding:8px 14px;border:1px solid #f0f2f5;font-size:12px;font-weight:600;text-align:right;font-variant-numeric:tabular-nums;${bg}">¥${(item.fee||0).toLocaleString()}</td>
        <td style="padding:8px 14px;border:1px solid #f0f2f5;text-align:center;${bg}">
          <span style="display:inline-flex;align-items:center;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;${item.enabled?'background:#f0fdf4;color:#059669;border:1px solid #10b98133':'background:#f9fafb;color:#9ca3af;border:1px solid #e5e7eb'}">${item.enabled?'有効':'無効'}</span>
        </td>
      </tr>`;
    }).join('');

    const catTotal = cat.items.filter(i=>i.enabled).reduce((s,i)=>s+(i.fee||0),0);
    return `<div style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12px;font-weight:700;color:#0a1f44;letter-spacing:.05em;text-transform:uppercase;padding-bottom:6px;border-bottom:1px solid #e5e7eb;margin-bottom:4px">
        <span>${e(cat.name)}</span>
        <span style="font-size:11px;font-weight:500;color:#6b7280;text-transform:none;letter-spacing:0">小計 ¥${catTotal.toLocaleString()}</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="background:#f8f9fa;font-weight:600;text-align:left;padding:7px 14px;border:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">アイテム名</th>
          <th style="background:#f8f9fa;font-weight:600;text-align:right;padding:7px 14px;border:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">処分料金</th>
          <th style="background:#f8f9fa;font-weight:600;text-align:center;padding:7px 14px;border:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">状態</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>不用品処分料金表 — Hello Moving</title>
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
    <div style="font-size:18px;font-weight:700;color:#0a1f44">不用品処分料金表</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:4px">出力日: ${new Date().toLocaleDateString('ja-JP')}</div>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px">
  ${[
    ['カテゴリ数',   data.categories.length+'件'],
    ['総アイテム数', data.categories.reduce((s,c)=>s+c.items.length,0)+'件'],
    ['合計処分費用', '¥'+total.toLocaleString()],
  ].map(([l,v])=>`<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px">
    <div style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${l}</div>
    <div style="font-size:18px;font-weight:700;color:#0b0f17">${v}</div>
  </div>`).join('')}
</div>

${categorySections || '<p style="color:#9ca3af;font-size:13px;text-align:center;padding:20px">カテゴリがありません</p>'}

<div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding:12px 16px;background:#f8f9fa;border:1px solid #e5e7eb;border-radius:8px">
  <span style="font-size:13px;font-weight:600;color:#374151">合計処分費用（有効アイテムのみ）</span>
  <span style="font-size:20px;font-weight:700;color:#0b0f17;font-variant-numeric:tabular-nums">¥${total.toLocaleString()}</span>
</div>

<div style="display:flex;justify-content:space-between;align-items:flex-end;padding-top:14px;border-top:1px solid #e5e7eb;margin-top:24px">
  <div style="font-size:10px;color:#9ca3af;line-height:1.7">
    <div>Hello Moving — 引越し専門サービス</div>
    <div>このドキュメントは管理システムから自動生成されました</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#6b7280;line-height:1.7">
    <div style="font-weight:600;color:#0b0f17">Hello Moving</div>
    <div>info@hello-moving.com</div>
  </div>
</div>

<script>window.onload=function(){setTimeout(function(){window.print();},350);window.onafterprint=function(){window.close();}}<\/script>
</body></html>`;

  const w = window.open('','_blank','width=780,height=720');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}
