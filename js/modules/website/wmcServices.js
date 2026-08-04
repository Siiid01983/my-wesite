'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   WMC Services Image Management — サービス画像管理  (table-backed, Phase 2)

   Entry point: _wmcRenderServices()   (unchanged — kept for websiteManagement.html
   registration + wmcGo dispatch). Container: #wmcServicesContent.

   Backend: hm-api/admin/service-images.php  (table hm_service_images)
     GET               → list rows (one per slug, incl. inactive)
     POST (multipart)  → upload/replace image for a slug   (image + service_slug)
     PUT  (json)       → toggle active / edit alt_text / display_order
     DELETE            → remove a slug's image (card reverts to default)
     POST ?action=reorder → persist display_order

   Public site reads via hm-api/service-images.php → ContentLoader folds the
   per-slug image (WebP preferred) onto the homepage cards. A missing/inactive
   row makes the card fall back to its built-in SERVICE_CONFIG placeholder.

   Auth headers (X-API-KEY + X-ADMIN-TOKEN) mirror js/lib/apiClient.js /
   galleryEditor.js so requests pass the api-key + staff gates. Each action saves
   IMMEDIATELY (no batch "すべて保存" step).
   ══════════════════════════════════════════════════════════════════════════ */

var _WMC_SVC_DEFS = [
  { slug: 'sameday',   title: '当日・お急ぎ引越しプラン', icon: '⚡' },
  { slug: 'single',    title: '単身引越し',             icon: '👤' },
  { slug: 'couple',    title: 'カップル・ご夫婦引越し', icon: '👫' },
  { slug: 'student',   title: '学生・新生活引越し',     icon: '🎓' },
  { slug: 'disposal',  title: '不用品回収・処分',       icon: '♻️'  },
  { slug: 'furniture', title: '家具組立・分解',         icon: '🔧' },
];

/* Legacy no-op: servicesEditor.saveServicesAll historically called this batch
   saver. The new panel saves per-action, so this is intentionally a no-op (kept
   so any existing `typeof _wmcSvcSaveAll === 'function'` call stays harmless). */
function _wmcSvcSaveAll() { return Promise.resolve(); }

/* ── Shared media-bucket upload helpers (RETAINED) ──────────────────────────
   These upload to the storage.php `media` bucket via the apiClient storage
   interface (window.api.storage) and are NOT part of the new service-image
   endpoint. They are kept here because js/modules/settings/siteSettings.js
   depends on them to migrate a base64 brand logo to an uploaded file
   (_wmcSvcDataUrlToBlob → _wmcSvcUpload). Do not remove without updating that
   caller. */
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

/* Decode a data:image/…;base64,… URI into a { blob, mime } pair for migration. */
function _wmcSvcDataUrlToBlob(dataUrl) {
  var m = /^data:([^;,]+)[^,]*,(.*)$/i.exec(dataUrl || '');
  if (!m) return null;
  var mime = m[1] || 'image/jpeg';
  try {
    var bytes = Uint8Array.from(atob(m[2]), function (c) { return c.charCodeAt(0); });
    return { blob: new Blob([bytes], { type: mime }), mime: mime };
  } catch (_) { return null; }
}

/* ── API plumbing (mirrors galleryEditor._galApi) ─────────────────────────── */
function _svcApiBase() { return String(window.API_BASE || '').replace(/\/+$/, ''); }
function _svcHeaders(extra) {
  var h = extra || {};
  if (window.API_KEY) h['X-API-KEY'] = window.API_KEY;
  if (window.__HM_ADMIN_TOKEN) h['X-ADMIN-TOKEN'] = window.__HM_ADMIN_TOKEN;
  return h;
}
async function _svcApi(opts) {
  var base = _svcApiBase();
  if (!base) throw new Error('API 未設定（window.API_BASE がありません）');
  var url = base + '/admin/service-images.php';
  if (opts.action) url += '?action=' + encodeURIComponent(opts.action);
  var init = { method: opts.method || 'GET', headers: _svcHeaders() };
  if (opts.formData) {
    init.body = opts.formData;                       // browser sets multipart boundary
  } else if (opts.json) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.json);
  }
  var res  = await fetch(url, init);
  var data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    var msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

/* ── State ────────────────────────────────────────────────────────────────── */
var _svcimgRows = {};   // slug → row (from the table)

function _wmcSvcLoadImages() { return _svcimgRows; }   // (compat shim for older callers)

