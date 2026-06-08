'use strict';

/* ════════════════════════════════════════════════════════
   MEDIA LIBRARY v2 — Folders · Search · Compression · WebP
   ════════════════════════════════════════════════════════ */

const MediaLib = {
  KEY: { images: 'hm_media_images', videos: 'hm_media_videos', folders: 'hm_media_folders' },

  get(type) {
    try { return JSON.parse(localStorage.getItem(this.KEY[type]) || '[]'); } catch(e) { return []; }
  },
  save(type, items) {
    try { localStorage.setItem(this.KEY[type], JSON.stringify(items)); return true; }
    catch(e) { toast('ストレージ容量が不足しています。ファイルを削除して空き容量を確保してください'); return false; }
  },
  add(type, item) { const a = this.get(type); a.unshift(item); return this.save(type, a); },
  remove(type, id) { return this.save(type, this.get(type).filter(i => i.id !== id)); },
  find(type, id) { return this.get(type).find(i => i.id === id) || null; },
  update(type, id, patch) {
    return this.save(type, this.get(type).map(i => i.id === id ? Object.assign({}, i, patch) : i));
  },

  getFolders() {
    try { return JSON.parse(localStorage.getItem(this.KEY.folders) || '[]'); } catch(e) { return []; }
  },
  saveFolders(folders) {
    try { localStorage.setItem(this.KEY.folders, JSON.stringify(folders)); return true; }
    catch(e) { toast('ストレージ容量が不足しています'); return false; }
  },
  addFolder(name) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const folders = this.getFolders();
    folders.push({ id, name, createdAt: new Date().toLocaleDateString('ja-JP') });
    return this.saveFolders(folders) ? id : null;
  },
  renameFolder(id, name) {
    return this.saveFolders(this.getFolders().map(f => f.id === id ? Object.assign({}, f, { name }) : f));
  },
  deleteFolder(id) {
    this.saveFolders(this.getFolders().filter(f => f.id !== id));
    const images = this.get('images').map(img => {
      if (img.folderId !== id) return img;
      const copy = Object.assign({}, img);
      delete copy.folderId;
      return copy;
    });
    return this.save('images', images);
  }
};

/* ════ State ════ */
let _mediaActiveTab = 'images';
let _mediaSearch = '';
let _mediaActiveFolder = null;  // null = all | '_none' = unorganized | folderId = specific folder
let _mediaEditFolderId = null;  // null = create mode | id = rename mode
let _mediaCompress = true;
let _mediaConvertWebp = false;

/* ════ Public render entry ════ */
function renderMedia() {
  _renderImagesPane();
  _renderVideosPane();
}

function switchMediaTab(tab) {
  _mediaActiveTab = tab;
  document.getElementById('tabImages').classList.toggle('active', tab === 'images');
  document.getElementById('tabVideos').classList.toggle('active', tab === 'videos');
  document.getElementById('media-pane-images').style.display = tab === 'images' ? '' : 'none';
  document.getElementById('media-pane-videos').style.display = tab === 'videos' ? '' : 'none';
  document.getElementById('mediaTabTitle').textContent = tab === 'images' ? '画像' : '動画';
}

/* ════ Images pane ════ */
function _renderImagesPane() {
  _renderImgToolbar();
  _renderFolderPills();
  _renderImgGrid();
}

function _renderImgToolbar() {
  const el = document.getElementById('imgToolbar');
  if (!el) return;
  el.innerHTML =
    `<div class="media-search-wrap">
      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
      <input class="media-search" id="imgSearch" type="text" placeholder="ファイル名で検索..." value="${esc(_mediaSearch)}" oninput="filterMedia(this.value)" />
    </div>
    <button class="media-toggle-btn${_mediaCompress ? ' on' : ''}" onclick="toggleMediaCompress()" title="アップロード時に最大2000pxに縮小し画質82%で圧縮">
      <span>圧縮</span>
      <span class="media-toggle-dot"></span>
    </button>
    <button class="media-toggle-btn${_mediaConvertWebp ? ' on' : ''}" onclick="toggleMediaWebp()" title="アップロード時にWebP形式に変換">
      <span>WebP</span>
      <span class="media-toggle-dot"></span>
    </button>`;
}

