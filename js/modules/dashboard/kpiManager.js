'use strict';

/* ════════════════════════════════════════════════════════
   KPI MANAGER — Phase 21D
   Persists which KPI stat cards are visible in the dashboard grid.
   Does NOT modify statistics calculations — only toggles display.

   Storage key : hm_dashboard_kpis
   Hooks       : patches renderStatGrid (immediate) + renderDash (final pass)
   UI          : "KPI設定" button injected into dashCustomizerBar
   ════════════════════════════════════════════════════════ */

window.KPIManager = (function () {

  var STORAGE_KEY = 'hm_dashboard_kpis';
  var VERSION     = 1;

  /* label must match the exact text renderStatGrid() writes into .stat-label.
     labelEn is display-only and never persisted.                               */
  var KPI_DEFS = [
    { id: 'bookings-today',    label: '今日の予約',       labelEn: 'Bookings Today'       },
    { id: 'bookings-weekly',   label: '今週の予約',       labelEn: 'Bookings This Week'   },
    { id: 'bookings-monthly',  label: '今月の予約',       labelEn: 'Bookings This Month'  },
    { id: 'pending',           label: '保留中',           labelEn: 'Pending Bookings'     },
    { id: 'confirmed',         label: '確定済み',         labelEn: 'Confirmed Bookings'   },
    { id: 'cancelled',         label: 'キャンセル',       labelEn: 'Cancelled'            },
    { id: 'customers',         label: '総顧客数',         labelEn: 'Total Customers'      },
    { id: 'reviews',           label: '承認済みレビュー', labelEn: 'Approved Reviews'     },
    { id: 'occupancy',         label: '稼働率',           labelEn: 'Occupancy Rate'       },
    { id: 'avg-daily',         label: '日平均予約数',     labelEn: 'Avg. Daily Bookings'  },
  ];

  /* ── Storage ── */

  function _defaultConfig() {
    return {
      version: VERSION,
      kpis: KPI_DEFS.map(function (d) { return { id: d.id, visible: true }; }),
    };
  }

  function get() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return _defaultConfig();
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.kpis)) {
        return _defaultConfig();
      }
      /* Forward-compatibility: add entries for any KPI_DEF not yet in storage. */
      var stored = parsed.kpis.map(function (k) { return k.id; });
      KPI_DEFS.forEach(function (def) {
        if (stored.indexOf(def.id) === -1) {
          parsed.kpis.push({ id: def.id, visible: true });
        }
      });
      return parsed;
    } catch (_) {
      return _defaultConfig();
    }
  }

  function save(config) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (_) { /* quota / private-browsing */ }
  }

  function reset() {
    var config = _defaultConfig();
    save(config);
    return config;
  }

  /* ── Visibility ── */

  /* Post-processes #statGrid: hides .stat-card elements whose .stat-label text
     matches a KPI marked visible:false.  Runs after every renderStatGrid() call
     (including Realtime-triggered updates) without touching calculations.       */
  function applyVisibility() {
    var grid = document.getElementById('statGrid');
    if (!grid) return;
    var config = get();

    /* Map label text → visible */
    var vis = {};
    config.kpis.forEach(function (k) {
      var def = KPI_DEFS.find(function (d) { return d.id === k.id; });
      if (def) vis[def.label] = k.visible;
    });

    grid.querySelectorAll('.stat-card').forEach(function (card) {
      var labelEl = card.querySelector('.stat-label');
      if (!labelEl) return;
      var text = labelEl.textContent.trim();
      if (Object.prototype.hasOwnProperty.call(vis, text)) {
        card.style.display = vis[text] ? '' : 'none';
      }
    });
  }

  /* ── Button injection (idempotent) ── */

  function _injectKPIButton() {
    if (document.getElementById('kpiSettingsBtn')) return;
    var bar = document.getElementById('dashCustomizerBar');
    if (!bar) return;

    var btn = document.createElement('button');
    btn.id          = 'kpiSettingsBtn';
    btn.className   = 'btn btn-ghost btn-sm';
    btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px';
    btn.setAttribute('onclick', 'KPIManager.openModal()');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="13" height="13" style="flex-shrink:0">' +
        '<path fill="currentColor" d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z"/>' +
      '</svg>' +
      'KPI設定';

    /* Insert before the existing settings button so it appears on the left */
    bar.insertBefore(btn, bar.firstChild);
  }

  /* ── Modal ── */

  function openModal() {
    var existing = document.getElementById('kpiSettingsModal');
    if (existing) existing.remove();

    var config = get();
    var visMap = {};
    config.kpis.forEach(function (k) { visMap[k.id] = k.visible; });

    var rows = KPI_DEFS.map(function (def) {
      var checked = visMap[def.id] !== false ? ' checked' : '';
      return '<div style="display:flex;align-items:center;justify-content:space-between;' +
             'padding:10px 0;border-bottom:1px solid var(--line-2)">' +
        '<div>' +
          '<div style="font-size:14px;color:var(--ink);font-weight:500">' + def.label + '</div>' +
          '<div style="font-size:11px;color:var(--gray-2);margin-top:2px">' + def.labelEn + '</div>' +
        '</div>' +
        '<label class="toggle">' +
          '<input type="checkbox" data-kpi-id="' + def.id + '"' + checked + '>' +
          '<div class="toggle-track"></div>' +
          '<div class="toggle-thumb"></div>' +
        '</label>' +
      '</div>';
    }).join('');

    var overlay = document.createElement('div');
    overlay.id        = 'kpiSettingsModal';
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML =
      '<div class="modal" style="max-width:440px">' +
        '<div class="modal-title">KPI設定</div>' +
        '<p style="font-size:13px;color:var(--gray-1);margin:-8px 0 16px">' +
          'ダッシュボードに表示するKPIカードを選択してください' +
        '</p>' +
        '<div>' + rows + '</div>' +
        '<div class="m-actions">' +
          '<button class="btn btn-ghost btn-sm" onclick="KPIManager.resetModal()" ' +
            'style="margin-right:auto">すべて表示</button>' +
          '<button class="btn btn-ghost" onclick="KPIManager.closeModal()">キャンセル</button>' +
          '<button class="btn btn-primary" onclick="KPIManager.saveSettings()">保存</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) KPIManager.closeModal();
    });
  }

  /* Set all checkboxes to checked without saving (user still clicks 保存) */
  function resetModal() {
    var overlay = document.getElementById('kpiSettingsModal');
    if (!overlay) return;
    overlay.querySelectorAll('input[data-kpi-id]').forEach(function (inp) {
      inp.checked = true;
    });
  }

  function closeModal() {
    var el = document.getElementById('kpiSettingsModal');
    if (el) el.remove();
  }

  /* Read checkbox states → persist → close → re-apply */
  function saveSettings() {
    var overlay = document.getElementById('kpiSettingsModal');
    if (!overlay) return;
    var config = get();
    overlay.querySelectorAll('input[data-kpi-id]').forEach(function (inp) {
      var kpi = config.kpis.find(function (k) { return k.id === inp.dataset.kpiId; });
      if (kpi) kpi.visible = inp.checked;
    });
    save(config);
    closeModal();
    applyVisibility();
    if (typeof toast === 'function') toast('KPI設定を保存しました');
  }

  /* ── Init: patch renderStatGrid and renderDash ── */

  function init() {
    /* Patch renderStatGrid — fires on every grid render including Realtime updates.
       This gives immediate visibility right after the HTML is injected. */
    var _origGrid = window.renderStatGrid;
    if (typeof _origGrid === 'function') {
      window.renderStatGrid = function () {
        _origGrid.apply(this, arguments);
        KPIManager.applyVisibility();
      };
    }

    /* Patch renderDash — at this point the full wrapper chain
       (customizer → reorder) is already in place.  Running after the entire
       renderDash chain ensures the KPI button is injected (dashCustomizerBar
       exists by now) and visibility is in the correct final state. */
    var _origDash = window.renderDash;
    if (typeof _origDash === 'function') {
      window.renderDash = function () {
        _origDash.apply(this, arguments);
        _injectKPIButton();
        KPIManager.applyVisibility();
      };
    }
  }

  return {
    get:             get,
    save:            save,
    reset:           reset,
    applyVisibility: applyVisibility,
    openModal:       openModal,
    closeModal:      closeModal,
    saveSettings:    saveSettings,
    resetModal:      resetModal,
    init:            init,
  };

}());

/* Boot — runs after dashboard.js, dashboardCustomizer.js, and dashboardReorder.js */
KPIManager.init();
