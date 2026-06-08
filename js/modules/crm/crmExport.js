'use strict';

/* ════════════════════════════════════════════════════════
   CRM EXPORT — Phase 25 Integration
   CSV exports for CRM customer data.
   Reuses existing download infrastructure pattern.
   Audit: crm_export logged on every download.

   Public API:
     CRMExport.exportCustomers()      — all customers
     CRMExport.exportVIP()            — VIP customers only
     CRMExport.exportRevenueRanking() — ranked by total revenue
   ════════════════════════════════════════════════════════ */

window.CRMExport = (function () {

  function _qe(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  function _row() { return Array.from(arguments).map(_qe).join(','); }

  function _download(lines, filename) {
    var csv = '﻿' + lines.join('\r\n');
    var a   = document.createElement('a');
    a.href  = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = filename;
    a.click();
    if (window.toast) toast(filename + ' をエクスポートしました');
  }

  function _audit(detail) {
    if (window.AuditLog && typeof AuditLog.record === 'function') {
      AuditLog.record('export', 'crm', 'crm_export', detail);
    }
  }

  function _ym() {
    var d = new Date();
    return d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
  }

  function _profiles(filter) {
    var all = window.CustomerProfiles ? CustomerProfiles.getAll() : [];
    return filter ? all.filter(filter) : all;
  }

  function _statusLabel(s) {
    return s === 'vip' ? 'VIP' : s === 'returning' ? '常連' : '新規';
  }

  var HEADER = _row(
    '顧客ID', '名前', 'メール', '電話番号', '住所',
    'ステータス', 'スコア', '予約数', '総売上 (¥)',
    '初回予約日', '最終予約日', 'タグ'
  );

  function _profileRow(p) {
    return _row(
      p.id,
      p.name          || '',
      p.email         || '',
      p.phone         || '',
      p.address       || '',
      _statusLabel(p.status),
      p.score         || '',
      p.totalBookings || 0,
      p.totalRevenue  || 0,
      (p.firstBookingDate || '').slice(0, 10),
      (p.lastBookingDate  || '').slice(0, 10),
      (p.tags || []).join(';')
    );
  }

  /* ══ 1. ALL CUSTOMERS ════════════════════════════════ */
  function exportCustomers() {
    var list = _profiles();
    if (!list.length) { if (window.toast) toast('顧客データがありません'); return; }
    var fname = 'crm-customers-' + _ym() + '.csv';
    _download([HEADER].concat(list.map(_profileRow)), fname);
    _audit('全顧客エクスポート ' + list.length + '名');
  }

  /* ══ 2. VIP CUSTOMERS ════════════════════════════════ */
  function exportVIP() {
    var list = _profiles(function (p) { return p.status === 'vip'; });
    if (!list.length) { if (window.toast) toast('VIP顧客がいません'); return; }
    var fname = 'crm-vip-' + _ym() + '.csv';
    _download([HEADER].concat(list.map(_profileRow)), fname);
    _audit('VIP顧客エクスポート ' + list.length + '名');
  }

  /* ══ 3. REVENUE RANKING ══════════════════════════════ */
  function exportRevenueRanking() {
    var list = _profiles()
      .slice()
      .sort(function (a, b) { return (b.totalRevenue || 0) - (a.totalRevenue || 0); });
    if (!list.length) { if (window.toast) toast('顧客データがありません'); return; }
    var fname = 'crm-revenue-ranking-' + _ym() + '.csv';
    var rankHeader = _row(
      '順位', '顧客ID', '名前', 'メール',
      'ステータス', 'スコア', '予約数', '総売上 (¥)', '最終予約日', 'タグ'
    );
    var lines = [rankHeader].concat(list.map(function (p, i) {
      return _row(
        i + 1,
        p.id,
        p.name          || '',
        p.email         || '',
        _statusLabel(p.status),
        p.score         || '',
        p.totalBookings || 0,
        p.totalRevenue  || 0,
        (p.lastBookingDate || '').slice(0, 10),
        (p.tags || []).join(';')
      );
    }));
    _download(lines, fname);
    _audit('売上ランキングエクスポート ' + list.length + '名');
  }

  return {
    exportCustomers:      exportCustomers,
    exportVIP:            exportVIP,
    exportRevenueRanking: exportRevenueRanking,
  };

})();
