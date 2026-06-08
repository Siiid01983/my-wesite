'use strict';

/* ════════════════════════════════════════════════════════
   CRM TIMELINE — Phase 25B
   Builds a unified, chronological event list for a customer.
   Sources: bookings, quotes, reviews, staff notes.

   Each event: { type, icon, typeLabel, label, detail, date, dateLabel, ref }
     typeLabel — human-readable event category (primary heading)
     label     — service name / content snippet (secondary line)
     detail    — additional context (tertiary line)
   ════════════════════════════════════════════════════════ */

window.CRMTimeline = (function () {

  function _p2(n) { return String(n).padStart(2, '0'); }

  function _fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return (iso || '').slice(0, 10);
    return d.getFullYear() + '-' + _p2(d.getMonth() + 1) + '-' + _p2(d.getDate());
  }

  /* Map booking status → Japanese event label */
  var BOOKING_TYPE = {
    '確定':       '予約確定',
    '完了':       '引越し完了',
    'キャンセル': '予約キャンセル',
    '保留':       '予約保留',
    '待機中':     '予約作成',
  };

  function get(profile) {
    if (!profile) return [];
    var events = [];

    (profile.bookings || []).forEach(function (b) {
      var st = b.status || '';
      events.push({
        type:      'booking',
        icon:      '📦',
        date:      b.move_date || b.date || b.created_at || b.createdAt || '',
        typeLabel: BOOKING_TYPE[st] || '引越し予約',
        label:     b.service || b.service_type || '',
        detail:    st && !BOOKING_TYPE[st] ? st : '',
        ref:       b.reference_id || b.id || '',
      });
    });

    (profile.quotes || []).forEach(function (q) {
      events.push({
        type:      'quote',
        icon:      '💬',
        date:      q.created_at || q.createdAt || '',
        typeLabel: '見積もり作成',
        label:     q.service || q.service_type || '',
        detail:    q.move_date ? ('希望引越し日: ' + q.move_date) : '',
        ref:       q.reference_id || q.id || '',
      });
    });

    (profile.reviews || []).forEach(function (r) {
      var stars = r.rating ? '★'.repeat(Math.max(0, Math.min(5, Math.round(r.rating)))) : '';
      events.push({
        type:      'review',
        icon:      '⭐',
        date:      r.created_at || r.createdAt || '',
        typeLabel: 'レビュー投稿',
        label:     stars,
        detail:    (r.comment || r.body || '').slice(0, 80),
        ref:       r.reference_id || r.id || '',
      });
    });

    (profile.notes || []).forEach(function (n) {
      events.push({
        type:      'note',
        icon:      '📝',
        date:      n.timestamp || n.createdAt || '',
        typeLabel: 'スタッフメモ',
        label:     n.author ? (n.author + ' のメモ') : 'メモ',
        detail:    (n.text || '').slice(0, 80),
        ref:       n.id || '',
      });
    });

    events.sort(function (a, b) {
      return (b.date || '') > (a.date || '') ? 1 : -1;
    });

    events.forEach(function (e) { e.dateLabel = _fmtDate(e.date); });
    return events;
  }

  return { get: get };

})();
