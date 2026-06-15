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

  window.PortalDocs = { list, getDownloadUrl, SECTIONS, BUCKET, ROOT, _inScope };
})();
