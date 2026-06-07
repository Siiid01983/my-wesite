'use strict';

/* ════════════════════════════════════════════════════════
   MEDIA LIBRARY
   ════════════════════════════════════════════════════════ */
const MediaLib = {
  KEY: { images:'hm_media_images', videos:'hm_media_videos' },
  get(type) {
    try { return JSON.parse(localStorage.getItem(this.KEY[type]) || '[]'); } catch(e) { return []; }
  },
  save(type, items) {
    try { localStorage.setItem(this.KEY[type], JSON.stringify(items)); return true; }
    catch(e) { toast('ストレージ容量が不足しています。ファイルを削除して空き容量を確保してください'); return false; }
  },
  add(type, item) { const a = this.get(type); a.unshift(item); return this.save(type, a); },
  remove(type, id) { return this.save(type, this.get(type).filter(i => i.id !== id)); },
  find(type, id) { return this.get(type).find(i => i.id === id) || null; }
};

let _mediaActiveTab = 'images';

function switchMediaTab(tab) {
  _mediaActiveTab = tab;
  document.getElementById('tabImages').classList.toggle('active', tab==='images');
  document.getElementById('tabVideos').classList.toggle('active', tab==='videos');
  document.getElementById('media-pane-images').style.display = tab==='images' ? '' : 'none';
  document.getElementById('media-pane-videos').style.display = tab==='videos' ? '' : 'none';
  document.getElementById('mediaTabTitle').textContent = tab==='images' ? '画像' : '動画';
}

function renderMedia() {
  _renderMediaPane('images');
  _renderMediaPane('videos');
}

function _renderMediaPane(type) {
  const items = MediaLib.get(type);
  const grid  = document.getElementById(type==='images' ? 'imgGrid' : 'vidGrid');
  const empty = document.getElementById(type==='images' ? 'imgEmpty' : 'vidEmpty');
  empty.style.display = items.length ? 'none' : '';
  if (!items.length) { grid.innerHTML = ''; return; }
  grid.innerHTML = items.map(item => {
    const id = item.id;
    const thumb = type==='images'
      ? `<img class="media-thumb" src="${esc(item.data)}" alt="${esc(item.name)}" onclick="previewMediaItem('${type}','${id}')" />`
      : `<video class="media-thumb-vid" src="${esc(item.data)}" preload="metadata" onclick="previewMediaItem('${type}','${id}')"></video>`;
    const previewIcon = type==='images'
      ? `<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>`;
    return `<div class="media-card">
      ${thumb}
      <div class="media-card-body">
        <div class="media-card-name" title="${esc(item.name)}">${esc(item.name)}</div>
        <div class="media-card-meta">${_fmtBytes(item.size)} · ${esc(item.date)}</div>
        <div class="media-card-actions">
          <button class="btn btn-ghost btn-sm btn-icon" title="プレビュー" onclick="previewMediaItem('${type}','${id}')">${previewIcon}</button>
          <button class="btn btn-ghost btn-sm btn-icon" title="URLをコピー" onclick="copyMediaURL('${type}','${id}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm btn-icon" title="削除" onclick="deleteMediaItem('${type}','${id}')">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function handleMediaUpload(e, type) {
  const files = Array.from(e.target.files);
  e.target.value = '';
  _uploadMediaFiles(files, type);
}

function mediaDropFiles(e, type) {
  e.preventDefault();
  const zoneId = type==='images' ? 'imgDropZone' : 'vidDropZone';
  document.getElementById(zoneId).classList.remove('drag-over');
  const accept = type==='images' ? /^image\// : /^video\//;
  _uploadMediaFiles(Array.from(e.dataTransfer.files).filter(f => accept.test(f.type)), type);
}

function mediaDragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.add('drag-over');
}

function mediaDragLeave(zoneId) {
  document.getElementById(zoneId).classList.remove('drag-over');
}

function _uploadMediaFiles(files, type) {
  if (!files.length) { toast('対応していないファイル形式です'); return; }
  const MAX = type==='images' ? 5*1024*1024 : 50*1024*1024;
  let done = 0, ok = 0;
  files.forEach(file => {
    if (file.size > MAX) {
      toast(`${file.name}：ファイルサイズが上限を超えています`);
      if (++done === files.length) _renderMediaPane(type);
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const added = MediaLib.add(type, {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
        name: file.name,
        size: file.size,
        date: new Date().toLocaleDateString('ja-JP'),
        data: ev.target.result
      });
      if (added) ok++;
      if (++done === files.length) {
        _renderMediaPane(type);
        if (ok) toast(`${ok}件のファイルをアップロードしました`);
      }
    };
    reader.readAsDataURL(file);
  });
}

function deleteMediaItem(type, id) {
  if (!confirm('このファイルを削除しますか？')) return;
  MediaLib.remove(type, id);
  _renderMediaPane(type);
  toast('削除しました');
}

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

function previewMediaItem(type, id) {
  const item = MediaLib.find(type, id);
  if (!item) return;
  const imgEl  = document.getElementById('mediaPreviewImg');
  const vidEl  = document.getElementById('mediaPreviewVid');
  const nameEl = document.getElementById('mediaPreviewName');
  nameEl.textContent = item.name;
  if (type==='images') {
    imgEl.src = item.data;
    imgEl.style.display = 'block';
    vidEl.style.display = 'none';
    vidEl.src = '';
  } else {
    vidEl.src = item.data;
    vidEl.style.display = 'block';
    imgEl.style.display = 'none';
    imgEl.src = '';
  }
  document.getElementById('mediaPreviewOverlay').classList.add('open');
}

function closeMediaPreview() {
  const vidEl = document.getElementById('mediaPreviewVid');
  vidEl.pause();
  vidEl.src = '';
  document.getElementById('mediaPreviewImg').src = '';
  document.getElementById('mediaPreviewOverlay').classList.remove('open');
}

function _fmtBytes(b) {
  if (!b) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/(1024*1024)).toFixed(1) + ' MB';
}
