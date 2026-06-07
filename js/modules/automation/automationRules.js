'use strict';

/* ════════════════════════════════════════════════════════
   AUTOMATION RULES — Phase 24
   CRUD for business rules stored in localStorage.
   Storage key : hm_automation_rules  { version, rules:[…] }
   ════════════════════════════════════════════════════════ */

window.AutomationRules = (function () {

  var KEY = 'hm_automation_rules';

  /* condType maps to the condition evaluator in AutomationEngine */
  var DEFAULTS = [
    {
      id: 'rule_review_request',
      name: 'レビュー依頼',
      description: '引越し完了7日後にレビュー依頼を送信',
      enabled: true,
      trigger: 'schedule',
      condType: 'completion_followup',
      conditions: { daysAfterCompletion: 7 },
      actions: ['send_review_request'],
      createdAt: new Date().toISOString()
    },
    {
      id: 'rule_move_reminder',
      name: '引越し前リマインダー',
      description: '引越し日3日前にリマインダーを送信',
      enabled: true,
      trigger: 'schedule',
      condType: 'pre_move_reminder',
      conditions: { daysBeforeMove: 1 },
      actions: ['send_move_reminder'],
      createdAt: new Date().toISOString()
    },
    {
      id: 'rule_low_occupancy',
      name: '低稼働率アラート',
      description: '月間稼働率が50%を下回った場合にアラート',
      enabled: true,
      trigger: 'schedule',
      condType: 'low_occupancy',
      conditions: { occupancyBelow: 50 },
      actions: ['alert_admin'],
      createdAt: new Date().toISOString()
    },
    {
      id: 'rule_quote_followup',
      name: '見積もりフォローアップ',
      description: '見積もり作成3日後にフォローアップ',
      enabled: false,
      trigger: 'schedule',
      condType: 'quote_followup',
      conditions: { daysAfterQuote: 3 },
      actions: ['send_quote_followup'],
      createdAt: new Date().toISOString()
    }
  ];

  function _load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.version === 1 && Array.isArray(d.rules)) return d;
    } catch (_) {}
    return null;
  }

  function _save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {}
  }

  function seed() {
    if (!_load()) _save({ version: 1, rules: DEFAULTS });
  }

  function getAll() {
    var d = _load();
    return d ? d.rules : DEFAULTS;
  }

  function get(id) {
    return getAll().find(function (r) { return r.id === id; }) || null;
  }

  function add(rule) {
    var store = _load() || { version: 1, rules: [] };
    var newRule = Object.assign({}, rule, {
      id: 'rule_' + Date.now(),
      createdAt: new Date().toISOString()
    });
    store.rules.push(newRule);
    _save(store);
    return newRule;
  }

  function update(id, patch) {
    var store = _load() || { version: 1, rules: [] };
    var idx = store.rules.findIndex(function (r) { return r.id === id; });
    if (idx === -1) return false;
    store.rules[idx] = Object.assign({}, store.rules[idx], patch);
    _save(store);
    return true;
  }

  function remove(id) {
    var store = _load() || { version: 1, rules: [] };
    store.rules = store.rules.filter(function (r) { return r.id !== id; });
    _save(store);
  }

  function toggle(id) {
    var rule = get(id);
    if (!rule) return false;
    return update(id, { enabled: !rule.enabled });
  }

  return { seed: seed, getAll: getAll, get: get, add: add, update: update, remove: remove, toggle: toggle };

})();
