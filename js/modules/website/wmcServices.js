'use strict';
/* ══════════════════════════════════════════════════════
   WMC Services Image Management (Phase 28)
   Entry point: _wmcRenderServices()
   Reads:  hm_data key 'hm_service_images'
   Writes: hm_data key 'hm_service_images'
   Public site reads via ContentLoader → _applyServiceImages()
   ══════════════════════════════════════════════════════ */

var _WMC_SVC_DEFS = [
  /* slug 'sameday' is the canonical key shared with index.html SERVICE_CONFIG +
     contentLoader (_REF_TO_SLUG SVC-4). Legacy 'emergency' is still accepted on
     read via contentLoader's _SLUG_ALIAS. */
  { slug: 'sameday',   title: '当日・お急ぎ引越しプラン', icon: '⚡' },
  { slug: 'single',    title: '単身引越し',             icon: '👤' },
  { slug: 'couple',    title: 'カップル・ご夫婦引越し', icon: '👫' },
  { slug: 'student',   title: '学生・新生活引越し',     icon: '🎓' },
  { slug: 'disposal',  title: '不用品回収・処分',       icon: '♻️'  },
  { slug: 'furniture', title: '家具組立・分解',         icon: '🔧' },
];

function _wmcSvcLoadImages() {
  try {
    var raw = localStorage.getItem('hm_service_images');
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

/* ── Image storage (reuse the shared media bucket via storage.php) ──────────
   Service images are uploaded to media/service-images/<slug>-<ts>.<ext> and only
   the public URL is stored in hm_service_images — never base64 (which would bloat
   hm_data and every public page load). Mirrors the WMC media library uploader. */
async function _wmcSvcUpload(fileOrBlob, slug, mime) {
  var sb = window.api;
  if (!sb || !sb.storage) return null;
  var ext  = (mime && mime.indexOf('/') > -1) ? mime.split('/')[1].split('+')[0] : 'jpg';
  var path = 'service-images/' + slug + '-' + Date.now() + '.' + ext;
  try {
    var r = await sb.storage.from('media').upload(path, fileOrBlob, { contentType: mime || 'image/jpeg', upsert: false });
    if (r && r.error) { console.warn('[wmcServices] upload failed:', r.error.message); return null; }
    var u = sb.storage.from('media').getPublicUrl(path);
    return (u && u.data && u.data.publicUrl) || null;
  } catch (e) { console.warn('[wmcServices] upload error:', e && e.message); return null; }
}

/* Decode a data:image/…;base64,… URI into a Blob for migration uploads. */
function _wmcSvcDataUrlToBlob(dataUrl) {
  var m = /^data:([^;,]+)[^,]*,(.*)$/i.exec(dataUrl || '');
  if (!m) return null;
  var mime = m[1] || 'image/jpeg';
  try {
    var bytes = Uint8Array.from(atob(m[2]), function (c) { return c.charCodeAt(0); });
    return { blob: new Blob([bytes], { type: mime }), mime: mime };
  } catch (_) { return null; }
}

/* File-picker handler: upload the chosen image and put its public URL into the
   card's URL field + switch the card to image mode. Never stores base64. */
async function _wmcSvcPickImage(slug, file) {
  if (!file) return;
  var card  = document.querySelector('.wmc-svc-img-card[data-slug="' + slug + '"]');
  var urlEl = card && card.querySelector('.wmc-svc-img-url');
  if (typeof toast === 'function') toast('画像をアップロード中…');
  var url = await _wmcSvcUpload(file, slug, file.type);
  if (!url) { if (typeof toast === 'function') toast('アップロードに失敗しました'); return; }
  if (urlEl) urlEl.value = url;
  var modeImg = card && card.querySelector('input[name="svc_mode_' + slug + '"][value="image"]');
  if (modeImg) { modeImg.checked = true; modeImg.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof toast === 'function') toast('アップロード完了。「すべて保存」で反映されます');
}

function _wmcSvcCardHtml(svc, cfg) {
  var isSvg   = cfg.display_mode !== 'image';
  var imgUrl  = cfg.image_url || '';
  var preview = (imgUrl && !isSvg)
    ? '<img src="' + esc(imgUrl) + '" alt="" class="wmc-svc-img-preview" style="width:100%;height:90px;object-fit:cover;border-radius:8px;margin-top:10px;border:1px solid var(--line);">'
    : '<div class="wmc-svc-svg-placeholder" style="width:100%;height:90px;border-radius:8px;margin-top:10px;background:var(--bg-soft-2);display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;color:var(--gray-1);border:1px dashed var(--line);">' +
        '<span style="font-size:20px;">' + svc.icon + '</span>SVG（デフォルト）</div>';

  return '<div class="wmc-svc-img-card" data-slug="' + esc(svc.slug) + '">' +
    '<div class="wmc-svc-img-title">' + esc(svc.title) + '</div>' +
    preview +
    '<div class="wmc-svc-img-toggle">' +
      '<label class="wmc-svc-toggle-opt">' +
        '<input type="radio" name="svc_mode_' + esc(svc.slug) + '" value="svg"' + (isSvg ? ' checked' : '') + '>' +
        '<span>SVG（デフォルト）</span>' +
      '</label>' +
      '<label class="wmc-svc-toggle-opt">' +
        '<input type="radio" name="svc_mode_' + esc(svc.slug) + '" value="image"' + (!isSvg ? ' checked' : '') + '>' +
        '<span>画像</span>' +
      '</label>' +
    '</div>' +
    '<input type="url" class="wmc-svc-img-url" placeholder="画像URL（https://...）" value="' + esc(imgUrl) + '">' +
    '<label class="btn btn-ghost btn-sm" style="margin-top:6px;display:inline-flex;align-items:center;gap:6px;cursor:pointer">' +
      '<input type="file" accept="image/*" style="display:none" onchange="_wmcSvcPickImage(\'' + esc(svc.slug) + '\', this.files[0])">' +
      '画像をアップロード' +
    '</label>' +
  '</div>';
}

function _wmcRenderServices() {
  var el = document.getElementById('wmcServicesContent');
  if (!el) return;

  if (typeof WMCPermissions !== 'undefined') {
    WMCPermissions.applyRestriction('services', 'manage_content');
    if (!WMCPermissions.can('manage_content')) return;
  }

  var images = _wmcSvcLoadImages();

  el.innerHTML =
    '<div class="wmc-section-header">' +
      '<div>' +
        '<div class="wmc-section-title">サービス画像管理</div>' +
        '<div class="wmc-section-sub">各サービスカードにSVGアイコンまたは独自画像を設定できます</div>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" id="wmcSvcSaveAllBtn">すべて保存</button>' +
    '</div>' +
    '<div id="wmcSvcGrid" class="wmc-svc-grid">' +
      _WMC_SVC_DEFS.map(function (svc) {
        return _wmcSvcCardHtml(svc, images[svc.slug] || { display_mode: 'svg', image_url: '' });
      }).join('') +
    '</div>' +
    '<p style="margin-top:14px;font-size:11px;color:var(--gray-2);">画像URLを入力し、表示モードを「画像」に切り替えて「すべて保存」をクリックするとサイトに反映されます。空のURLの場合はSVGが表示されます。</p>';

  document.getElementById('wmcSvcSaveAllBtn').addEventListener('click', _wmcSvcSaveAll);

  el.querySelectorAll('.wmc-svc-img-preview').forEach(function (img) {
    img.addEventListener('error', function () { this.style.display = 'none'; });
  });

  /* Live preview on mode toggle */
  el.querySelectorAll('input[type="radio"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      var card    = this.closest('.wmc-svc-img-card');
      var slug    = card.dataset.slug;
      var svc     = _WMC_SVC_DEFS.find(function (s) { return s.slug === slug; });
      var urlEl   = card.querySelector('.wmc-svc-img-url');
      var mode    = card.querySelector('input[name="svc_mode_' + slug + '"]:checked');
      var isSvg   = !mode || mode.value !== 'image';
      var imgUrl  = urlEl ? urlEl.value.trim() : '';
      var prevEl  = card.querySelector('img, .wmc-svc-svg-placeholder');
      if (!prevEl) return;
      if (!isSvg && imgUrl) {
        prevEl.outerHTML = '<img src="' + esc(imgUrl) + '" alt="" class="wmc-svc-img-preview" style="width:100%;height:90px;object-fit:cover;border-radius:8px;margin-top:10px;border:1px solid var(--line);">';
        var newImg = card.querySelector('.wmc-svc-img-preview');
        if (newImg) newImg.addEventListener('error', function () { this.style.display = 'none'; });
      } else {
        prevEl.outerHTML = '<div class="wmc-svc-svg-placeholder" style="width:100%;height:90px;border-radius:8px;margin-top:10px;background:var(--bg-soft-2);display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;color:var(--gray-1);border:1px dashed var(--line);"><span style="font-size:20px;">' + (svc ? svc.icon : '🖼') + '</span>SVG（デフォルト）</div>';
      }
    });
  });
}

