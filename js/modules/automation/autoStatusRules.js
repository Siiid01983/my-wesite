'use strict';

/* ════════════════════════════════════════════════════════
   AUTO STATUS RULES — Phase 24E
   Automatic booking status transitions evaluated by the
   AutomationEngine scheduler.

   Rule 1 — auto_complete_booking
     Condition : move_date has passed AND status === '確定'
     Action    : change_status → '完了'
     Dedup     : AutomationAudit.lastRunToday per booking ID
     Audit     : status_auto_updated

   Rule 2 — auto_release_calendar
     Condition : status === 'キャンセル' AND calendar date still 'booked'
     Action    : release_calendar_slot → Adapter.setDate(date, 'available')
     Dedup     : AutomationAudit.lastRunToday per booking ID
     Audit     : calendar_slot_released

   Registers evaluators into AutomationEngine via registerEvaluator().
   Seeds default rules via AutomationRules.seedNew() (idempotent).
   ════════════════════════════════════════════════════════ */

(function () {

  /* ── Evaluator: auto_complete_booking ── */

  function _evalAutoComplete(rule) {
    if (!window.Adapter) return [];
    var bookings = Adapter.getBookings ? Adapter.getBookings() : [];
    var today    = new Date().toISOString().slice(0, 10);
    var results  = [];
    bookings.forEach(function (b) {
      if ((b.status || '') !== '確定') return;
      var moveDate = b.move_date || b.date || '';
      if (!moveDate || moveDate >= today) return; /* move_date not yet passed */
      var id  = b.reference_id || b.id || '';
      var key = rule.id + ':' + id;
      if (window.AutomationAudit && AutomationAudit.lastRunToday(key)) return;
      results.push({ booking: b, _key: key, newStatus: '完了' });
    });
    return results;
  }

  /* ── Evaluator: auto_release_calendar ── */

  function _evalAutoRelease(rule) {
    if (!window.Adapter) return [];
    var bookings = Adapter.getBookings ? Adapter.getBookings() : [];
    var avail    = Adapter.getAvail    ? (Adapter.getAvail() || {}) : {};
    var results  = [];
    bookings.forEach(function (b) {
      if ((b.status || '') !== 'キャンセル') return;
      var date = b.move_date || b.date || '';
      if (!date || avail[date] !== 'booked') return; /* already released or no slot */
      var id  = b.reference_id || b.id || '';
      var key = rule.id + ':' + id;
      if (window.AutomationAudit && AutomationAudit.lastRunToday(key)) return;
      results.push({ booking: b, _key: key, calendarDate: date });
    });
    return results;
  }

  /* ── Actions ── */

  if (window.AutomationActions) {

    AutomationActions.register('change_status', async function (ctx) {
      var b         = ctx.booking;
      var newStatus = ctx.newStatus || '完了';
      var id        = b.reference_id || b.id || '';
      if (!id) throw new Error('予約IDが見つかりません');

      if (window.Adapter && Adapter.updateBooking) {
        try { await Adapter.updateBooking(id, { status: newStatus }); }
        catch (err) { throw new Error('ステータス更新失敗: ' + ((err && err.message) || err)); }
      }

      var name = b.customer_name || id;
      var msg  = name + ': ステータスを「' + newStatus + '」に自動更新';
      if (window.AuditLog) AuditLog.record('update', 'bookings', id, msg + ' (status_auto_updated)');
      if (typeof toast === 'function') toast('[自動] ' + msg);
      return msg;
    });

    AutomationActions.register('release_calendar_slot', async function (ctx) {
      var b    = ctx.booking;
      var date = ctx.calendarDate || b.move_date || b.date || '';
      if (!date) throw new Error('引越し日が不明です');

      if (window.Adapter && Adapter.setDate) {
        try { await Adapter.setDate(date, 'available'); }
        catch (err) { throw new Error('カレンダー解放失敗: ' + ((err && err.message) || err)); }
      }

      var name = b.customer_name || (b.reference_id || b.id || '');
      var msg  = name + ': ' + date + ' カレンダー枠を解放';
      if (window.AuditLog) AuditLog.record('update', 'calendar', date, msg + ' (calendar_slot_released)');
      if (typeof toast === 'function') toast('[自動] ' + msg);
      return msg;
    });
  }

  /* ── Register evaluators ── */

  if (window.AutomationEngine) {
    AutomationEngine.registerEvaluator('auto_complete_booking', _evalAutoComplete);
    AutomationEngine.registerEvaluator('auto_release_calendar', _evalAutoRelease);
  }

  /* ── Seed default rules (idempotent — checks by ID) ── */

  var AUTO_STATUS_DEFAULTS = [
    {
      id:          'rule_auto_complete',
      name:        '引越し完了 自動ステータス更新',
      description: '引越し日を過ぎた確定済み予約を自動的に「完了」に変更',
      enabled:     true,
      trigger:     'schedule',
      condType:    'auto_complete_booking',
      conditions:  {},
      actions:     ['change_status'],
    },
    {
      id:          'rule_auto_release',
      name:        'キャンセル カレンダー枠自動解放',
      description: 'キャンセルされた予約のカレンダー枠を自動的に解放',
      enabled:     true,
      trigger:     'schedule',
      condType:    'auto_release_calendar',
      conditions:  {},
      actions:     ['release_calendar_slot'],
    },
  ];

  if (window.AutomationRules && AutomationRules.seedNew) {
    AutomationRules.seedNew(AUTO_STATUS_DEFAULTS);
  }

})();