function _renderFolderPills() {
  const el = document.getElementById('imgFolderRow');
  if (!el) return;
  const folders = MediaLib.getFolders();
  const images = MediaLib.get('images');
  const unorgCount = images.filter(i => !i.folderId).length;
  const allActive = _mediaActiveFolder === null;
  const noneActive = _mediaActiveFolder === '_none';

  let html =
    `<button class="media-folder-pill${allActive ? ' active' : ''}" onclick="selectMediaFolder(null)">
      すべて (${images.length})
    </button>`;

  folders.forEach(f => {
    const count = images.filter(i => i.folderId === f.id).length;
    const isActive = _mediaActiveFolder === f.id;
    html +=
      `<button class="media-folder-pill${isActive ? ' active' : ''}" onclick="selectMediaFolder('${f.id}')">
        ${esc(f.name)} (${count})
        <span class="media-folder-pill-opts" onclick="event.stopPropagation();openFolderModal('${f.id}')" title="名前を変更">✎</span>
        <span class="media-folder-pill-del" onclick="event.stopPropagation();deleteFolderItem('${f.id}')" title="フォルダを削除">×</span>
      </button>`;
  });

  if (folders.length > 0 && unorgCount > 0) {
    html +=
      `<button class="media-folder-pill${noneActive ? ' active' : ''}" onclick="selectMediaFolder('_none')">
        未整理 (${unorgCount})
      </button>`;
  }

  html +=
    `<button class="media-folder-pill media-folder-add" onclick="openFolderModal(null)">
      <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      新フォルダ
    </button>`;

  el.innerHTML = html;
}

