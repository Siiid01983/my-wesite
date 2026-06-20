// js/portal/portalPhotos.js → window.PortalPhotos
// Customer moving-photo uploads (Phase 5E).
//
// Customers upload photos of their move, organised by category, into their OWN
// booking's folder in API Storage. Everything is booking-scoped and every
// preview uses a short-lived SIGNED URL — this module never produces a public
// URL (rule: no public storage access).
//
// Storage layout (reuses the existing `media` bucket — no new bucket, no DB change):
//
//   media/customer-documents/<bookingId>/photos/room/<file>        ← Room Photos
//   media/customer-documents/<bookingId>/photos/furniture/<file>   ← Furniture Photos
//   media/customer-documents/<bookingId>/photos/special/<file>     ← Special Items

(function () {
  'use strict';

  const BUCKET = 'media';
  const ROOT   = 'customer-documents';
  const SUB    = 'photos';
  const SIGNED_TTL = 300;                 // seconds
  const MAX_BYTES  = 10 * 1024 * 1024;    // 10 MB per photo

  const CATEGORIES = [
    { id: 'room',      label: '部屋の写真（Room Photos）' },
    { id: 'furniture', label: '家具の写真（Furniture Photos）' },
    { id: 'special',   label: '特別な品物（Special Items）' },
  ];
  const _CAT_IDS = CATEGORIES.map(c => c.id);

  function _ids(bookingIds) {
    const arr = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
    return [...new Set(arr.filter(v => v != null && v !== '').map(String))];
  }
  function _folder(id, category) { return `${ROOT}/${id}/${SUB}/${category}`; }

  // In-scope = under one of the booking's own photo sub-trees.
  function _inScope(path, ids) {
    if (!path || path.includes('..')) return false;
    return _ids(ids).some(id => path.startsWith(`${ROOT}/${id}/${SUB}/`));
  }

  // Strip anything risky from a user filename; keep extension.
  function _safeName(name) {
    const dot = (name || '').lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'jpg';
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  }

  // Upload one photo to the customer's own booking folder. `bookingId` is the
  // single authoritative id (the session booking) — uploads can never target
  // another booking because the path is built from it here.
  async function upload(bookingId, category, file) {
    const sb = window.api;
    const id = bookingId != null ? String(bookingId) : '';
    if (!sb || !sb.storage)        return { ok: false, error: 'storage-unavailable' };
    if (!id)                       return { ok: false, error: 'no-booking' };
    if (!_CAT_IDS.includes(category)) return { ok: false, error: 'bad-category' };
    if (!file)                     return { ok: false, error: 'no-file' };
    if (!/^image\//.test(file.type || '')) return { ok: false, error: 'not-an-image' };
    if (file.size > MAX_BYTES)     return { ok: false, error: 'too-large' };

    const path = `${_folder(id, category)}/${_safeName(file.name)}`;
    try {
      const { error } = await sb.storage.from(BUCKET).upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true, path };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'upload-failed' };
    }
  }

  // Resolve a short-lived signed URL for one in-scope photo. Never public.
  async function signedUrl(bookingIds, path) {
    const sb = window.api;
    if (!sb || !sb.storage || !_inScope(path, bookingIds)) return null;
    try {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
      if (error || !data) return null;
      return data.signedUrl || null;
    } catch (_) { return null; }
  }

  // List one category's photos (booking-scoped), each with a signed preview URL.
  async function _listCategory(sb, ids, category) {
    const out = [];
    const seen = {};
    for (const id of _ids(ids)) {
      const folder = _folder(id, category);
      let data, error;
      try {
        ({ data, error } = await sb.storage.from(BUCKET).list(folder, {
          limit: 200,
          sortBy: { column: 'created_at', order: 'desc' },
        }));
      } catch (_) { continue; }
      if (error || !data) continue;
      for (const entry of data) {
        if (!entry.name || entry.name === '.emptyFolderPlaceholder') continue;
        if (entry.id === null && entry.metadata == null) continue;
        const path = `${folder}/${entry.name}`;
        if (seen[path]) continue;
        seen[path] = 1;
        out.push({
          name:       entry.name,
          path,
          category,
          size:       entry.metadata && entry.metadata.size != null ? entry.metadata.size : null,
          uploadedAt: entry.created_at || entry.updated_at ||
                      (entry.metadata && entry.metadata.lastModified) || null,
          url:        await signedUrl(ids, path),
        });
      }
    }
    return out;
  }

  // List every category for the authenticated booking.
  async function list(bookingIds) {
    const sb  = window.api;
    const ids = _ids(bookingIds);
    const result = {};
    CATEGORIES.forEach(c => { result[c.id] = []; });
    if (!sb || !sb.storage || !ids.length) return result;
    for (const c of CATEGORIES) {
      result[c.id] = await _listCategory(sb, ids, c.id);
    }
    return result;
  }

  // Delete one of the customer's OWN photos. Guarded: refuses any path outside
  // the booking's own photo folders.
  async function remove(bookingIds, path) {
    const sb = window.api;
    if (!sb || !sb.storage) return { ok: false, error: 'storage-unavailable' };
    if (!_inScope(path, bookingIds)) {
      console.warn('[PortalPhotos] blocked out-of-scope delete:', path);
      return { ok: false, error: 'out-of-scope' };
    }
    try {
      const { error } = await sb.storage.from(BUCKET).remove([path]);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'delete-failed' };
    }
  }

  window.PortalPhotos = {
    upload, list, remove, signedUrl,
    CATEGORIES, BUCKET, ROOT, SUB, MAX_BYTES, _inScope,
  };
})();
