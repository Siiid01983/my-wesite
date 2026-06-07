'use strict';
/* ════════════════════════════════════════════════════════
   ANALYTICS EXPORT — Phase 23E
   CSV exports for three analytics datasets.
   Follows the existing export pattern (Blob + <a> click).
   All exports are logged to AuditLog.

   Public API:
     AnalyticsExport.revenueForecast()  — monthly actuals + forecast
     AnalyticsExport.serviceRankings()  — 5-service ranked table
     AnalyticsExport.customerMetrics()  — customer summary + top CLV list
   ════════════════════════════════════════════════════════ */
(function () {

  /* ── CSV helpers ── */
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

  function _audit(action, detail) {
    if (window.AuditLog && typeof AuditLog.record === 'function') {
      AuditLog.record(action, 'analytics', action, detail);
    }
  }

  function _bk()  { return window.Adapter ? Adapter.getBookings() : []; }
  function _qt()  { return window.Adapter ? Adapter.getQuotes()   : []; }

  /* ══ 1. REVENUE FORECAST CSV ══════════════════════════ */
  function revenueForecast() {
    if (!window.RevenueForecast) { if (window.toast) toast('モジュール未ロード'); return; }
    var bk = _bk();
    var f  = RevenueForecast.compute(bk);
    if (!f) { if (window.toast) toast('データが不足しています'); return; }

    var now = new Date().toLocaleString('ja-JP');
    var lines = [
      _row('【売上予測レポート】'),
      _row('出力日時', now),
      _row('データソース', 'Hello Moving Admin'),
      '',
      _row('月', 'タイプ', '売上 (¥)', '備考'),
    ];

    /* Actuals */
    (f.months || []).forEach(function (m) {
      lines.push(_row(m.ym, '実績', m.revenue, ''));
    });

    /* Three-horizon forecasts */
    if (f.f7)   lines.push(_row('今後7日間', '予測', f.f7.projected,   '成長率 ' + f.f7.growth + '%'));
    if (f.f30)  lines.push(_row('今後30日間', '予測', f.f30.projected,  '成長率 ' + f.f30.growth + '%'));
    if (f.fMon) lines.push(_row(f.fMon.ym || '来月', '予測', f.fMon.projected, '成長率 ' + f.fMon.growth + '%'));

    lines.push('', _row('予測信頼度 (R²)', f.confidence + '%'));

    _download(lines, '売上予測_' + _today() + '.csv');
    _audit('analytics_export', '売上予測 CSV エクスポート');
  }

  /* ══ 2. SERVICE RANKINGS CSV ═══════════════════════════ */
  function serviceRankings() {
    if (!window.ServicePerformance) { if (window.toast) toast('モジュール未ロード'); return; }
    var bk       = _bk();
    var services = ServicePerformance.compute(bk);
    if (!services.length) { if (window.toast) toast('データが不足しています'); return; }

    var AE  = window.AnalyticsEngine;
    var fmt = function (n) { return AE ? AE.fmtYen(n) : '¥' + Math.round(n || 0).toLocaleString(); };
    var now = new Date().toLocaleString('ja-JP');
    var lines = [
      _row('【人気サービスランキング】'),
      _row('出力日時', now),
      '',
      _row('順位', 'サービス', '予約数', '売上 (¥)', '完了率 (%)', '平均単価 (¥)', '成長率 (%)', 'スコア'),
    ];

    services.forEach(function (s, i) {
      lines.push(_row(i + 1, s.label, s.active, s.revenue, s.completionRate, s.avgOrderValue, s.growth, s.score));
    });

    _download(lines, 'サービスランキング_' + _today() + '.csv');
    _audit('analytics_export', 'サービスランキング CSV エクスポート');
  }

  /* ══ 3. CUSTOMER METRICS CSV ═══════════════════════════ */
  function customerMetrics() {
    if (!window.CustomerInsights) { if (window.toast) toast('モジュール未ロード'); return; }
    var bk  = _bk();
    var ins = CustomerInsights.compute(bk);
    if (!ins) { if (window.toast) toast('データが不足しています'); return; }

    var AE  = window.AnalyticsEngine;
    var fmt = function (n) { return AE ? AE.fmtYen(n) : '¥' + Math.round(n || 0).toLocaleString(); };
    var now = new Date().toLocaleString('ja-JP');
    var lines = [
      _row('【顧客分析レポート】'),
      _row('出力日時', now),
      '',
      _row('指標', '値'),
      _row('総顧客数',    ins.totalCustomers + '名'),
      _row('リピーター', ins.returningCustomers + '名'),
      _row('リピート率', ins.repeatRate + '%'),
      _row('平均顧客価値', fmt(ins.avgCustomerValue)),
      _row('顧客生涯価値 (CLV)', fmt(ins.clv)),
      _row('離脱リスク', ins.atRiskCount + '名'),
      _row('新規 (30日)', ins.newIn30 + '名'),
      '',
      _row('【CLV 上位顧客】'),
      _row('顧客名', 'メール', '予約数', '生涯価値 (¥)'),
    ];

    (ins.topByClv || []).forEach(function (c) {
      lines.push(_row(c.name, c.email, c.bookings.length, c.clv));
    });

    if (ins.cohortList && ins.cohortList.length) {
      lines.push('', _row('【月別新規獲得コホート】'), _row('月', '新規顧客数'));
      ins.cohortList.forEach(function (entry) { lines.push(_row(entry[0], entry[1])); });
    }

    _download(lines, '顧客指標_' + _today() + '.csv');
    _audit('analytics_export', '顧客指標 CSV エクスポート');
  }

  function _today() {
    return new Date().toISOString().slice(0, 10);
  }

  window.AnalyticsExport = {
    revenueForecast:  revenueForecast,
    serviceRankings:  serviceRankings,
    customerMetrics:  customerMetrics,
  };
})();
