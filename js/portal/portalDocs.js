// js/portal/portalDocs.js → window.PortalDocs
// Customer Documents Center — READ-ONLY access to a customer's own files in
// Supabase Storage (Phase 5D).
//
// Storage layout (reuses the existing `media` bucket — no new bucket, no DB
// change). Files live under a booking-scoped prefix:
//
//   media/customer-documents/<bookingId>/estimates/<file>      ← Estimate PDF
//   media/customer-documents/<bookingId>/contracts/<file>      ← Contracts
//   media/customer-documents/<bookingId>/attachments/<file>    ← Attachments
//
// Security: every list/download is confined to the authenticated booking's
// prefix. The module NEVER lists the bucket root and getDownloadUrl() refuses
// any path outside the booking's own folders — so a customer can never reach
// another customer's documents (unauthorized access blocked).

(function () {
  'use strict';

  const BUCKET = 'media';                 // reuse existing bucket (preserve structure)
  const ROOT   = 'customer-documents';    // namespaced sub-tree for portal docs

  const SECTIONS = [
    { id: 'estimates',   label: '見積書',   accept: /\.pdf$/i },
    { id: 'contracts',   label: '契約書',   accept: /\.(pdf|docx?)$/i },
    { id: 'attachments', label: '添付ファイル', accept: /.*/ },
  ];

  function _ids(bookingIds) {
    const arr = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
    return [...new Set(arr.filter(v => v != null && v !== '').map(String))];
  }

  // Allowed path prefixes for this customer's booking(s).
  function _prefixes(ids) {
    return _ids(ids).map(id => `${ROOT}/${id}/`);
  }

  // A path is in-scope only if it sits under one of the booking's prefixes.
  function _inScope(path, ids) {
    if (!path) return false;
    return _prefixes(ids).some(p => path.startsWith(p));
  }

  function _file(entry, folder, sectionId) {
    return {
      name:       entry.name,
      path:       `${folder}/${entry.name}`,
      section:    sectionId,
      size:       entry.metadata && entry.metadata.size != null ? entry.metadata.size : null,
      uploadedAt: entry.created_at || entry.updated_at ||
                  (entry.metadata && entry.metadata.lastModified) || null,
    };
  }

  // List one section's files for the booking, scoped to its folder only.
  async function _listSection(sb, ids, sectionId) {
    const seen = {};
    const files = [];
    for (const id of _ids(ids)) {
      const folder = `${ROOT}/${id}/${sectionId}`;
      let data, error;
      try {
        ({ data, error } = await sb.storage.from(BUCKET).list(folder, {
          limit: 200,
          sortBy: { column: 'created_at', order: 'desc' },
        }));
      } catch (_) { continue; }
      if (error || !data) continue;
      for (const entry of data) {
        // Skip the Supabase placeholder row and any nested folders (no metadata).
        if (!entry.name || entry.name === '.emptyFolderPlaceholder') continue;
        if (entry.id === null && entry.metadata == null) continue;
        const f = _file(entry, folder, sectionId);
        if (seen[f.path]) continue;
        seen[f.path] = 1;
        files.push(f);
      }
    }
    return files;
  }

  // List all documents for the authenticated booking, grouped by section,
  // plus a flat `all` list for the Download Center.
  async function list(bookingIds) {
    const sb  = window.SupabaseClient;
    const ids = _ids(bookingIds);
    const empty = { sections: {}, all: [] };
    SECTIONS.forEach(s => { empty.sections[s.id] = []; });
    if (!sb || !sb.storage || !ids.length) return empty;

    const result = { sections: {}, all: [] };
    for (const s of SECTIONS) {
      const files = await _listSection(sb, ids, s.id);
      result.sections[s.id] = files;
      result.all.push(...files);
    }
    result.all.sort((a, b) => (b.uploadedAt || '') > (a.uploadedAt || '') ? 1 : -1);
    return result;
  }

  // ── Customer document upload (Phase 6C) ────────────────────────────────────
  // Customers may add their OWN files, confined to the booking's `attachments`
  // sub-tree only (they never write into estimates/contracts — those are
  // admin-issued). Reuses the same `media` bucket + booking-scoped path; no DB
  // change. Upload/delete are app-confined here; storage stays private + signed.
  const ATTACH_SECTION   = 'attachments';
  const ATTACH_MAX_BYTES = 15 * 1024 * 1024;   // 15 MB per file

  // Build a collision-safe storage filename, preserving the extension.
  function _safeName(name) {
    const dot = (name || '').lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin';
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  }

  // A path is uploadable/removable only inside the booking's attachments folder.
  function _inAttachScope(path, ids) {
    if (!path || String(path).includes('..')) return false;
    return _ids(ids).some(id => String(path).startsWith(`${ROOT}/${id}/${ATTACH_SECTION}/`));
  }

  // Upload one document to the customer's OWN booking attachments folder.
  // `bookingId` is the single authoritative session booking id — the path is
  // built from it here, so an upload can never target another booking.
  async function uploadAttachment(bookingId, file) {
    const sb = window.SupabaseClient;
    const id = bookingId != null ? String(bookingId) : '';
    if (!sb || !sb.storage) return { ok: false, error: 'storage-unavailable' };
    if (!id)                return { ok: false, error: 'no-booking' };
    if (!file)              return { ok: false, error: 'no-file' };
    if (file.size > ATTACH_MAX_BYTES) return { ok: false, error: 'too-large' };

    const path = `${ROOT}/${id}/${ATTACH_SECTION}/${_safeName(file.name)}`;
    try {
      const { error } = await sb.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true, path };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'upload-failed' };
    }
  }

  // Delete one of the customer's OWN uploaded attachments. Guarded: refuses any
  // path outside the booking's attachments sub-tree.
  async function removeAttachment(bookingIds, path) {
    const sb = window.SupabaseClient;
    if (!sb || !sb.storage) return { ok: false, error: 'storage-unavailable' };
    if (!_inAttachScope(path, bookingIds)) {
      console.warn('[PortalDocs] blocked out-of-scope attachment delete:', path);
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

  // Resolve a time-limited download URL for one file — but ONLY if the path is
  // inside the authenticated booking's folders. Returns null when out of scope
  // (blocks unauthorized access) or on error.
  async function getDownloadUrl(bookingIds, path) {
    const sb  = window.SupabaseClient;
    const ids = _ids(bookingIds);
    if (!sb || !sb.storage) return null;
    if (!_inScope(path, ids)) {
      console.warn('[PortalDocs] blocked out-of-scope download:', path);
      return null;
    }
    try {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 300);
      if (!error && data && data.signedUrl) return data.signedUrl;
    } catch (_) { /* fall through to public url */ }
    try {
      const pub = sb.storage.from(BUCKET).getPublicUrl(path);
      return (pub.data && pub.data.publicUrl) || null;
    } catch (_) { return null; }
  }

  window.PortalDocs = {
    list, getDownloadUrl, uploadAttachment, removeAttachment,
    SECTIONS, BUCKET, ROOT, ATTACH_SECTION, ATTACH_MAX_BYTES,
    _inScope, _inAttachScope,
  };
})();
