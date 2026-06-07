'use strict';

/* ════════════════════════════════════════════════════════
   AUTOMATION ENGINE — Phase 24
   Evaluates all active schedule-based rules against current
   data and executes their actions exactly once per day per
   entity (deduplication via AutomationAudit.lastRunToday).

   Depends on: AutomationRules, AutomationAudit, AutomationActions,
               AutomationTriggers, AutomationScheduler, Adapter
   ════════════════════════════════════════════════════════ */

window.AutomationEngine = (function () {

  var _initialized = false;

  /* ── Date helpers ── */

  function _today() { return new Date().toISOString().slice(0, 10); }

  function _daysDiff(isoA, isoB) {
    return Math.round((new Date(isoB) - new Date(isoA)) / 86400000);
  }

  function _currentMonthOccupancy() {
    if (!window.Adapter) return 0;
    var avail = Adapter.getAvail();
    var now   = new Date();
    var prefix = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var booked = Object.keys(avail).filter(function (d) {
      return d.startsWith(prefix) && avail[d] === 'booked';
    }).length;
    return daysInMonth > 0 ? (booked / daysInMonth) * 100 : 0;
  }

  /* ── Condition evaluators ── */

  function _evalCompletionFollowup(rule) {
    var bookings = window.Adapter ? Adapter.getBookings() : [];
    var days     = rule.conditions.daysAfterCompletion || 7;
    var today    = _today();
    var results  = [];
    bookings.forEach(function (b) {
      if (b.status !== '完了') return;
      var ref = b.move_date || '';
      if (!ref || _daysDiff(ref, today) !== days) return;
      var key = rule.id + ':' + (b.reference_id || b.id || '');
      if (AutomationAudit.lastRunToday(key)) return;
      results.push({ booking: b, _key: key });
    });
    return results;
  }

  function _evalPreMoveReminder(rule) {
    var bookings = window.Adapter ? Adapter.getBookings() : [];
    var days     = rule.conditions.daysBeforeMove || 3;
    var today    = _today();
    var results  = [];
    bookings.forEach(function (b) {
      if (b.status !== '確定') return;
      var ref = b.move_date || '';
      if (!ref || _daysDiff(today, ref) !== days) return;
      var key = rule.id + ':' + (b.reference_id || b.id || '');
      if (AutomationAudit.lastRunToday(key)) return;
      results.push({ booking: b, _key: key });
    });
    return results;
  }

  function _evalQuoteFollowup(rule) {
    var quotes  = (window.Adapter && Adapter.getQuotes) ? (Adapter.getQuotes() || []) : [];
    var days    = rule.conditions.daysAfterQuote || 3;
    var today   = _today();
    var results = [];
    quotes.forEach(function (q) {
      /* Skip already-converted quotes */
      var st = q.status || '';
      if (st && st !== 'pending' && st !== '保留') return;
      var created = (q.created_at || q.createdAt || '').slice(0, 10);
      if (!created || _daysDiff(created, today) !== days) return;
      var key = rule.id + ':' + (q.reference_id || q.id || '');
      if (AutomationAudit.lastRunToday(key)) return;
      results.push({ quote: q, _key: key });
    });
    return results;
  }

  function _evalOccupancy(rule) {
    var key  = rule.id + ':occupancy';
    if (AutomationAudit.lastRunToday(key)) return [];
    var rate = _currentMonthOccupancy();

    var triggered = false;
    var detail    = '';
    if (rule.condType === 'low_occupancy') {
      var threshold = rule.conditions.occupancyBelow;
      triggered = rate < threshold;
      detail = '月間稼働率が' + rate.toFixed(1) + '%（閾値: ' + threshold + '%以下）';
    } else if (rule.condType === 'high_occupancy') {
      var threshold = rule.conditions.occupancyAbove;
      triggered = rate > threshold;
      detail = '月間稼働率が' + rate.toFixed(1) + '%（閾値: ' + threshold + '%以上）';
    }
    if (!triggered) return [];
    return [{ message: detail, rate: rate, _key: key }];
  }

  /* ── Public: evaluate one rule → array of trigger contexts ── */

  function evaluate(rule) {
    if (!rule.enabled) return [];
    if (rule.condType === 'completion_followup') return _evalCompletionFollowup(rule);
    if (rule.condType === 'pre_move_reminder')   return _evalPreMoveReminder(rule);
    if (rule.condType === 'quote_followup')       return _evalQuoteFollowup(rule);
    if (rule.condType === 'low_occupancy' || rule.condType === 'high_occupancy') return _evalOccupancy(rule);
    return [];
  }

  /* ── Public: run all active schedule rules ── */

  async function run() {
    var rules = AutomationRules.getAll().filter(function (r) {
      return r.enabled && r.trigger === 'schedule';
    });
    var total = 0;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      var contexts;
      try { contexts = evaluate(rule); } catch (_) { continue; }
      for (var j = 0; j < contexts.length; j++) {
        var ctx     = contexts[j];
        var actions = rule.actions || [];
        for (var k = 0; k < actions.length; k++) {
          var result = await AutomationActions.execute(actions[k], ctx);
          AutomationAudit.log(ctx._key, rule.name, actions[k],
            result.ok ? 'success' : 'error', result.detail);
          total++;
        }
      }
    }
    if (total > 0 && window.EventBus) EventBus.emit('automation:ran', { count: total });
    return total;
  }

  /* ── Public: init (called once on login) ── */

  async function init() {
    if (_initialized) return;
    _initialized = true;
    AutomationRules.seed();
    AutomationTriggers.init();
    AutomationScheduler.onTick(run);
    AutomationScheduler.start();
    setTimeout(run, 3000); // initial evaluation 3 s after login
  }

  return { init: init, run: run, evaluate: evaluate };

})();
