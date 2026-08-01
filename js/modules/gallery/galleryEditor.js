'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   作業事例ギャラリー — Works Gallery admin (WMC section)

   Standalone CRUD UI for the DB-driven homepage gallery. Unlike the KV/Adapter
   CMS modules, this talks DIRECTLY to the dedicated endpoint:
     GET/POST/PUT/DELETE  <API_BASE>/admin/gallery.php   (+ ?action=reorder)
   Auth headers (X-API-KEY + X-ADMIN-TOKEN) mirror js/lib/apiClient.js so the
   logged-in admin session authorizes every write.

   Entry point: renderGallery()  (wired into wmcGo in websiteManagement.html).
   ════════════════════════════════════════════════════════════════════════════ */

/* ── local fallbacks (use the global WMC helpers when present) ──────────────── */
const _galEsc = (s) => (typeof esc === 'function'
  ? esc(s)
  : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
const _galToast = (m) => { if (typeof toast === 'function') toast(m); else console.log('[gallery]', m); };

/* ── config ─────────────────────────────────────────────────────────────────── */
const GAL_MAX_BYTES = 5 * 1024 * 1024;
const GAL_TYPES     = ['image/jpeg', 'image/png', 'image/webp'];
const GAL_CATEGORIES = [
  ['general',  '一般'],
  ['single',   '単身引越し'],
  ['family',   'ご家族・ご夫婦'],
  ['student',  '学生・新生活'],
  ['office',   'オフィス移転'],
  ['disposal', '不用品回収・処分'],
  ['assembly', '家具組立・分解'],
];
const _galCatLabel = (v) => (GAL_CATEGORIES.find((c) => c[0] === v) || [v, v])[1];

/* ── state ──────────────────────────────────────────────────────────────────── */
let _galItems = [];          // rows from the API (ordered)
let _galEditId = null;       // id being edited, or null when creating
let _galFile = null;         // pending File chosen in the modal (create or replace)
let _galBusy = false;        // a write is in flight
let _galDragFrom = -1;       // drag source index

/* ── API plumbing ───────────────────────────────────────────────────────────── */
function _galApiBase() { return String(window.API_BASE || '').replace(/\/+$/, ''); }
function _galHeaders(extra) {
  const h = extra || {};
  if (window.API_KEY) h['X-API-KEY'] = window.API_KEY;
  if (window.__HM_ADMIN_TOKEN) h['X-ADMIN-TOKEN'] = window.__HM_ADMIN_TOKEN;
  return h;
}
function _galErrMsg(data, status) {
  if (data && typeof data.error === 'string') return data.error;               // handler shape
  if (data && data.error && data.error.message) return data.error.message;     // auth-gate envelope
  return 'エラーが発生しました（' + status + '）';
}
async function _galApi(opts) {
  const base = _galApiBase();
  if (!base) throw new Error('API 未設定（window.API_BASE がありません）');
  let url = base + '/admin/gallery.php';
  if (opts.action) url += '?action=' + encodeURIComponent(opts.action);
  const init = { method: opts.method || 'GET', headers: _galHeaders() };
  if (opts.formData) {
    init.body = opts.formData;                        // browser sets multipart boundary
  } else if (opts.json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.json);
  }
  const res = await fetch(url, init);
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) throw new Error(_galErrMsg(data, res.status));
  return data;
}

/* ── mount / render ─────────────────────────────────────────────────────────── */
function renderGallery() {
  const host = document.getElementById('view-gallery');
  if (!host) return;
  host.innerHTML = _galShellHTML() + _galLoadingHTML();
  _galEnsureModal();
  _galLoad();
}