function _renderImgGrid() {
  const items = _getFilteredImages();
  const grid = document.getElementById('imgGrid');
  const emptyEl = document.getElementById('imgEmpty');
  const statsEl = document.getElementById('imgStatsBar');

  if (statsEl) {
    const all = MediaLib.get('images');
    const totalSize = all.reduce((s, i) => s + (i.size || 0), 0);
    const filteredSize = items.reduce((s, i) => s + (i.size || 0), 0);
    if (_mediaSearch || _mediaActiveFolder !== null) {
      statsEl.textContent = `${items.length}件 (全${all.length}件中) · ${_fmtBytes(filteredSize)}`;
    } else {
      statsEl.textContent = `${all.length}件 · 合計 ${_fmtBytes(totalSize)}`;
    }
  }

  emptyEl.style.display = items.length ? 'none' : '';
  if (!items.length) { grid.innerHTML = ''; return; }

  const folders = MediaLib.getFolders();

  grid.innerHTML = items.map(item => {
    const id = item.id;
    const folder = item.folderId ? folders.find(f => f.id === item.folderId) : null;

    const badges = [
      folder          ? `<span class="media-badge media-badge-folder" title="${esc(folder.name)}">${esc(folder.name)}</span>` : '',
      item.compressed ? `<span class="media-badge media-badge-compress">圧縮</span>` : '',
      item.webp       ? `<span class="media-badge media-badge-webp">WebP</span>` : ''
    ].join('');

    const folderOpts =
      `<option value="">📁 フォルダなし</option>` +
      folders.map(f =>
        `<option value="${f.id}"${item.folderId === f.id ? ' selected' : ''}>${esc(f.name)}</option>`
      ).join('');

    return `<div class="media-card" id="mcard-${id}">
      <img class="media-thumb" src="${esc(item.data)}" alt="${esc(item.name)}" onclick="previewMediaItem('images','${id}')" loading="lazy" />
      <div class="media-card-body">
        <div class="media-card-name" title="${esc(item.name)}">${esc(item.name)}</div>
        <div class="media-card-meta">${_fmtBytes(item.size)} · ${esc(item.date)}</div>
        ${badges ? `<div class="media-card-badges">${badges}</div>` : ''}
        <select class="media-folder-sel" onchange="moveToFolder('${id}',this.value)">${folderOpts}</select>
        <div class="media-card-actions">
          <button class="btn btn-ghost btn-sm btn-icon" title="プレビュー" onclick="previewMediaItem('images','${id}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm btn-icon" title="URLをコピー" onclick="copyMediaURL('images','${id}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm btn-icon" title="削除" onclick="deleteMediaItem('images','${id}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function _getFilteredImages() {
  let items = MediaLib.get('images');
  if (_mediaSearch) {
    const q = _mediaSearch.toLowerCase();
    items = items.filter(i => i.name.toLowerCase().includes(q));
  }
  if (_mediaActiveFolder === '_none') {
    items = items.filter(i => !i.folderId);
  } else if (_mediaActiveFolder !== null) {
    items = items.filter(i => i.folderId === _mediaActiveFolder);
  }
  return items;
}

/* ════ Videos pane ════ */
function _renderVideosPane() {
  const items = MediaLib.get('videos');
  const grid  = document.getElementById('vidGrid');
  const emptyEl = document.getElementById('vidEmpty');
  emptyEl.style.display = items.length ? 'none' : '';
  if (!items.length) { grid.innerHTML = ''; return; }
  grid.innerHTML = items.map(item => {
    const id = item.id;
    return `<div class="media-card">
      <video class="media-thumb-vid" src="${esc(item.data)}" preload="metadata" onclick="previewMediaItem('videos','${id}')"></video>
      <div class="media-card-body">
        <div class="media-card-name" title="${esc(item.name)}">${esc(item.name)}</div>
        <div class="media-card-meta">${_fmtBytes(item.size)} · ${esc(item.date)}</div>
        <div class="media-card-actions">
          <button class="btn btn-ghost btn-sm btn-icon" title="プレビュー" onclick="previewMediaItem('videos','${id}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm btn-icon" title="URLをコピー" onclick="copyMediaURL('videos','${id}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm btn-icon" title="削除" onclick="deleteMediaItem('videos','${id}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ════ Upload handlers ════ */
function handleMediaUpload(e, type) {
  const files = Array.from(e.target.files);
  e.target.value = '';
  _uploadMediaFiles(files, type);
}

function mediaDropFiles(e, type) {
  e.preventDefault();
  const zoneId = type === 'images' ? 'imgDropZone' : 'vidDropZone';
  document.getElementById(zoneId).classList.remove('drag-over');
  const accept = type === 'images' ? /^image\// : /^video\//;
  _uploadMediaFiles(Array.from(e.dataTransfer.files).filter(f => accept.test(f.type)), type);
}

function mediaDragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.add('drag-over');
}

function mediaDragLeave(zoneId) {
  document.getElementById(zoneId).classList.remove('drag-over');
}

async function _uploadMediaFiles(files, type) {
  if (!files.length) { toast('対応していないファイル形式です'); return; }
  const MAX = type === 'images' ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
  let ok = 0, savedBytes = 0;

  for (const file of files) {
    if (file.size > MAX) {
      toast(`${file.name}：ファイルサイズが上限を超えています`); continue;
    }
    try {
      let dataURL, size, name, wasProcessed = false;

      // Canvas processing: applies to raster images (skip SVG and GIF)
      const canProcess = type === 'images' && (_mediaCompress || _mediaConvertWebp) &&
        !(/^image\/(svg\+xml|gif)/.test(file.type));

      if (canProcess) {
        const result = await _processImageFile(file);
        dataURL = result.dataURL; size = result.size; name = result.name;
        wasProcessed = true;
        savedBytes += Math.max(0, file.size - size);
      } else {
        dataURL = await _readAsDataURL(file);
        size = file.size; name = file.name;
      }

      const isWebP = dataURL.startsWith('data:image/webp');
      const folderId = type === 'images' && _mediaActiveFolder && _mediaActiveFolder !== '_none'
        ? _mediaActiveFolder : undefined;

      const item = { id: genId(), name, size, date: new Date().toLocaleDateString('ja-JP'), data: dataURL };
      if (folderId) item.folderId = folderId;
      if (wasProcessed && _mediaCompress) item.compressed = true;
      if (isWebP) item.webp = true;

      if (MediaLib.add(type, item)) ok++;
    } catch(err) {
      toast(`${file.name}：処理に失敗しました`);
    }
  }

  if (type === 'images') _renderImagesPane();
  else _renderVideosPane();

  if (ok) {
    let msg = `${ok}件をアップロードしました`;
    if (savedBytes > 1024) msg += ` · ${_fmtBytes(savedBytes)} 削減`;
    toast(msg);
  }
}

function _readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function _processImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);

      let w = img.naturalWidth, h = img.naturalHeight;
      if (_mediaCompress) {
        const MAX_DIM = 2000;
        if (w > MAX_DIM || h > MAX_DIM) {
          if (w >= h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
          else        { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      const quality = _mediaCompress ? 0.82 : 0.95;
      let dataURL;

      if (_mediaConvertWebp) {
        dataURL = canvas.toDataURL('image/webp', quality);
        // Fallback: some browsers return PNG for image/webp
        if (!dataURL.startsWith('data:image/webp')) {
          dataURL = canvas.toDataURL('image/jpeg', quality);
        }
      } else {
        dataURL = canvas.toDataURL('image/jpeg', quality);
      }

      const isWebP = dataURL.startsWith('data:image/webp');
      let name = file.name;
      if (isWebP) name = name.replace(/\.[^.]+$/, '.webp');

      const base64 = dataURL.split(',')[1] || '';
      const size = Math.round(base64.length * 0.75);
      resolve({ dataURL, size, name });
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('load error')); };
    img.src = objUrl;
  });
}

/* ════ Filter & folder interaction ════ */
function filterMedia(val) {
  _mediaSearch = val;
  _renderImgGrid();
}

function selectMediaFolder(folderId) {
  _mediaActiveFolder = folderId;
  _renderFolderPills();
  _renderImgGrid();
}

