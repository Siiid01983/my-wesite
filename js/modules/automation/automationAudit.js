'use strict';

/* ════════════════════════════════════════════════════════
   AUTOMATION AUDIT — Phase 24
   Ring-buffer execution log for automation actions.
   Storage key : hm_automation_audit  (max 200 entries)
   ════════════════════════════════════════════════════════ */

window.AutomationAudit = (function () {

  var KEY = 'hm_automation_audit';
  var MAX = 200;

  function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || []; }
    catch (_) { return []; }
  }

  function _save(entries) {
    try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch (_) {}
  }

  /* dedupeKey : rule.id + ':' + entity-id (booking ref, quote id, or 'occupancy')
     result    : 'success' | 'error'                                               */
  function log(dedupeKey, ruleName, action, result, detail) {
    var entries = _load();
    entries.unshift({
      id: (window.genId ? genId() : Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
      ts: Date.now(),
      dedupeKey: dedupeKey,
      ruleName:  ruleName,
      action:    action,
      result:    result,
      detail:    detail || ''
    });
    if (entries.length > MAX) entries.splice(MAX);
    _save(entries);
  }

  function getAll() { return _load(); }

  /* Returns true if dedupeKey already has a successful entry today. */
  function lastRunToday(dedupeKey) {
    var today = new Date().toISOString().slice(0, 10);
    return _load().some(function (e) {
      return e.dedupeKey === dedupeKey &&
             e.result === 'success' &&
             new Date(e.ts).toISOString().slice(0, 10) === today;
    });
  }

  function clear() { _save([]); }

  return { log: log, getAll: getAll, lastRunToday: lastRunToday, clear: clear };

})();
