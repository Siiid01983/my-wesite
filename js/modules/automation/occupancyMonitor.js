'use strict';

/* ════════════════════════════════════════════════════════
   OCCUPANCY MONITOR — Phase 24D
   Watches calendar occupancy for the current month.
   When occupancy exceeds the configured threshold (default 80%),
   injects a persistent alert banner into the dashboard and
   records an audit entry as 'occupancy_alert'.

   Dashboard banner: ⚠️ カレンダー稼働率が84%に達しました。
   Dismissible per session (sessionStorage).

   Wraps renderDash() to keep the banner in sync after every
   dashboard render (stats update, Realtime push, etc.).
   Wraps go() to re-evaluate on each dashboard navigation.

   Storage: hm_oc_settings { version, threshold:80 }
            sessionStorage hm_oc_dismissed (date string — today)
   ════════════════════════════════════════════════════════ */

window.OccupancyMonitor = (function () {

  var SETTINGS_KEY = 'hm_oc_settings';
  var DISMISS_KEY  = 'hm_oc_dismissed';
  var ALERT_ID     = 'hmOccupancyAlert';

  /* ── Settings ── */

  function getSettings() {
    try {
      var d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (d && d.version === 1) return d;
    } catch (_) {}
    return { version: 1, threshold: 80 };
  }

  function _persist(cfg) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign({ version: 1 }, cfg))); } catch (_) {}
  }

  /* ── Occupancy calculation ── */

  function getRate() {
    if (!window.Adapter) return 0;
    var avail  = Adapter.getAvail();
    var now    = new Date();
    var prefix = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var total  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var booked = Object.keys(avail).filter(function (d) {
      return d.startsWith(prefix) && avail[d] === 'booked';
    }).length;
    return total > 0 ? (booked / total) * 100 : 0;
  }

  /* ── Dismiss logic (session-scoped, resets each day) ── */

  function _isDismissed() {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === new Date().toISOString().slice(0, 10);
    } catch (_) { return false; }
  }

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, new Date().toISOString().slice(0, 10)); } catch (_) {}
    var el = document.getElementById(ALERT_ID);
    if (el) el.style.display = 'none';
  }

  /* ── Audit (once per day) ── */

  function _auditKey() { return 'hm_oc_audited_' + new Date().toISOString().slice(0, 10); }

  function _auditIfNeeded(rate, threshold) {
    try {
      if (sessionStorage.getItem(_auditKey())) return;
      sessionStorage.setItem(_auditKey(), '1');
    } catch (_) {}
    var msg = 'カレンダー稼働率が' + rate.toFixed(1) + '%に達しました（閾値: ' + threshold + '%）';
    if (window.AuditLog) AuditLog.record('other', 'automation', 'occupancy_alert', msg);
    if (window.AutomationAudit) {
      AutomationAudit.log('occupancy:' + new Date().toISOString().slice(0, 10),
        '稼働率監視', 'alert_admin', 'success', msg);
    }
  }

  /* ── Banner HTML ── */

  function _bannerHTML(rate, threshold) {
    return '<div style="' +
        'display:flex;align-items:center;gap:12px;' +
        'padding:10px 16px;margin-bottom:16px;' +
        'background:rgba(245,158,11,.1);' +
        'border:1px solid rgba(245,158,11,.3);' +
        'border-radius:10px;' +
        'font-size:13px;color:#92400e' +
      '">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" style="flex-shrink:0"><path fill="#d97706" d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z"/></svg>' +
      '<span style="flex:1;font-weight:500">' +
        '⚠️ カレンダー稼働率が<strong>' + rate.toFixed(1) + '%</strong>に達しました。' +
        '<span style="font-size:11px;color:#b45309;margin-left:6px">（閾値: ' + threshold + '%）</span>' +
      '</span>' +
      '<button onclick="OccupancyMonitor.dismiss()" style="' +
        'background:none;border:none;cursor:pointer;' +
        'font-size:16px;color:#b45309;padding:0 2px;line-height:1;opacity:.7' +
      '" title="今日は非表示にする">✕</button>' +
    '</div>';
  }

  /* ── Main render: inject / update / remove banner ── */

  function render() {
    var view = document.getElementById('view-dashboard');
    if (!view || !view.classList.contains('active')) return;

    var existing = document.getElementById(ALERT_ID);

    if (_isDismissed()) {
      if (existing) existing.style.display = 'none';
      return;
    }

    var cfg  = getSettings();
    var rate = getRate();

    if (rate < cfg.threshold) {
      if (existing) existing.remove();
      return;
    }

    _auditIfNeeded(rate, cfg.threshold);

    if (existing) {
      existing.innerHTML = _bannerHTML(rate, cfg.threshold);
      existing.style.display = '';
    } else {
      var div = document.createElement('div');
      div.id  = ALERT_ID;
      div.innerHTML = _bannerHTML(rate, cfg.threshold);
      /* Insert before the first child of .content, after the health banner */
      var content = view.parentElement;
      view.insertBefore(div, view.firstChild);
    }
  }

  /* ── Settings panel (rendered in automation view) ── */

  function renderSettingsPanel() {
    var el = document.getElementById('ocSettingsContent');
    if (!el) return;
    var cfg  = getSettings();
    var rate = getRate();

    var rateColor = rate >= cfg.threshold
      ? 'color:var(--red);font-weight:700'
      : rate >= cfg.threshold * 0.8
        ? 'color:var(--yellow);font-weight:600'
        : 'color:var(--green);font-weight:600';

    el.innerHTML =
      '<div class="panel" style="margin-bottom:16px">' +
        '<div class="panel-head">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" style="color:var(--yellow);flex-shrink:0"><path fill="currentColor" d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z"/></svg>' +
            '<span class="panel-title">稼働率モニター設定</span>' +
          '</div>' +
          '<span style="font-size:12px;' + rateColor + '">' +
            '今月: ' + rate.toFixed(1) + '%' +
          '</span>' +
        '</div>' +
        '<div class="panel-body">' +
          '<div class="m-field" style="max-width:200px">' +
            '<label class="m-label">アラート閾値 (%)</label>' +
            '<input class="input" id="ocThreshold" type="number" min="10" max="100" step="5" ' +
              'value="' + cfg.threshold + '" />' +
            '<div style="font-size:11px;color:var(--gray-2);margin-top:4px">' +
              '月間稼働率がこの値を超えるとダッシュボードにアラートを表示します' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:8px">' +
            '<button class="btn btn-primary btn-sm" onclick="OccupancyMonitor.saveSettings()">保存</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="OccupancyMonitor.render()">今すぐ確認</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function saveSettings() {
    var inp = document.getElementById('ocThreshold');
    var threshold = inp ? (parseInt(inp.value, 10) || 80) : 80;
    threshold = Math.max(10, Math.min(100, threshold));
    _persist({ threshold: threshold });
    toast('稼働率閾値を ' + threshold + '% に設定しました');
    render();
    renderSettingsPanel();
  }

  /* ── Wrap renderDash ── */
  var _origRenderDash = window.renderDash;
  if (typeof _origRenderDash === 'function') {
    window.renderDash = function () {
      _origRenderDash();
      setTimeout(render, 0); // defer so DOM settles after renderDash
    };
  }

  /* ── Wrap go() ── */
  var _origGo = window.go;
  if (typeof _origGo === 'function') {
    window.go = function (view) {
      _origGo(view);
      if (view === 'dashboard') setTimeout(render, 100);
    };
  }

  return {
    getRate:             getRate,
    getSettings:         getSettings,
    saveSettings:        saveSettings,
    dismiss:             dismiss,
    render:              render,
    renderSettingsPanel: renderSettingsPanel,
  };

})();