function _galShellHTML() {
  return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="openGalModal()">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>画像を追加
      </button>
      <button class="btn btn-ghost btn-sm" onclick="renderGallery()" title="再読み込み">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0012 4a8 8 0 108 8h-2a6 6 0 11-6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>更新
      </button>
      <span id="galCount" style="font-size:12px;color:var(--gray-2)"></span>
    </div>`;
}
function _galLoadingHTML() {
  return `<div class="panel"><div class="panel-body"><div class="gal-loading">読み込み中…</div></div></div>`;
}

async function _galLoad() {
  try {
    const resp = await _galApi({ method: 'GET' });
    _galItems = (resp && resp.data) || [];
    _galPaint();
  } catch (e) {
    const host = document.getElementById('view-gallery');
    if (host) host.innerHTML = _galShellHTML() +
      `<div class="panel"><div class="panel-body"><div class="gal-error">読み込みに失敗しました：${_galEsc(e.message)}
        <div style="margin-top:10px"><button class="btn btn-ghost btn-sm" onclick="renderGallery()">再試行</button></div></div></div></div>`;
  }
}

function _galPaint() {
  const host = document.getElementById('view-gallery');
  if (!host) return;
  host.innerHTML = _galShellHTML();
  const cnt = document.getElementById('galCount');
  if (cnt) cnt.textContent = _galItems.length ? `${_galItems.length} 件` : '';

  const panel = document.createElement('div');
  panel.className = 'panel';

  if (!_galItems.length) {
    panel.innerHTML = `<div class="panel-body">
      <div class="empty gal-empty">
        <p>まだ作業事例がありません。</p>
        <p style="font-size:12px;color:var(--gray-2);margin-top:4px">「画像を追加」から最初の写真を登録してください。</p>
        <div style="margin-top:14px"><button class="btn btn-primary btn-sm" onclick="openGalModal()">画像を追加</button></div>
      </div></div>`;
    host.appendChild(panel);
    return;
  }

  const rows = _galItems.map((it, i) => {
    const thumb = it.thumb_url || it.image_webp || it.image_url || '';
    const stActive = it.is_active
      ? `<button class="gal-pill on"  onclick="toggleGalActive(${it.id})" title="公開中（クリックで非表示）">公開</button>`
      : `<button class="gal-pill off" onclick="toggleGalActive(${it.id})" title="非表示（クリックで公開）">非表示</button>`;
    const stFeat = it.is_featured
      ? `<button class="gal-pill feat on"  onclick="toggleGalFeatured(${it.id})" title="注目（クリックで解除）">★ 注目</button>`
      : `<button class="gal-pill feat off" onclick="toggleGalFeatured(${it.id})" title="通常（クリックで注目に）">☆ 注目</button>`;
    return `<tr draggable="true" data-id="${it.id}" data-index="${i}">
      <td class="gal-drag" title="ドラッグで並び替え">⠿</td>
      <td>${thumb
        ? `<img class="gal-thumb" src="${_galEsc(thumb)}" alt="" loading="lazy">`
        : `<div class="gal-thumb gal-thumb-empty">—</div>`}</td>
      <td><strong>${_galEsc(it.title || '—')}</strong>${it.width && it.height ? `<div class="gal-dim">${it.width}×${it.height}</div>` : ''}</td>
      <td><span class="gal-cat">${_galEsc(_galCatLabel(it.category))}</span></td>
      <td><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${stActive}${stFeat}</div></td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-sm" onclick="openGalEdit(${it.id})">編集</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteGal(${it.id})" title="削除">
          <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div class="panel-head"><span class="panel-title">作業事例（ドラッグで並び替え）</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th style="width:34px"></th><th style="width:70px">画像</th><th>タイトル</th><th>カテゴリ</th><th>状態</th><th>操作</th></tr></thead>
      <tbody id="galTbody">${rows}</tbody>
    </table></div>`;
  host.appendChild(panel);
  _galBindDnD();
}

/* ── drag & drop reorder (native HTML5 DnD) ─────────────────────────────────── */
function _galBindDnD() {
  const tbody = document.getElementById('galTbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr[draggable="true"]').forEach((tr) => {
    tr.addEventListener('dragstart', (e) => {
      _galDragFrom = Number(tr.dataset.index);
      tr.classList.add('gal-row-dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tr.dataset.id); } catch (_) {}
    });
    tr.addEventListener('dragend', () => {
      tr.classList.remove('gal-row-dragging');
      tbody.querySelectorAll('.gal-row-over').forEach((r) => r.classList.remove('gal-row-over'));
    });
    tr.addEventListener('dragover', (e) => {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      tr.classList.add('gal-row-over');
    });
    tr.addEventListener('dragleave', () => tr.classList.remove('gal-row-over'));
    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      tr.classList.remove('gal-row-over');
      const to = Number(tr.dataset.index);
      _galApplyReorder(_galDragFrom, to);
    });
  });
}

function _galApplyReorder(from, to) {
  if (from < 0 || to < 0 || from === to || from >= _galItems.length) return;
  const snapshot = _galItems.slice();          // for rollback
  const moved = _galItems.splice(from, 1)[0];
  _galItems.splice(to, 0, moved);
  _galPaint();                                  // optimistic

  const items = _galItems.map((it, i) => ({ id: it.id, display_order: i }));
  _galApi({ method: 'POST', action: 'reorder', json: { items } })
    .then(() => _galToast('並び順を保存しました'))
    .catch((e) => {
      _galItems = snapshot;                     // rollback UI
      _galPaint();
      _galToast('並び替えに失敗しました：' + e.message);
    });
}

/* ── active / featured toggles (optimistic, rollback on error) ──────────────── */
function _galToggle(id, field) {
  const it = _galItems.find((x) => x.id === id);
  if (!it || _galBusy) return;
  const prev = !!it[field];
  it[field] = !prev;                            // optimistic
  _galPaint();
  const patch = { id }; patch[field] = it[field];
  _galApi({ method: 'PUT', json: patch })
    .then((r) => { if (r && r.data) _galMerge(r.data); })
    .catch((e) => {
      it[field] = prev;                         // rollback
      _galPaint();
      _galToast('更新に失敗しました：' + e.message);
    });
}
function toggleGalActive(id)   { _galToggle(id, 'is_active'); }
function toggleGalFeatured(id) { _galToggle(id, 'is_featured'); }

function _galMerge(row) {
  const i = _galItems.findIndex((x) => x.id === row.id);
  if (i >= 0) _galItems[i] = row;
}

/* ── delete ─────────────────────────────────────────────────────────────────── */
function deleteGal(id) {
  const it = _galItems.find((x) => x.id === id);
  if (!it) return;
  if (!confirm(`「${it.title || '(無題)'}」を削除しますか？\n画像ファイルも削除され、元に戻せません。`)) return;
  _galApi({ method: 'DELETE', action: '', json: { id } })
    .then(() => {
      _galItems = _galItems.filter((x) => x.id !== id);
      _galPaint();
      _galToast('削除しました');
    })
    .catch((e) => _galToast('削除に失敗しました：' + e.message));
}

/* ── modal (create / edit) ──────────────────────────────────────────────────── */
function _galEnsureModal() {
  if (document.getElementById('galModal')) return;
  const catOpts = GAL_CATEGORIES.map((c) => `<option value="${c[0]}">${_galEsc(c[1])}</option>`).join('');
  const el = document.createElement('div');
  el.id = 'galModal';
  el.className = 'gal-modal';
  el.innerHTML = `
    <div class="gal-modal-card" role="dialog" aria-modal="true" aria-labelledby="galModalTitle">
      <div class="gal-modal-head">
        <span id="galModalTitle" class="panel-title">画像を追加</span>
        <button class="gal-x" onclick="closeGalModal()" aria-label="閉じる">✕</button>
      </div>
      <div class="gal-modal-body">
        <div class="gal-form">
          <div>
            <label class="m-label">画像 <span style="color:var(--red)">*</span></label>
            <div class="gal-drop" id="galDrop" onclick="document.getElementById('galFile').click()">
              <img id="galPreview" class="gal-preview" alt="" style="display:none">
              <div id="galDropHint" class="gal-drop-hint">クリックして画像を選択<br><small>JPG / PNG / WebP・最大 5MB</small></div>
            </div>
            <input type="file" id="galFile" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="_galPick(this.files[0])">
            <div id="galFileErr" class="gal-field-err"></div>
          </div>
          <div class="m-field"><label class="m-label">タイトル <span style="color:var(--red)">*</span></label>
            <input class="m-input" id="galTitle" maxlength="120" placeholder="例：世田谷区 単身引越し"></div>
          <div class="m-field"><label class="m-label">代替テキスト（alt）<span style="color:var(--red)">*</span></label>
            <input class="m-input" id="galAlt" maxlength="200" placeholder="例：トラックに家具を積み込む作業員">
            <div class="gal-hint">画像が表示できない時の説明・SEO・スクリーンリーダー（音声読み上げ）用。写真の内容を簡潔に。</div></div>
          <div class="m-field"><label class="m-label">説明（任意）</label>
            <textarea class="m-input" id="galDesc" maxlength="400" rows="2" placeholder="任意の補足説明"></textarea></div>
          <div class="m-row">
            <div class="m-field"><label class="m-label">カテゴリ</label>
              <select class="m-input" id="galCat">${catOpts}</select></div>
            <div class="m-field"><label class="m-label">表示順（任意）</label>
              <input class="m-input" id="galOrder" type="number" placeholder="自動" min="0"></div>
          </div>
          <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:4px">
            <label class="gal-check"><input type="checkbox" id="galActive" checked> 公開する</label>
            <label class="gal-check"><input type="checkbox" id="galFeatured"> 注目（フィーチャー）</label>
          </div>
        </div>
      </div>
      <div class="gal-modal-foot">
        <button class="btn btn-ghost" onclick="closeGalModal()">キャンセル</button>
        <button class="btn btn-primary" id="galSubmit" onclick="submitGal()">保存</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el) closeGalModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.classList.contains('open')) closeGalModal();
  });
}

