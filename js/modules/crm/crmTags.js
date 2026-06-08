'use strict';

/* ════════════════════════════════════════════════════════
   CRM TAGS — Phase 25
   Admin-defined tags per customer (e.g. "VIP", "常連", "法人").
   Storage: hm_crm_tags { version:1, data:{[customerId]:string[]} }
   ════════════════════════════════════════════════════════ */

window.CRMTags = (function () {

  var KEY = 'hm_crm_tags';

  function _load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.version === 1) return d;
    } catch (_) {}
    return { version: 1, data: {} };
  }

  function _save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) {}
  }

  function get(customerId) {
    return (_load().data[customerId] || []).slice();
  }

  function add(customerId, tag) {
    tag = (tag || '').trim();
    if (!tag || !customerId) return;
    var d = _load();
    if (!d.data[customerId]) d.data[customerId] = [];
    if (d.data[customerId].indexOf(tag) === -1) {
      d.data[customerId].push(tag);
      _save(d);
    }
  }

  function remove(customerId, tag) {
    var d = _load();
    if (!d.data[customerId]) return;
    d.data[customerId] = d.data[customerId].filter(function (t) { return t !== tag; });
    _save(d);
  }

  function getAllTags() {
    var seen = {};
    var d = _load();
    Object.keys(d.data).forEach(function (id) {
      (d.data[id] || []).forEach(function (t) { seen[t] = true; });
    });
    return Object.keys(seen).sort();
  }

  return { get: get, add: add, remove: remove, getAllTags: getAllTags };

})();
