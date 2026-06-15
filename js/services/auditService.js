// js/services/auditService.js → window.AuditService
// Centralized, Supabase-backed audit trail (Phase 5F Audit Migration).
//
// Replaces the localStorage `hm_audit_log` ring buffer as the source of truth.
// Used by BOTH surfaces:
//   • admin panel  — AuditLog (js/modules/audit/auditLog.js) writes + reads here
//   • customer portal — PortalApproval writes here (record only)
//
// Security model (single shared anon key; no Supabase Auth — see
// supabase/migrations/20260101000000_rls_policies.sql):
//   • record()  — INSERT, allowed for everyone (customers + admin).
//   • query()   — READ, gated to an ADMIN session at the application layer.
//                 The portal never loads window.Auth, so a customer context
//                 cannot read the system-wide audit log through this service.
//
// Schema (public.audit_log): id, created_at, actor, action, target_type,
// target_id, details. The service maps rows to/from the legacy UI entry shape
// { id, ts, actor, action, entity, entityId, detail } so the existing 監査ログ
// UI keeps working unchanged.

(function () {
  'use strict';

  var TABLE       = 'audit_log';
  var LEGACY_KEY  = 'hm_audit_log';   // pre-migration localStorage ring buffer
  var MAX_DEFAULT = 500;

  function _sb() { return window.SupabaseClient || null; }

  // READ gate: audit reads require an admin session. window.Auth only exists in
  // the admin bundle, so the customer portal can never satisfy this.
  function _isAdminContext() {
    try {
      return !!(window.Auth && typeof window.Auth.isLoggedIn === 'function' && window.Auth.isLoggedIn());
    } catch (_) { return false; }
  }

  // DB row → legacy UI entry shape (so the existing renderer is untouched).
  function _rowToEntry(r) {
    return {
      id:       r.id,
      ts:       r.created_at ? Date.parse(r.created_at) : Date.now(),
      actor:    r.actor       || 'system',
      action:   r.action      || 'other',
      entity:   r.target_type  || '—',
      entityId: r.target_id    || '',
      detail:   r.details      || '',
    };
  }

  // Caller args (admin or portal) → DB row.
  function _argsToRow(e) {
    e = e || {};
    var targetId = e.targetId != null ? e.targetId : (e.entityId != null ? e.entityId : '');
    return {
      actor:       e.actor       || 'system',
      action:      e.action      || 'other',
      target_type: e.targetType  || e.entity || '—',
      target_id:   String(targetId == null ? '' : targetId),
      details:     e.details != null ? e.details : (e.detail || ''),
    };
  }

  // Backward compatibility: surface any legacy localStorage entries that existed
  // before the migration. Read-only — nothing is written back to localStorage.
  function _legacyEntries() {
    try {
      var d = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
      if (d && Array.isArray(d.entries)) {
        return d.entries.map(function (e) {
          return {
            id:       e.id,
            ts:       e.ts || 0,
            actor:    e.actor    || 'system',
            action:   e.action   || 'other',
            entity:   e.entity   || '—',
            entityId: e.entityId || '',
            detail:   e.detail   || '',
            _legacy:  true,
          };
        });
      }
    } catch (_) {}
    return [];
  }

  // Append an audit entry to Supabase. Returns { ok } / { ok:false, error }.
  // Supabase-only write path — does NOT touch localStorage.
  function record(e) {
    var sb = _sb();
    var row = _argsToRow(e);
    if (!sb) return Promise.resolve({ ok: false, error: 'no-client', row: row });
    return sb.from(TABLE).insert(row).then(function (res) {
      if (res && res.error) {
        console.warn('[AuditService] insert failed:', res.error.message);
        return { ok: false, error: res.error.message };
      }
      return { ok: true, row: row };
    }).catch(function (err) {
      console.warn('[AuditService] insert threw:', err && err.message);
      return { ok: false, error: (err && err.message) || 'insert-failed' };
    });
  }

  // Read the audit trail (admin only). Merges Supabase rows with any legacy
  // localStorage entries, newest first. Non-admin contexts get an empty list.
  function query(opts) {
    opts = opts || {};
    if (!_isAdminContext()) return Promise.resolve([]);
    var sb = _sb();
    var limit = opts.limit || MAX_DEFAULT;
    var legacy = _legacyEntries();

    if (!sb) return Promise.resolve(legacy.sort(_byTsDesc));

    return sb.from(TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
      .then(function (res) {
        var rows = (res && !res.error && Array.isArray(res.data)) ? res.data.map(_rowToEntry) : [];
        return rows.concat(legacy).sort(_byTsDesc).slice(0, limit);
      })
      .catch(function () {
        return legacy.sort(_byTsDesc);
      });
  }

  function _byTsDesc(a, b) { return (b.ts || 0) - (a.ts || 0); }

  window.AuditService = {
    record:  record,
    query:   query,
    TABLE:   TABLE,
    _rowToEntry: _rowToEntry,
    _argsToRow:  _argsToRow,
    _legacyEntries: _legacyEntries,
    _isAdminContext: _isAdminContext,
  };
})();
