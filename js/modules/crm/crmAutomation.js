'use strict';

/* ════════════════════════════════════════════════════════
   CRM AUTOMATION — Phase 25 Integration
   Automation condition evaluators that target customers by
   CRM status: VIP, Returning (repeat), or tag.

   Evaluators (registered with AutomationEngine):
     crm_vip    — fires once/day if VIP customers exist
     crm_repeat — fires once/day if repeat (returning) customers exist
     crm_tagged — fires once/day if customers with conditions.tag exist

   Actions added:
     crm_log    — logs a CRM event to AuditLog

   Default rule seeded (idempotent):
     "VIP顧客アラート" — crm_vip → crm_log

   Loads AFTER: AutomationEngine, AutomationRules,
                AutomationActions, CustomerProfiles, CRMTags
   ════════════════════════════════════════════════════════ */

(function () {

  function _today() { return new Date().toISOString().slice(0, 10); }

  /* ── Evaluator: crm_vip ── */
  function _evalCrmVip(rule) {
    var key = rule.id + ':crm_vip:' + _today();
    if (window.AutomationAudit && AutomationAudit.lastRunToday(key)) return [];
    var profiles = window.CustomerProfiles ? CustomerProfiles.getAll() : [];
    var vips     = profiles.filter(function (p) { return p.status === 'vip'; });
    if (!vips.length) return [];
    var names = vips.slice(0, 3).map(function (p) { return p.name; }).join('、');
    return [{
      _key:     key,
      message:  'VIP顧客 ' + vips.length + '名 (' + names + (vips.length > 3 ? '…' : '') + ')',
      customers: vips,
    }];
  }

  /* ── Evaluator: crm_repeat ── */
  function _evalCrmRepeat(rule) {
    var key = rule.id + ':crm_repeat:' + _today();
    if (window.AutomationAudit && AutomationAudit.lastRunToday(key)) return [];
    var profiles = window.CustomerProfiles ? CustomerProfiles.getAll() : [];
    var repeats  = profiles.filter(function (p) {
      return p.status === 'returning' || p.status === 'vip';
    });
    if (!repeats.length) return [];
    return [{
      _key:     key,
      message:  '常連顧客 ' + repeats.length + '名',
      customers: repeats,
    }];
  }

  /* ── Evaluator: crm_tagged ── */
  function _evalCrmTagged(rule) {
    var tag = (rule.conditions && rule.conditions.tag) ? String(rule.conditions.tag).trim() : '';
    if (!tag) return [];
    var key = rule.id + ':crm_tagged:' + tag + ':' + _today();
    if (window.AutomationAudit && AutomationAudit.lastRunToday(key)) return [];
    var profiles = window.CustomerProfiles ? CustomerProfiles.getAll() : [];
    var matched  = profiles.filter(function (p) {
      return (p.tags || []).indexOf(tag) !== -1;
    });
    if (!matched.length) return [];
    var names = matched.slice(0, 3).map(function (p) { return p.name; }).join('、');
    return [{
      _key:     key,
      message:  'タグ「' + tag + '」の顧客 ' + matched.length + '名 (' + names + (matched.length > 3 ? '…' : '') + ')',
      customers: matched,
      tag:      tag,
    }];
  }

  /* ── Register evaluators ── */
  if (window.AutomationEngine) {
    AutomationEngine.registerEvaluator('crm_vip',    _evalCrmVip);
    AutomationEngine.registerEvaluator('crm_repeat', _evalCrmRepeat);
    AutomationEngine.registerEvaluator('crm_tagged', _evalCrmTagged);
  }

  /* ── Action: crm_log ── */
  if (window.AutomationActions) {
    AutomationActions.register('crm_log', function (ctx) {
      var msg = ctx.message || 'CRMイベント';
      if (window.AuditLog) AuditLog.record('other', 'crm', 'crm_automation', '[自動] ' + msg);
      if (typeof toast === 'function') toast('[CRM自動] ' + msg);
      return msg;
    });
    AutomationActions.registerLabel('crm_log', 'CRMイベントを記録');
  }

  /* ── Seed default rule (idempotent) ── */
  var CRM_DEFAULTS = [
    {
      id:          'rule_crm_vip_alert',
      name:        'VIP顧客アラート',
      description: 'VIP顧客が存在する場合に毎日記録',
      enabled:     false,
      trigger:     'schedule',
      condType:    'crm_vip',
      conditions:  {},
      actions:     ['crm_log'],
    },
    {
      id:          'rule_crm_tagged_vip',
      name:        'VIPタグ顧客 特別オファー通知',
      description: 'タグ「VIP」の顧客に毎日アラートを記録（特別オファー送信の起点）',
      enabled:     false,
      trigger:     'schedule',
      condType:    'crm_tagged',
      conditions:  { tag: 'VIP' },
      actions:     ['crm_log', 'alert_admin'],
    },
  ];

  if (window.AutomationRules && AutomationRules.seedNew) {
    AutomationRules.seedNew(CRM_DEFAULTS);
  }

})();
