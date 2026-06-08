'use strict';

/* ════════════════════════════════════════════════════════
   WMC MEDIA LIBRARY
   Standalone media manager for websiteManagement.html.
   Features:
   • Upload images (drag-drop or file input)
   • Auto-compress to WebP (Canvas, max 1920px, 0.85q)
   • Folder organise (create / move)
   • Search by filename
   • Copy image URL to clipboard
   • Delete images
   • Image picker modal (for Block Editor integration)

   Storage key  : hm_wmc_media → array of media objects
   Supabase sync: hm_data KV table, key = hm_wmc_media
   ════════════════════════════════════════════════════════ */

window.WMCMedia = (function () {

  var STORAGE_KEY   = 'hm_wmc_media';
  var MAX_LONG_EDGE = 1920;
  var QUALITY       = 0.85;
  var _currentFolder = 'all';
  var _searchQuery   = '';
  var _searchTimer   = null;
  var _pickerCallback = null;  /* set when openPicker() is called */

  /* ════════════════════════════════════════════════════════
     STORAGE
     ════════════════════════════════════════════════════════ */
  function _load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(_) { return []; }
  }

  function _save(items) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch(e) {
      if (typeof toast === 'function') toast('ストレージ容量が不足しています。画像を削除してください。');
    }
    _syncSb(items);
  }

  function _syncSb(items) {
    var sb = window.SupabaseClient;
    if (!sb) return;
    /* Only sync metadata (strip data URLs to keep payload small) */
    var meta = items.map(function(it) {
      return { id:it.id, name:it.name, folder:it.folder, size:it.size, w:it.w, h:it.h, date:it.date, type:it.type, url:it.url||'' };
    });
    sb.from('hm_data')
      .upsert({ key: STORAGE_KEY + '_meta', value: JSON.stringify(meta), updated_at: new Date().toISOString() })
      .then(function(r){ if (r.error) console.warn('[WMCMedia] sync meta:', r.error.message); });
  }

  function getAll()      { return _load(); }
  function getItem(id)   { return _load().find(function(i){ return i.id === id; }) || null; }
  function getFolders()  {
    var folders = ['uncategorized'];
    _load().forEach(function(it) { if (it.folder && !folders.includes(it.folder)) folders.push(it.folder); });
    return folders;
  }

  /* ════════════════════════════════════════════════════════
     COMPRESS & CONVERT TO WEBP
     ════════════════════════════════════════════════════════ */
  function _compress(file, callback) {
    var reader = new FileReader();
    reader.onerror = function() { callback(new Error('ファイルの読み込みに失敗しました'), null); };
    reader.onload = function(e) {
      var img = new Image();
      img.onerror = function() { callback(new Error('画像の解析に失敗しました'), null); };
      img.onload = function() {
        var w = img.width, h = img.height;
        if (w > MAX_LONG_EDGE) { h = Math.round(h * MAX_LONG_EDGE / w); w = MAX_LONG_EDGE; }
        if (h > MAX_LONG_EDGE) { w = Math.round(w * MAX_LONG_EDGE / h); h = MAX_LONG_EDGE; }
        var canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);

        var webpAvail = canvas.toDataURL('image/webp').startsWith('data:image/webp');
        var mime      = webpAvail ? 'image/webp' : 'image/jpeg';
        var dataUrl   = canvas.toDataURL(mime, QUALITY);

        /* Approximate compressed size from base64 length */
        var compressedSize = Math.round((dataUrl.length - 'data:image/webp;base64,'.length) * 3 / 4);
        callback(null, { dataUrl:dataUrl, w:w, h:h, size:compressedSize, mime:mime });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ════════════════════════════════════════════════════════
     UPLOAD
     ════════════════════════════════════════════════════════ */
  function upload(files, folder) {
    var arr    = Array.from(files || []);
    var folder = folder || _currentFolder === 'all' ? 'uncategorized' : _currentFolder;
    if (arr.length === 0) return;

    _setUploadStatus('uploading', arr.length + '枚の画像を処理中…');

    var done = 0;
    arr.forEach(function(file) {
      if (!file.type.startsWith('image/')) {
        done++;
        if (done === arr.length) { _setUploadStatus('done', ''); render(); }
        return;
      }
      _compress(file, function(err, result) {
        done++;
        if (!err) {
          var id = 'IMG-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,5);
          var ext = result.mime === 'image/webp' ? 'webp' : 'jpg';
          var name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
          var items = _load();
          items.unshift({
            id: id, name: name, folder: folder,
            size: result.size, w: result.w, h: result.h,
            date: new Date().toLocaleDateString('ja-JP'),
            type: result.mime,
            data: result.dataUrl,
            url: '',  /* will be set if Supabase Storage upload succeeds */
          });
          _save(items);

          /* Try upload to Supabase Storage */
          _uploadToStorage(result.dataUrl, id + '.' + ext, result.mime).then(function(publicUrl) {
            if (publicUrl) {
              var current = _load();
              var idx = current.findIndex(function(x){ return x.id === id; });
              if (idx !== -1) { current[idx].url = publicUrl; _save(current); }
            }
          });
        }
        if (done === arr.length) {
          _setUploadStatus('done', '');
          if (typeof AuditLog !== 'undefined') AuditLog.record('add', 'media', 'upload', arr.length + '枚の画像をアップロード');
          render();
          if (typeof toast === 'function') toast(arr.length + '枚の画像を追加しました');
        }
      });
    });
  }

  /* Supabase Storage upload — best-effort, non-blocking */
  function _uploadToStorage(dataUrl, filename, mime) {
    var sb = window.SupabaseClient;
    if (!sb || !sb.storage) return Promise.resolve(null);
    try {
      var b64   = dataUrl.split(',')[1];
      var bytes = Uint8Array.from(atob(b64), function(c){ return c.charCodeAt(0); });
      var blob  = new Blob([bytes], { type: mime });
      var path  = 'wmc/' + Date.now() + '-' + filename;
      return sb.storage.from('media').upload(path, blob, { contentType: mime, upsert: false })
        .then(function(r) {
          if (r.error) return null;
          var urlRes = sb.storage.from('media').getPublicUrl(path);
          return (urlRes.data && urlRes.data.publicUrl) || null;
        })
        .catch(function() { return null; });
    } catch(_) { return Promise.resolve(null); }
  }

  function _setUploadStatus(state, msg) {
    var el = document.getElementById('wmcMediaUploadStatus');
    if (!el) return;
    if (state === 'uploading') {
      el.style.display = 'flex';
      el.innerHTML = '<div style="width:14px;height:14px;border:2px solid rgba(37,99,235,.3);border-top-color:var(--blue);border-radius:50%;animation:lspin .6s linear infinite"></div>' +
        '<span>' + (msg || '処理中…') + '</span>';
    } else {
      el.style.display = 'none';
    }
  }

  /* ════════════════════════════════════════════════════════
     CRUD
     ════════════════════════════════════════════════════════ */
  function deleteMedia(id) {
    var items   = _load();
    var item    = items.find(function(x){ return x.id === id; });
    if (!item)  return;
    if (!confirm('「' + item.name + '」を削除しますか？')) return;
    _save(items.filter(function(x){ return x.id !== id; }));
    if (typeof AuditLog !== 'undefined') AuditLog.record('delete', 'media', id, '画像を削除: ' + item.name);
    if (typeof toast === 'function') toast('画像を削除しました');
    render();
  }

  function moveToFolder(id, newFolder) {
    var items = _load();
    var idx   = items.findIndex(function(x){ return x.id === id; });
    if (idx === -1) return;
    items[idx].folder = newFolder;
    _save(items);
    render();
  }

  function createFolder(name) {
    if (!name || !name.trim()) return;
    /* Folders are implicit — just update current filter */
    _currentFolder = name.trim();
    render();
    if (typeof toast === 'function') toast('フォルダー「' + name + '」に切り替えました');
  }

  function copyUrl(id) {
    var item = getItem(id);
    if (!item) return;
    var url = item.url || item.data;
    try {
      navigator.clipboard.writeText(url).then(function() {
        if (typeof toast === 'function') toast('URLをクリップボードにコピーしました');
      });
    } catch(_) {
      /* Fallback */
      var ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      if (typeof toast === 'function') toast('URLをコピーしました');
    }
  }

  /* ════════════════════════════════════════════════════════
     SEARCH & FILTER
     ════════════════════════════════════════════════════════ */
  function _getFiltered() {
    var items = _load();
    if (_currentFolder !== 'all') {
      items = items.filter(function(it){ return it.folder === _currentFolder; });
    }
    if (_searchQuery.trim()) {
      var q = _searchQuery.trim().toLowerCase();
      items = items.filter(function(it){ return it.name.toLowerCase().includes(q); });
    }
    return items;
  }

  /* ════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════ */
  function render() {
    var el = document.getElementById('wmcMediaContent');
    if (!el) return;

    var all      = _load();
    var filtered = _getFiltered();
    var folders  = getFolders();

    /* ── Toolbar ── */
    var toolbar =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">' +
        '<input id="wmcMediaSearch" placeholder="ファイル名で検索…" value="' + _esc(_searchQuery) + '" ' +
          'style="flex:1;min-width:180px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:inherit;color:var(--ink);background:var(--bg)" />' +
        '<label style="display:flex;align-items:center;gap:6px;padding:7px 14px;background:var(--blue);color:#fff;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
          'アップロード' +
          '<input type="file" accept="image/*" multiple onchange="WMCMedia.upload(this.files)" style="display:none" />' +
        '</label>' +
        '<button class="btn btn-ghost btn-sm" onclick="WMCMedia.openNewFolder()">+ フォルダー</button>' +
      '</div>';

    /* ── Status row ── */
    var status =
      '<div id="wmcMediaUploadStatus" style="display:none;align-items:center;gap:8px;font-size:12px;color:var(--blue);margin-bottom:10px"></div>' +
      '<div style="font-size:12px;color:var(--gray-2);margin-bottom:14px">' +
        '全ファイル: <strong style="color:var(--ink)">' + all.length + '</strong>' +
        (filtered.length !== all.length ? ' · 表示中: <strong>' + filtered.length + '</strong>' : '') +
      '</div>';

    /* ── Folder tabs ── */
    var folderTabs =
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">' +
        _folderTab('all', 'すべて', all.length) +
        folders.map(function(f) {
          var cnt = all.filter(function(it){ return it.folder === f; }).length;
          return _folderTab(f, f, cnt);
        }).join('') +
      '</div>';

    /* ── Drop zone (always shown) ── */
    var dropZone =
      '<div id="wmcDropZone" ' +
        'ondragover="event.preventDefault();this.style.borderColor=\'var(--blue)\';this.style.background=\'rgba(37,99,235,.04)\'" ' +
        'ondragleave="this.style.borderColor=\'var(--line)\';this.style.background=\'var(--bg-soft-2)\'" ' +
        'ondrop="event.preventDefault();this.style.borderColor=\'var(--line)\';this.style.background=\'var(--bg-soft-2)\';WMCMedia.upload(event.dataTransfer.files)" ' +
        'style="border:2px dashed var(--line);border-radius:10px;padding:16px;text-align:center;color:var(--gray-2);font-size:12px;margin-bottom:14px;background:var(--bg-soft-2);transition:.15s">' +
        '<div>画像をここにドラッグ&ドロップ、または「アップロード」ボタンをクリック</div>' +
        '<div style="font-size:11px;margin-top:3px">JPEG, PNG, GIF, WebP — 自動的にWebPに変換・圧縮されます</div>' +
      '</div>';

    /* ── Grid ── */
    var gridHtml = '';
    if (filtered.length === 0) {
      gridHtml = '<div class="wmc-placeholder" style="padding:40px">' +
        '<div class="wmc-placeholder-icon">🖼</div>' +
        '<div class="wmc-placeholder-title">' + (_searchQuery || _currentFolder !== 'all' ? '一致する画像がありません' : '画像がありません') + '</div>' +
        '<div class="wmc-placeholder-text">上の「アップロード」ボタン、またはドラッグ&ドロップで追加してください</div>' +
      '</div>';
    } else {
      gridHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">' +
        filtered.map(function(item) { return _cardHtml(item, false); }).join('') +
      '</div>';
    }

    el.innerHTML = toolbar + status + folderTabs + dropZone + gridHtml;
    _bindSearchEvent();
  }

  function _folderTab(value, label, count) {
    var active = _currentFolder === value;
    return '<button onclick="WMCMedia.setFolder(\'' + _esc(value) + '\')" ' +
      'style="padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:.15s;' +
      (active
        ? 'background:var(--blue);color:#fff;border:none'
        : 'background:var(--bg-soft);color:var(--gray-1);border:1px solid var(--line)') + '">' +
      _esc(label) + ' (' + count + ')' +
    '</button>';
  }

  function _cardHtml(item, isPickerMode) {
    var src   = item.data || item.url || '';
    var fmtSz = _fmtSize(item.size || 0);
    var actionBtn = isPickerMode
      ? '<button onclick="WMCMedia._pick(\'' + item.id + '\')" style="width:100%;padding:7px;background:var(--blue);color:#fff;border:none;border-radius:0 0 9px 9px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">選択</button>'
      : '<div style="display:flex;border-top:1px solid var(--line)">' +
          '<button onclick="WMCMedia.copyUrl(\'' + item.id + '\')" title="URLをコピー" style="flex:1;padding:6px;background:none;border:none;cursor:pointer;font-size:12px;color:var(--gray-1);font-family:inherit;border-right:1px solid var(--line);transition:.15s" onmouseover="this.style.color=\'var(--blue)\'" onmouseout="this.style.color=\'var(--gray-1)\'">🔗</button>' +
          '<button onclick="WMCMedia.openMoveFolder(\'' + item.id + '\')" title="フォルダーを移動" style="flex:1;padding:6px;background:none;border:none;cursor:pointer;font-size:12px;color:var(--gray-1);font-family:inherit;border-right:1px solid var(--line);transition:.15s" onmouseover="this.style.color=\'var(--blue)\'" onmouseout="this.style.color=\'var(--gray-1)\'">📁</button>' +
          '<button onclick="WMCMedia.deleteMedia(\'' + item.id + '\')" title="削除" style="flex:1;padding:6px;background:none;border:none;cursor:pointer;font-size:12px;color:var(--red);font-family:inherit;transition:.15s" onmouseover="this.style.opacity=.7" onmouseout="this.style.opacity=1">🗑</button>' +
        '</div>';

    return '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column">' +
      '<div style="aspect-ratio:1;overflow:hidden;background:var(--bg-soft-2)">' +
        (src ? '<img src="' + _esc(src) + '" style="width:100%;height:100%;object-fit:cover;transition:.2s" ' +
          'onmouseover="this.style.transform=\'scale(1.05)\'" onmouseout="this.style.transform=\'scale(1)\'" />'
          : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--gray-2);font-size:24px">🖼</div>'
        ) +
      '</div>' +
      '<div style="padding:8px 10px;flex:1">' +
        '<div style="font-size:12px;font-weight:500;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + _esc(item.name) + '">' + _esc(item.name) + '</div>' +
        '<div style="font-size:10px;color:var(--gray-2);margin-top:2px">' + fmtSz + (item.w ? ' · ' + item.w + '×' + item.h : '') + '</div>' +
        (item.type && item.type.includes('webp') ? '<span style="font-size:9px;font-weight:700;background:rgba(16,185,129,.1);color:#059669;padding:1px 5px;border-radius:4px;border:1px solid rgba(16,185,129,.2)">WebP</span>' : '') +
      '</div>' +
      actionBtn +
    '</div>';
  }

  /* ── Search binding ── */
  function _bindSearchEvent() {
    var sinput = document.getElementById('wmcMediaSearch');
    if (sinput) {
      sinput.addEventListener('input', function() {
        _searchQuery = this.value;
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(render, 180);
      });
    }
  }

  /* ════════════════════════════════════════════════════════
     FOLDER ACTIONS
     ════════════════════════════════════════════════════════ */
  function setFolder(f) { _currentFolder = f; render(); }

  function openNewFolder() {
    var name = prompt('新しいフォルダー名を入力してください:');
    if (name) createFolder(name.trim());
  }

  function openMoveFolder(id) {
    var folders = getFolders();
    var item    = getItem(id);
    if (!item) return;
    var opts = ['uncategorized'].concat(folders.filter(function(f){ return f !== 'uncategorized'; }));
    var sel  = opts.findIndex(function(f){ return f === item.folder; });

    _wmcCloseModal('wmcMoveFolderModal');
    var bodyHtml =
      '<div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:14px">フォルダーを移動</div>' +
      '<div style="font-size:12px;color:var(--gray-2);margin-bottom:12px">「' + _esc(item.name) + '」</div>' +
      '<div style="margin-bottom:16px">' +
        opts.map(function(f) {
          var active = f === item.folder;
          return '<button onclick="WMCMedia.moveToFolder(\'' + item.id + '\',\'' + _esc(f) + '\');_wmcCloseModal(\'wmcMoveFolderModal\')" ' +
            'style="display:block;width:100%;text-align:left;padding:8px 12px;margin-bottom:4px;border-radius:7px;border:1px solid ' + (active ? 'var(--blue)' : 'var(--line)') + ';background:' + (active ? 'rgba(37,99,235,.06)' : 'var(--bg-soft)') + ';cursor:pointer;font-size:13px;font-family:inherit;color:var(--ink)">' +
            '📁 ' + _esc(f) + (active ? ' <span style="font-size:11px;color:var(--blue)">(現在)</span>' : '') +
          '</button>';
        }).join('') +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end">' +
        '<button class="btn btn-ghost" onclick="_wmcCloseModal(\'wmcMoveFolderModal\')">キャンセル</button>' +
      '</div>';

    var ov = document.createElement('div');
    ov.id = 'wmcMoveFolderModal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = '<div style="background:var(--bg);border-radius:14px;padding:22px;max-width:360px;width:100%;border:1px solid var(--line);box-shadow:0 20px 60px rgba(0,0,0,.25)">' + bodyHtml + '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e) { if (e.target === ov) _wmcCloseModal('wmcMoveFolderModal'); });
  }

  /* ════════════════════════════════════════════════════════
     IMAGE PICKER (for Block Editor)
     ════════════════════════════════════════════════════════ */
  function openPicker(callback) {
    _pickerCallback = callback;
    var items = _load();

    _wmcCloseModal('wmcMediaPickerModal');
    var ov = document.createElement('div');
    ov.id = 'wmcMediaPickerModal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:700;display:flex;align-items:center;justify-content:center;padding:20px';

    var gridHtml = items.length > 0
      ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">' +
          items.map(function(it){ return _cardHtml(it, true); }).join('') +
        '</div>'
      : '<div style="text-align:center;padding:32px;color:var(--gray-2)">' +
          '<div style="font-size:28px;margin-bottom:10px;opacity:.4">🖼</div>' +
          '<div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px">メディアがありません</div>' +
          '<label style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:var(--blue);color:#fff;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">' +
            'アップロード' +
            '<input type="file" accept="image/*" multiple onchange="WMCMedia.upload(this.files)" style="display:none" />' +
          '</label>' +
        '</div>';

    ov.innerHTML = '<div style="background:var(--bg);border-radius:14px;padding:22px;max-width:700px;width:100%;border:1px solid var(--line);box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:80vh;display:flex;flex-direction:column">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-shrink:0">' +
        '<span style="font-size:15px;font-weight:700;color:var(--ink)">メディアから選択</span>' +
        '<div style="display:flex;gap:8px">' +
          '<label style="display:flex;align-items:center;gap:5px;padding:6px 12px;background:var(--blue);color:#fff;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer">' +
            '+ アップロード' +
            '<input type="file" accept="image/*" multiple onchange="WMCMedia.upload(this.files)" style="display:none" />' +
          '</label>' +
          '<button onclick="_wmcCloseModal(\'wmcMediaPickerModal\')" class="btn btn-ghost btn-sm">閉じる</button>' +
        '</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto">' + gridHtml + '</div>' +
    '</div>';

    document.body.appendChild(ov);
    ov.addEventListener('click', function(e) { if (e.target === ov) _wmcCloseModal('wmcMediaPickerModal'); });
  }

  function _pick(id) {
    var item = getItem(id);
    if (!item) return;
    var url = item.url || item.data || '';
    _wmcCloseModal('wmcMediaPickerModal');
    if (_pickerCallback) {
      _pickerCallback(url);
      _pickerCallback = null;
    }
  }

  /* ════════════════════════════════════════════════════════
     UTILITIES
     ════════════════════════════════════════════════════════ */
  function _fmtSize(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1024*1024)   return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/(1024*1024)).toFixed(2) + ' MB';
  }
  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return {
    getAll, getItem, getFolders,
    upload, deleteMedia, moveToFolder, createFolder, copyUrl,
    setFolder, openNewFolder, openMoveFolder,
    openPicker, _pick,
    render,
  };

})();
