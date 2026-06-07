'use strict';

/* ════════════════════════════════════════════════════════
   AUTOMATION ACTIONS — Phase 24
   Registry of executable action handlers.
   Each action receives a context object and returns a
   description string (or throws on failure).
   ════════════════════════════════════════════════════════ */

window.AutomationActions = (function () {

  var _registry = {};

  var LABELS = {
    send_review_request: 'レビュー依頼を送信',
    send_move_reminder:  '引越しリマインダーを送信',
    send_quote_followup: '見積もりフォローアップを送信',
    alert_admin:         '管理者にアラート',
    log_event:           'イベントを記録'
  };

  function register(id, fn) { _registry[id] = fn; }

  async function execute(actionId, context) {
    var fn = _registry[actionId];
    if (!fn) return { ok: false, detail: 'アクション未登録: ' + actionId };
    try {
      var detail = await fn(context || {});
      return { ok: true, detail: detail || actionId };
    } catch (err) {
      return { ok: false, detail: (err && err.message) || String(err) };
    }
  }

  function list() {
    return Object.keys(LABELS).map(function (id) { return { id: id, label: LABELS[id] }; });
  }

  function label(id) { return LABELS[id] || id; }

  /* ── Built-in actions ── */

  register('send_review_request', function (ctx) {
    var name = (ctx.booking && ctx.booking.customer_name) || 'お客様';
    var msg = '[自動] ' + name + ' 様にレビュー依頼を送信しました';
    if (typeof toast === 'function') toast(msg);
    if (window.AuditLog) AuditLog.record('other', 'automation', 'review_request', msg);
    return msg;
  });

  register('send_move_reminder', function (ctx) {
    var name = (ctx.booking && ctx.booking.customer_name) || 'お客様';
    var date = (ctx.booking && ctx.booking.move_date) || '';
    var msg = '[自動] ' + name + ' 様の引越しリマインダーを送信しました' + (date ? '（' + date + '）' : '');
    if (typeof toast === 'function') toast(msg);
    if (window.AuditLog) AuditLog.record('other', 'automation', 'move_reminder', msg);
    return msg;
  });

  register('send_quote_followup', function (ctx) {
    var name = (ctx.quote && ctx.quote.customer_name) || 'お客様';
    var msg = '[自動] ' + name + ' 様の見積もりフォローアップを送信しました';
    if (typeof toast === 'function') toast(msg);
    if (window.AuditLog) AuditLog.record('other', 'automation', 'quote_followup', msg);
    return msg;
  });

  register('alert_admin', function (ctx) {
    var msg = ctx.message || 'システムアラート';
    if (typeof toast === 'function') toast('⚠️ ' + msg);
    if (window.AuditLog) AuditLog.record('other', 'automation', 'alert', msg);
    return msg;
  });

  register('log_event', function (ctx) {
    var msg = ctx.message || 'イベントを記録しました';
    if (window.AuditLog) AuditLog.record('other', 'automation', 'log_event', msg);
    return msg;
  });

  return { register: register, execute: execute, list: list, label: label };

})();
