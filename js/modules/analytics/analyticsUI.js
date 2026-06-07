'use strict';
/* ════════════════════════════════════════════════════════
   ANALYTICS UI — Phase 23
   Orchestrator. Wraps window.renderAnalytics (defined in
   admin-analytics.js) to append a predictive intelligence
   section below the existing charts without touching any
   existing view HTML or script.

   Section layout (injected into #analyticsAdvanced):
     • Insight cards (full-width)
     • Revenue forecast  |  Demand forecast
     • Service perf  |  Conversion  |  Customer insights
     • Day-of-week heatmap (full-width)
   ════════════════════════════════════════════════════════ */
(function () {

  /* ── Create container once (inserted after #analyticsExtra) ── */
  function _ensureContainer() {
    if (document.getElementById('analyticsAdvanced')) return;
    const anchor = document.getElementById('analyticsExtra');
    if (!anchor) return;
    const div = document.createElement('div');
    div.id = 'analyticsAdvanced';
    anchor.insertAdjacentElement('afterend', div);
  }

  /* ── Render all predictive panels into #analyticsAdvanced ── */
  function renderAdvanced() {
    _ensureContainer();
    const c = document.getElementById('analyticsAdvanced');
    if (!c) return;

    const bk  = window.Adapter ? Adapter.getBookings() : [];
    const qt  = window.Adapter ? Adapter.getQuotes()   : [];

    /* Pre-compute module outputs for insight card synthesis */
    const moduleData = {
      forecast:    window.RevenueForecast    ? RevenueForecast.compute(bk)        : null,
      performance: window.ServicePerformance ? ServicePerformance.compute(bk)     : null,
      insights:    window.CustomerInsights   ? CustomerInsights.compute(bk)       : null,
      conversion:  window.ConversionAnalytics ? ConversionAnalytics.compute(bk, qt) : null,
    };

    c.innerHTML = `
      <div style="margin-top:16px;display:flex;flex-direction:column;gap:16px">
        <div id="advInsights"></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
          <div id="advRevForecast"></div>
          <div id="advDemandForecast"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
          <div id="advSvcPerf"></div>
          <div id="advConversion"></div>
          <div id="advCustomer"></div>
        </div>
        <div id="advDow"></div>
      </div>`;

    if (window.AnalyticsWidgets)    AnalyticsWidgets.renderInsightCards('advInsights', moduleData);
    if (window.RevenueForecast)     RevenueForecast.render('advRevForecast', bk);
    if (window.AnalyticsWidgets)    AnalyticsWidgets.renderDemandForecast('advDemandForecast', bk);
    if (window.ServicePerformance)  ServicePerformance.render('advSvcPerf', bk);
    if (window.ConversionAnalytics) ConversionAnalytics.render('advConversion', bk, qt);
    if (window.CustomerInsights)    CustomerInsights.render('advCustomer', bk);
    if (window.AnalyticsWidgets)    AnalyticsWidgets.renderDowHeatmap('advDow', bk);
  }

  /* ── Wrap renderAnalytics (from admin-analytics.js) ── */
  const _orig = window.renderAnalytics;
  window.renderAnalytics = function () {
    if (typeof _orig === 'function') _orig();
    renderAdvanced();
  };

  window.AnalyticsUI = { renderAdvanced };
})();