function toggleMediaCompress() {
  _mediaCompress = !_mediaCompress;
  _renderImgToolbar();
}

function toggleMediaWebp() {
  _mediaConvertWebp = !_mediaConvertWebp;
  _renderImgToolbar();
}

function moveToFolder(imgId, folderId) {
  const patch = folderId ? { folderId } : {};
  if (!folderId) {
    const item = MediaLib.find('images', imgId);
    if (item) {
      const copy = Object.assign({}, item);
      delete copy.folderId;
      MediaLib.save('images', MediaLib.get('images').map(i => i.id === imgId ? copy : i));
    }
  } else {
    MediaLib.update('images', imgId, patch);
  }
  _renderImagesPane();
}

/* ════ Folder modal ════ */
function openFolderModal(id) {
  _mediaEditFolderId = id;
  const modal   = document.getElementById('mediaFolderModal');
  const titleEl = document.getElementById('folderModalTitle');
  const inputEl = document.getElementById('folderNameInput');
  if (id) {
    const folder = MediaLib.getFolders().find(f => f.id === id);
    titleEl.textContent = 'フォルダ名を変更';
    inputEl.value = folder ? folder.name : '';
  } else {
    titleEl.textContent = '新しいフォルダ';
    inputEl.value = '';
  }
  modal.classList.add('open');
  setTimeout(() => inputEl.focus(), 60);
}

function closeFolderModal() {
  document.getElementById('mediaFolderModal').classList.remove('open');
  _mediaEditFolderId = null;
}

function saveFolderModal() {
  const name = document.getElementById('folderNameInput').value.trim();
  if (!name) { toast('フォルダ名を入力してください'); return; }
  if (_mediaEditFolderId) {
    MediaLib.renameFolder(_mediaEditFolderId, name);
    toast('フォルダ名を変更しました');
  } else {
    const id = MediaLib.addFolder(name);
    if (id) _mediaActiveFolder = id;
    toast(`フォルダ「${name}」を作成しました`);
  }
  closeFolderModal();
  _renderImagesPane();
}

function deleteFolderItem(id) {
  const folder = MediaLib.getFolders().find(f => f.id === id);
  if (!folder) return;
  const count = MediaLib.get('images').filter(i => i.folderId === id).length;
  const msg = count > 0
    ? `フォルダ「${folder.name}」を削除しますか？\n${count}枚の画像はフォルダなしになります。`
    : `フォルダ「${folder.name}」を削除しますか？`;
  if (!confirm(msg)) return;
  MediaLib.deleteFolder(id);
  if (_mediaActiveFolder === id) _mediaActiveFolder = null;
  _renderImagesPane();
  toast('フォルダを削除しました');
}

/* ════ Delete ════ */
function deleteMediaItem(type, id) {
  if (!confirm('このファイルを削除しますか？')) return;
  MediaLib.remove(type, id);
  if (type === 'images') _renderImagesPane();
  else _renderVideosPane();
  toast('削除しました');
}

/* ════ Copy URL ════ */
function copyMediaURL(type, id) {
  const item = MediaLib.find(type, id);
  if (!item) return;
  const text = item.data;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('URLをコピーしました')).catch(() => _fallbackCopy(text));
  } else {
    _fallbackCopy(text);
  }
}

function _fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('URLをコピーしました'); } catch(e) { toast('コピーに失敗しました'); }
  document.body.removeChild(ta);
}

/* ════ Preview overlay ════ */
function previewMediaItem(type, id) {
  const item = MediaLib.find(type, id);
  if (!item) return;
  const imgEl  = document.getElementById('mediaPreviewImg');
  const vidEl  = document.getElementById('mediaPreviewVid');
  const nameEl = document.getElementById('mediaPreviewName');
  const metaEl = document.getElementById('mediaPreviewMeta');
  nameEl.textContent = item.name;
  if (metaEl) metaEl.textContent = _fmtBytes(item.size) + ' · ' + item.date;
  if (type === 'images') {
    imgEl.src = item.data; imgEl.style.display = 'block';
    vidEl.src = '';        vidEl.style.display = 'none';
  } else {
    vidEl.src = item.data; vidEl.style.display = 'block';
    imgEl.src = '';        imgEl.style.display = 'none';
  }
  document.getElementById('mediaPreviewOverlay').classList.add('open');
}

function closeMediaPreview() {
  const vidEl = document.getElementById('mediaPreviewVid');
  vidEl.pause(); vidEl.src = '';
  document.getElementById('mediaPreviewImg').src = '';
  document.getElementById('mediaPreviewOverlay').classList.remove('open');
}

/* ════ Utility ════ */
function _fmtBytes(b) {
  if (!b) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}
