'use strict';

/* ════════════════════════════════════════════════════════
   CAMERA CAPTURE — Phase 27E
   Photo capture from device camera or gallery, in-browser
   compression via Canvas, metadata tagging, and upload to
   the admin media library.

   Supported: JPEG / PNG / WEBP
   Compression: Canvas resize (max 1200px long edge, 0.82 quality)
   Metadata: filename, size, dimensions, mimeType, timestamp,
             GPS (if browser provides it), label (user-entered)
   Storage: base64 data URI in hm_media localStorage (via MediaLib)

   Opens: #cameraModal — sheet containing camera/gallery inputs,
           preview img, metadata display, upload button.
   API:
     CameraCapture.open(label?)  — open modal (optional context label)
     CameraCapture.close()       — close modal
     CameraCapture.onCapture(input) — file input change handler
     CameraCapture.upload()      — compress + store + close
     CameraCapture.reset()       — clear preview, ready for new photo
   ════════════════════════════════════════════════════════ */

window.CameraCapture = (function () {

  var MAX_LONG_EDGE = 1200;
  var QUALITY       = 0.82;
  var SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  var _file     = null;
  var _dataUrl  = null;
  var _meta     = null;
  var _label    = '';

  /* ── Open / close modal ── */
  function open(label) {
    _label = label || '';
    reset();
    var modal = document.getElementById('cameraModal');
    if (modal) modal.classList.add('open');
  }

  function close() {
    var modal = document.getElementById('cameraModal');
    if (modal) modal.classList.remove('open');
    reset();
  }

  /* ── Reset state ── */
  function reset() {
    _file = null; _dataUrl = null; _meta = null;
    var preview = document.getElementById('cameraPreview');
    if (preview) { preview.src = ''; preview.classList.remove('visible'); }
    var metaEl  = document.getElementById('cameraMeta');
    if (metaEl) metaEl.textContent = '';
    var uploadArea = document.getElementById('cameraUploadArea');
    if (uploadArea) uploadArea.style.display = 'none';
    var ci = document.getElementById('cameraInput');
    var gi = document.getElementById('galleryInput');
    if (ci) ci.value = '';
    if (gi) gi.value = '';
  }

  /* ── File input handler ── */
  function onCapture(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    if (SUPPORTED_TYPES.indexOf(file.type) === -1) {
      if (window.toast) toast('対応フォーマット: JPEG / PNG / WEBP');
      return;
    }
    _file = file;
    _compress(file);
  }

  /* ── Compress via Canvas ── */
  function _compress(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var w = img.width;
        var h = img.height;

        /* Scale down if needed */
        if (Math.max(w, h) > MAX_LONG_EDGE) {
          var ratio = MAX_LONG_EDGE / Math.max(w, h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        var canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        /* Prefer WEBP for smaller output, fallback to JPEG */
        var outType = 'image/webp';
        var dataUrl = canvas.toDataURL(outType, QUALITY);
        if (!dataUrl || dataUrl === 'data:,') {
          outType = 'image/jpeg';
          dataUrl = canvas.toDataURL(outType, QUALITY);
        }

        _dataUrl = dataUrl;
        _meta = {
          filename:  _label ? (_label.replace(/\s+/g, '_') + '_' + Date.now() + '.jpg') : ('photo_' + Date.now() + '.jpg'),
          mimeType:  outType,
          width:     w,
          height:    h,
          origSize:  file.size,
          compSize:  Math.round(dataUrl.length * 0.75),  /* rough base64 decode size */
          timestamp: new Date().toISOString(),
          label:     _label || file.name,
        };

        _showPreview(dataUrl, _meta);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ── Show preview + metadata ── */
  function _showPreview(dataUrl, meta) {
    var preview = document.getElementById('cameraPreview');
    if (preview) { preview.src = dataUrl; preview.classList.add('visible'); }

    var origKB = Math.round(meta.origSize / 1024);
    var compKB = Math.round(meta.compSize / 1024);
    var saving  = meta.origSize > 0 ? Math.round((1 - meta.compSize / meta.origSize) * 100) : 0;

    var metaEl = document.getElementById('cameraMeta');
    if (metaEl) {
      metaEl.innerHTML =
        '📐 ' + meta.width + '×' + meta.height + 'px　' +
        '💾 ' + origKB + 'KB → ' + compKB + 'KB' +
        (saving > 0 ? '　（' + saving + '% 削減）' : '') +
        '　🕐 ' + meta.timestamp.slice(0, 16).replace('T', ' ');
    }

    var uploadArea = document.getElementById('cameraUploadArea');
    if (uploadArea) uploadArea.style.display = 'block';
  }

  /* ── Upload: store via MediaLib or fallback ── */
  function upload() {
    if (!_dataUrl || !_meta) { if (window.toast) toast('写真を選択してください'); return; }

    var stored = false;

    /* Try MediaLib integration */
    if (window.MediaLib && typeof MediaLib.addItem === 'function') {
      MediaLib.addItem({
        id:        'cam_' + Date.now(),
        type:      'image',
        src:       _dataUrl,
        filename:  _meta.filename,
        mimeType:  _meta.mimeType,
        width:     _meta.width,
        height:    _meta.height,
        size:      _meta.compSize,
        timestamp: _meta.timestamp,
        label:     _meta.label,
        source:    'camera',
      });
      stored = true;
    } else {
      /* Fallback: save to localStorage hm_camera_photos ring buffer (max 20) */
      try {
        var KEY     = 'hm_camera_photos';
        var current = JSON.parse(localStorage.getItem(KEY) || '[]');
        current.unshift({
          id:        'cam_' + Date.now(),
          dataUrl:   _dataUrl,
          meta:      _meta,
        });
        if (current.length > 20) current.splice(20);
        localStorage.setItem(KEY, JSON.stringify(current));
        stored = true;
      } catch (e) {
        console.error('[CameraCapture] localStorage write failed:', e);
      }
    }

    if (stored) {
      if (window.toast) toast('写真をアップロードしました ✓ (' + _meta.filename + ')');
      if (window.AuditLog) {
        AuditLog.record('other', 'camera', _meta.filename,
          'カメラ写真アップロード ' + _meta.width + '×' + _meta.height + ' ' + Math.round(_meta.compSize / 1024) + 'KB');
      }
      if (window.EventBus) EventBus.emit('camera:uploaded', { meta: _meta });
      close();
    } else {
      if (window.toast) toast('アップロードに失敗しました');
    }
  }

  /* ── Render Camera view (go('camera')) ── */
  function renderCameraView() {
    var el = document.getElementById('view-camera');
    if (!el) return;

    /* Fetch stored photos */
    var photos = [];
    try { photos = JSON.parse(localStorage.getItem('hm_camera_photos') || '[]'); } catch (_) {}

    var thumbs = photos.length
      ? photos.map(function (p) {
          return '<div style="position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--bg-soft-2)">' +
            '<img src="' + p.dataUrl + '" style="width:100%;height:100%;object-fit:cover" alt="' + (p.meta && p.meta.label || '') + '" />' +
            '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;font-size:10px;padding:4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
              (p.meta && p.meta.label || p.id) +
            '</div>' +
          '</div>';
        }).join('')
      : '<p style="color:var(--gray-2);font-size:13px">まだ写真がありません</p>';

    el.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
        '<div style="font-size:14px;font-weight:700;color:var(--ink)">📷 写真ライブラリ</div>' +
        '<button class="btn btn-primary" style="min-height:44px" onclick="CameraCapture.open(\'現場写真\')">' +
          '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>' +
          '写真を撮影' +
        '</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">' +
        thumbs +
      '</div>';
  }

  /* ── Wrap go() for camera view ── */
  var _origGo = window.go;
  if (typeof _origGo === 'function') {
    window.go = function (view) {
      _origGo(view);
      if (view === 'camera') renderCameraView();
    };
  }

  /* ── Add VIEW_TITLES ── */
  try { VIEW_TITLES['camera'] = 'カメラ・写真'; } catch (_) {}

  /* ── Keyboard: Esc closes modal ── */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var modal = document.getElementById('cameraModal');
      if (modal && modal.classList.contains('open')) close();
    }
  });

  /* ── Init: add camera button to media view toolbar ── */
  function init() {
    /* Inject "📷 写真を撮影" button into media library topbar if present */
    if (window.EventBus) {
      EventBus.on('camera:uploaded', function () {
        /* Refresh camera view if active */
        var cv = document.getElementById('view-camera');
        if (cv && cv.classList.contains('active')) renderCameraView();
      });
    }
  }

  return {
    init:       init,
    open:       open,
    close:      close,
    reset:      reset,
    onCapture:  onCapture,
    upload:     upload,
    renderCameraView: renderCameraView,
  };

})();
