'use strict';
/* ══════════════════════════════════════════════════════
   WMC Services Image Management (Phase 28)
   Entry point: _wmcRenderServices()
   Reads:  hm_data key 'hm_service_images'
   Writes: hm_data key 'hm_service_images'
   Public site reads via ContentLoader → _applyServiceImages()
   ══════════════════════════════════════════════════════ */

var _WMC_SVC_DEFS = [
  { slug: 'emergency', title: '当日・お急ぎ引越しプラン', icon: '⚡' },
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

  localStorage.setItem('hm_service_images', JSON.stringify(images));
  localStorage.setItem('hm_last_content_update', new Date().toISOString());

  if (window.SupabaseClient) {
    var r = await window.SupabaseClient
      .from('hm_data')
      .upsert({ key: 'hm_service_images', value: images, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (r.error) {
      console.warn('[wmcServices] Supabase write failed:', r.error.message);
      if (typeof toast !== 'undefined') toast('保存失敗: ' + r.error.message);
    } else {
      if (typeof toast !== 'undefined') toast('サービス画像設定を保存しました');
    }
  } else {
    if (typeof toast !== 'undefined') toast('ローカルに保存しました（Supabase未接続）');
  }

  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('update', 'services', 'images', 'サービス画像設定を保存');

  if (btn) { btn.disabled = false; btn.textContent = 'すべて保存'; }
  _wmcRenderServices();
}