/* ── Entry / render ───────────────────────────────────────────────────────── */
function _wmcRenderServices() {
  var el = document.getElementById('wmcServicesContent');
  if (!el) return;

  if (typeof WMCPermissions !== 'undefined') {
    WMCPermissions.applyRestriction('services', 'manage_content');
    if (!WMCPermissions.can('manage_content')) return;
  }

  el.innerHTML =
    '<div class="wmc-section-header">' +
      '<div>' +
        '<div class="wmc-section-title">サービス画像管理</div>' +
        '<div class="wmc-section-sub">各サービスカードの画像をアップロード・差し替え・削除・並び替えできます。画像がない場合は既定のプレースホルダーを表示します。</div>' +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" id="svcimgReloadBtn">再読み込み</button>' +
    '</div>' +
    '<div id="svcimgGrid" class="wmc-svc-grid">' + _svcimgLoadingHTML() + '</div>';

  var rb = document.getElementById('svcimgReloadBtn');
  if (rb) rb.addEventListener('click', _svcimgLoad);
  _svcimgLoad();
}

function _svcimgLoadingHTML() {
  return '<p style="grid-column:1/-1;color:var(--gray-2);font-size:13px;padding:14px 0">読み込み中…</p>';
}

async function _svcimgLoad() {
  var grid = document.getElementById('svcimgGrid');
  if (grid) grid.innerHTML = _svcimgLoadingHTML();
  try {
    var resp = await _svcApi({ method: 'GET' });
    var rows = (resp && resp.data) || [];
    _svcimgRows = {};
    rows.forEach(function (r) { if (r && r.service_slug) _svcimgRows[r.service_slug] = r; });
    _svcimgPaint();
  } catch (e) {
    if (grid) {
      grid.innerHTML = '<p style="grid-column:1/-1;color:var(--danger,#c0392b);font-size:13px;padding:14px 0">' +
        '読み込みに失敗しました: ' + esc(e.message || String(e)) +
        '<br><span style="color:var(--gray-2)">（マイグレーション 001_create_hm_service_images.sql が未適用の可能性があります）</span></p>';
    }
  }
}

function _svcimgPaint() {
  var grid = document.getElementById('svcimgGrid');
  if (!grid) return;
  grid.innerHTML = _WMC_SVC_DEFS.map(function (def, i) {
    return _svcimgCardHtml(def, _svcimgRows[def.slug] || null, i, _WMC_SVC_DEFS.length);
  }).join('');

  grid.querySelectorAll('.svcimg-preview').forEach(function (img) {
    img.addEventListener('error', function () { this.style.visibility = 'hidden'; });
  });
}

function _svcimgCardHtml(def, row, idx, total) {
  var hasImg  = !!(row && row.image_url);
  var active  = !row || row.active !== false;                 // default cards read as "on"
  var preview = row ? (row.thumb_url || row.image_webp || row.image_url) : '';
  var dims    = (row && row.width && row.height) ? (row.width + '×' + row.height) : '';

  var previewBlock = hasImg
    ? '<img src="' + esc(preview) + '" alt="" class="svcimg-preview" loading="lazy" ' +
        'style="width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:10px;border:1px solid var(--line);' +
        (active ? '' : 'opacity:.4;filter:grayscale(.6);') + '">'
    : '<div class="svcimg-placeholder" style="width:100%;aspect-ratio:16/10;border-radius:10px;background:var(--bg-soft-2);' +
        'display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;color:var(--gray-1);border:1px dashed var(--line)">' +
        '<span style="font-size:22px">' + def.icon + '</span>既定のプレースホルダー</div>';

  var idAttr = row ? (' data-id="' + row.id + '"') : '';

  var controls =
    '<div class="svcimg-controls" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">' +
      '<label class="btn btn-primary btn-sm" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0">' +
        '<input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" ' +
          'onchange="_svcimgPick(\'' + esc(def.slug) + '\', this.files[0]); this.value=\'\'">' +
        (hasImg ? '差し替え' : 'アップロード') +
      '</label>' +
      (hasImg
        ? '<button class="btn btn-ghost btn-sm" onclick="_svcimgToggle(' + row.id + ')">' + (active ? '無効化' : '有効化') + '</button>' +
          '<button class="btn btn-ghost btn-sm btn-icon" onclick="_svcimgMove(' + row.id + ',-1)"' + (idx === 0 ? ' disabled' : '') + ' title="上へ">▲</button>' +
          '<button class="btn btn-ghost btn-sm btn-icon" onclick="_svcimgMove(' + row.id + ',1)"' + (idx === total - 1 ? ' disabled' : '') + ' title="下へ">▼</button>' +
          '<button class="btn btn-danger btn-sm" onclick="_svcimgDelete(' + row.id + ')">削除</button>'
        : '') +
    '</div>';

  var altBlock = hasImg
    ? '<input type="text" class="svcimg-alt" placeholder="代替テキスト（alt / SEO）" value="' + esc(row.alt_text || '') + '" ' +
        'onchange="_svcimgSaveAlt(' + row.id + ', this.value)" ' +
        'style="width:100%;margin-top:8px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;font-size:12.5px">'
    : '';

  return '<div class="svcimg-card"' + idAttr + ' data-slug="' + esc(def.slug) + '" ' +
      'style="border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">' +
        '<div style="font-weight:700;font-size:13.5px;color:var(--ink)">' + esc(def.title) + '</div>' +
        (hasImg
          ? '<span class="badge ' + (active ? 'badge-new' : '') + '" style="font-size:10px">' + (active ? '表示中' : '非表示') + (dims ? ' · ' + dims : '') + '</span>'
          : '<span class="td-sm" style="font-size:10px;color:var(--gray-2)">既定</span>') +
      '</div>' +
      previewBlock +
      altBlock +
      controls +
    '</div>';
}

