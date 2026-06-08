'use strict';

/* ════════════════════════════════════════════════════════
   CRM NOTES — Phase 25C
   Staff notes per customer with author attribution.
   Storage: hm_customer_notes { version:1, notes:[{id, customerId, author, text, timestamp}] }
   Audit:   customer_note_created
   Max:     200 notes (ring buffer)

   Migration: reads hm_crm_notes (Phase 25A) and promotes to hm_customer_notes.
   ════════════════════════════════════════════════════════ */

window.CRMNotes = (function () {

  var KEY     = 'hm_customer_notes';
  var OLD_KEY = 'hm_crm_notes';
  var MAX     = 200;

  /* Current staff from session (hm_admin_sess → user / email / name) */
  function _author() {
    try {
      var sess = JSON.parse(sessionStorage.getItem('hm_admin_sess') || 'null');
      return (sess && (sess.user || sess.email || sess.name)) || 'スタッフ';
    } catch (_) { return 'スタッフ'; }
  }

  /* One-time migration from Phase 25A storage key (idempotent) */
  function _migrate() {
    try {
      var raw = localStorage.getItem(OLD_KEY);
      if (!raw) return;
      if (localStorage.getItem(KEY)) { localStorage.removeItem(OLD_KEY); return; }
      var d = JSON.parse(raw);
      if (d && d.version === 1) {
        d.notes = (d.notes || []).map(function (n) {
          return {
            id:         n.id,
            customerId: n.customerId,
            author:     n.author || 'スタッフ',
            text:       n.text  || '',
            timestamp:  n.createdAt || n.timestamp || new Date().toISOString(),
          };
        });
        localStorage.setItem(KEY, JSON.stringify(d));
      }
      localStorage.removeItem(OLD_KEY);
    } catch (_) {}
  }

  function _load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.version === 1) return d;
    } catch (_) {}
    return { version: 1, notes: [] };
  }

  function _save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) {}
  }

  function _uid() {
    return 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  }

  function get(customerId) {
    return _load().notes.filter(function (n) { return n.customerId === customerId; });
  }

  function add(customerId, text) {
    text = (text || '').trim();
    if (!text || !customerId) return null;
    var note = {
      id:         _uid(),
      customerId: customerId,
      author:     _author(),
      text:       text,
      timestamp:  new Date().toISOString(),
    };
    var d = _load();
    d.notes.unshift(note);
    if (d.notes.length > MAX) d.notes.splice(MAX);
    _save(d);
    if (window.AuditLog) {
      AuditLog.record('other', 'crm', customerId,
        'customer_note_created by ' + note.author + ': ' + text.slice(0, 50));
    }
    return note;
  }

  function deleteNote(noteId) {
    var d = _load();
    d.notes = d.notes.filter(function (n) { return n.id !== noteId; });
    _save(d);
  }

  _migrate();

  return { get: get, add: add, 'delete': deleteNote };

})();