function openGalModal() {
  _galEnsureModal();
  _galEditId = null; _galFile = null;
  document.getElementById('galModalTitle').textContent = '画像を追加';
  document.getElementById('galTitle').value = '';
  document.getElementById('galAlt').value = '';
  document.getElementById('galDesc').value = '';
  document.getElementById('galCat').value = 'general';
  document.getElementById('galOrder').value = '';
  document.getElementById('galActive').checked = true;
  document.getElementById('galFeatured').checked = false;
  _galResetPreview();
  document.getElementById('galFileErr').textContent = '';
  document.getElementById('galModal').classList.add('open');
}

function openGalEdit(id) {
  const it = _galItems.find((x) => x.id === id);
  if (!it) return;
  _galEnsureModal();
  _galEditId = id; _galFile = null;
  document.getElementById('galModalTitle').textContent = '画像を編集';
  document.getElementById('galTitle').value = it.title || '';
  document.getElementById('galAlt').value = it.alt_text || '';
  document.getElementById('galDesc').value = it.description || '';
  document.getElementById('galCat').value = it.category || 'general';
  document.getElementById('galOrder').value = (it.display_order != null ? it.display_order : '');
  document.getElementById('galActive').checked = !!it.is_active;
  document.getElementById('galFeatured').checked = !!it.is_featured;
  document.getElementById('galFileErr').textContent = '';
  // Show the current image; picking a new file replaces it.
  const cur = it.image_webp || it.image_url || '';
  if (cur) _galShowPreview(cur); else _galResetPreview();
  document.getElementById('galModal').classList.add('open');
}