/* ── Actions ──────────────────────────────────────────────────────────────── */

// Upload / replace image for a slug.
async function _svcimgPick(slug, file) {
  if (!file) return;
  if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) { toast('JPG / PNG / WebP のみ対応しています'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('ファイルが大きすぎます（最大 5MB）'); return; }
  var existing = _svcimgRows[slug];
  var fd = new FormData();
  fd.append('image', file);
  fd.append('service_slug', slug);
  if (existing && existing.alt_text) fd.append('alt_text', existing.alt_text);
  toast('画像をアップロード中…');
  try {
    await _svcApi({ method: 'POST', formData: fd });
    toast('アップロードしました。サイトに反映されます');
    if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('update', 'services', slug, 'サービス画像をアップロード');
    await _svcimgLoad();
  } catch (e) { toast('アップロード失敗: ' + (e.message || e)); }
}

// Enable / disable (active toggle).
async function _svcimgToggle(id) {
  var row = _svcimgFindById(id);
  if (!row) return;
  try {
    await _svcApi({ method: 'PUT', json: { id: id, active: row.active === false } });
    toast(row.active === false ? '有効化しました' : '無効化しました');
    await _svcimgLoad();
  } catch (e) { toast('更新失敗: ' + (e.message || e)); }
}

// Delete → card reverts to the built-in placeholder.
async function _svcimgDelete(id) {
  if (!confirm('この画像を削除しますか？\nカードは既定のプレースホルダーに戻ります。')) return;
  try {
    await _svcApi({ method: 'DELETE', json: { id: id } });
    toast('削除しました');
    if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('delete', 'services', String(id), 'サービス画像を削除');
    await _svcimgLoad();
  } catch (e) { toast('削除失敗: ' + (e.message || e)); }
}

// Save alt text (on blur/change).
async function _svcimgSaveAlt(id, value) {
  try {
    await _svcApi({ method: 'PUT', json: { id: id, alt_text: String(value || '').slice(0, 200) } });
    toast('代替テキストを保存しました');
    var row = _svcimgFindById(id); if (row) row.alt_text = value;
  } catch (e) { toast('保存失敗: ' + (e.message || e)); }
}

// Reorder: swap this row with its neighbor among the rows that have images,
// then persist display_order for all of them in one reorder call.
async function _svcimgMove(id, dir) {
  // Ordered list of slugs that currently have a row, in the panel's fixed order.
  var ordered = _WMC_SVC_DEFS
    .map(function (d) { return _svcimgRows[d.slug]; })
    .filter(function (r) { return r && r.id; });
  var idx = ordered.findIndex(function (r) { return r.id === id; });
  var next = idx + dir;
  if (idx < 0 || next < 0 || next >= ordered.length) return;
  var tmp = ordered[idx]; ordered[idx] = ordered[next]; ordered[next] = tmp;
  var items = ordered.map(function (r, i) { return { id: r.id, display_order: i }; });
  try {
    await _svcApi({ method: 'POST', action: 'reorder', json: { items: items } });
    await _svcimgLoad();
  } catch (e) { toast('並び替え失敗: ' + (e.message || e)); }
}

function _svcimgFindById(id) {
  var keys = Object.keys(_svcimgRows);
  for (var i = 0; i < keys.length; i++) {
    var r = _svcimgRows[keys[i]];
    if (r && r.id === id) return r;
  }
  return null;
}