async function _wmcSvcSaveAll() {
  var btn = document.getElementById('wmcSvcSaveAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }

  var images = {};
  _WMC_SVC_DEFS.forEach(function (svc) {
    var card  = document.querySelector('.wmc-svc-img-card[data-slug="' + svc.slug + '"]');
    if (!card) return;
    var modeEl = card.querySelector('input[name="svc_mode_' + svc.slug + '"]:checked');
    var urlEl  = card.querySelector('.wmc-svc-img-url');
    images[svc.slug] = {
      display_mode: modeEl ? modeEl.value : 'svg',
      image_url:    urlEl  ? urlEl.value.trim() : '',
    };
  });

  /* Migrate any inline base64 data-URI to an uploaded file so hm_data stores only
     a compact URL. On a failed upload we KEEP the base64 (the image stays visible)
     — service is never blanked during migration. */
  for (var _i = 0; _i < _WMC_SVC_DEFS.length; _i++) {
    var _sl = _WMC_SVC_DEFS[_i].slug, _cfg = images[_sl];
    if (_cfg && /^data:image\//i.test(_cfg.image_url)) {
      var _p = _wmcSvcDataUrlToBlob(_cfg.image_url);
      if (_p) {
        var _u = await _wmcSvcUpload(_p.blob, _sl, _p.mime);
        if (_u) { _cfg.image_url = _u; _cfg.display_mode = 'image'; }
      }
    }
  }

  localStorage.setItem('hm_service_images', JSON.stringify(images));
  localStorage.setItem('hm_last_content_update', new Date().toISOString());

  if (window.api) {
    var r = await window.api
      .from('hm_data')
      .upsert({ key: 'hm_service_images', value: images, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (r.error) {
      console.warn('[wmcServices] API write failed:', r.error.message);
      if (typeof toast !== 'undefined') toast('保存失敗: ' + r.error.message);
    } else {
      if (typeof toast !== 'undefined') toast('サービス画像設定を保存しました');
    }
  } else {
    if (typeof toast !== 'undefined') toast('ローカルに保存しました（API未接続）');
  }

  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('update', 'services', 'images', 'サービス画像設定を保存');

  if (btn) { btn.disabled = false; btn.textContent = 'すべて保存'; }
  _wmcRenderServices();
}
