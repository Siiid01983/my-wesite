'use strict';

/* ════════════════════════════════════════════════════════
   CRM TAGS — Phase 25D
   Admin-defined tags per customer with preset library.
   Storage: hm_customer_tags { version:1, data:{[customerId]:string[]} }

   Preset tags: VIP / 法人 / 学生 / リピーター / 高額顧客 /
                英語対応 / 紹介 / 遠距離

   Migration: reads hm_crm_tags (Phase 25A key) on first load.
   ════════════════════════════════════════════════════════ */

window.CRMTags = (function () {

  var KEY     = 'hm_customer_tags';
  var OLD_KEY = 'hm_crm_tags';

  var PRESETS = [
    'VIP', '法人', '学生', 'リピーター',
    '高額顧客', '英語対応', '紹介', '遠距離',
  ];

  /* One-time migration from Phase 25A key (idempotent) */
  function _migrate() {
    try {
      var raw = localStorage.getItem(OLD_KEY);
      if (!raw) return;
      if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, raw);
      localStorage.removeItem(OLD_KEY);
    } catch (_) {}
  }

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

  /* All unique tags in use across all customers, sorted */
  function getAllTags() {
    var seen = {};
    var d = _load();
    Object.keys(d.data).forEach(function (id) {
      (d.data[id] || []).forEach(function (t) { seen[t] = true; });
    });
    return Object.keys(seen).sort();
  }

  function getPresets() { return PRESETS.slice(); }

  _migrate();

  return { get: get, add: add, remove: remove, getAllTags: getAllTags, getPresets: getPresets };

})();