function closeGalModal() {
  const m = document.getElementById('galModal');
  if (m) m.classList.remove('open');
}

function _galPick(file) {
  const err = document.getElementById('galFileErr');
  err.textContent = '';
  if (!file) return;
  if (GAL_TYPES.indexOf(file.type) === -1) { err.textContent = 'JPG / PNG / WebP のみ対応しています。'; return; }
  if (file.size > GAL_MAX_BYTES) { err.textContent = 'ファイルが大きすぎます（最大 5MB）。'; return; }
  _galFile = file;
  _galShowPreview(URL.createObjectURL(file));
}
function _galShowPreview(src) {
  const img = document.getElementById('galPreview');
  const hint = document.getElementById('galDropHint');
  img.src = src; img.style.display = 'block';
  if (hint) hint.style.display = 'none';
}
function _galResetPreview() {
  const img = document.getElementById('galPreview');
  const hint = document.getElementById('galDropHint');
  img.removeAttribute('src'); img.style.display = 'none';
  if (hint) hint.style.display = 'block';
}

function _galReadAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    r.readAsDataURL(file);
  });
}

async function submitGal() {
  if (_galBusy) return;
  const title = document.getElementById('galTitle').value.trim();
  const alt   = document.getElementById('galAlt').value.trim();
  const desc  = document.getElementById('galDesc').value.trim();
  const cat   = document.getElementById('galCat').value;
  const orderRaw = document.getElementById('galOrder').value.trim();
  const active   = document.getElementById('galActive').checked;
  const featured = document.getElementById('galFeatured').checked;

  if (!title) { _galToast('タイトルを入力してください'); return; }
  if (!alt)   { _galToast('代替テキスト（alt）を入力してください'); return; }
  if (!_galEditId && !_galFile) { _galToast('画像を選択してください'); return; }

  _galSetBusy(true);
  try {
    if (_galEditId) {
      // Edit → JSON PUT (metadata + optional replacement image as base64).
      const json = {
        id: _galEditId, title, alt_text: alt, description: desc,
        category: cat, is_active: active, is_featured: featured,
      };
      if (orderRaw !== '') json.display_order = parseInt(orderRaw, 10) || 0;
      if (_galFile) json.image_base64 = await _galReadAsDataURL(_galFile);
      const r = await _galApi({ method: 'PUT', json });
      if (r && r.data) _galMerge(r.data);
      _galToast('更新しました');
    } else {
      // Create → multipart POST.
      const fd = new FormData();
      fd.append('image', _galFile);
      fd.append('title', title);
      fd.append('alt_text', alt);
      fd.append('description', desc);
      fd.append('category', cat);
      fd.append('is_active', active ? '1' : '0');
      fd.append('is_featured', featured ? '1' : '0');
      if (orderRaw !== '') fd.append('display_order', String(parseInt(orderRaw, 10) || 0));
      const r = await _galApi({ method: 'POST', formData: fd });
      if (r && r.data) _galItems.push(r.data);
      _galToast('追加しました');
    }
    closeGalModal();
    _galPaint();
  } catch (e) {
    _galToast('保存に失敗しました：' + e.message);
  } finally {
    _galSetBusy(false);
  }
}

function _galSetBusy(on) {
  _galBusy = on;
  const btn = document.getElementById('galSubmit');
  if (btn) { btn.disabled = on; btn.textContent = on ? '保存中…' : '保存'; }
}

/* expose for inline handlers (classic script → already global, listed for clarity) */
window.renderGallery = renderGallery;
window.openGalModal = openGalModal;
window.openGalEdit = openGalEdit;
window.closeGalModal = closeGalModal;
window.submitGal = submitGal;
window.deleteGal = deleteGal;
window.toggleGalActive = toggleGalActive;
window.toggleGalFeatured = toggleGalFeatured;
window._galPick = _galPick;
