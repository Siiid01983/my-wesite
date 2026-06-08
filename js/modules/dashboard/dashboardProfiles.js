'use strict';

/* ════════════════════════════════════════════════════════
   DASHBOARD PROFILES — Phase 21E
   Three built-in dashboard presets (Owner / Operations / Marketing).
   Users can load a preset in one click or save their current layout
   over any preset.  Active profile persists across sessions.

   Storage key : hm_dashboard_profiles
   Coordinates : DashboardLayout  (widget order + visibility)
                 KPIManager       (stat-card visibility)
                 DashboardReorder (applies order to DOM)

   Patch chain position (outermost, loaded last):
     Profiles → KPI → Reorder → Customizer → original renderDash
   ════════════════════════════════════════════════════════ */

window.DashboardProfiles = (function () {

  var STORAGE_KEY = 'hm_dashboard_profiles';
  var VERSION     = 1;

  /* ── Widget/KPI ID → elementId mapping (must match DashboardLayout defaults) ── */
  var WIDGET_META = {
    'stats':           'statGrid',
    'quick-actions':   'qaGrid',
    'observability':   'obsPanel',
    'bi-revenue':      'biRevenuePanel',
    'bi-trend':        'biTrendPanel',
    'bi-service':      'biServicePanel',
    'bi-customer':     'biCustomerPanel',
    'bi-operational':  'biOperationalPanel',
    'bi-export':       'biExportPanel',
    'recent-bookings': 'recentWrap',
    'activity':        'activityWrap',
  };

  var KPI_IDS = [
    'bookings-today', 'bookings-weekly', 'bookings-monthly',
    'pending', 'confirmed', 'cancelled',
    'customers', 'reviews', 'occupancy', 'avg-daily',
  ];

  /* Build a full DashboardLayout-compatible layout object from a compact spec.
     spec: [{ id, visible, order }]  — elementId is looked up from WIDGET_META. */
  function _layout(spec) {
    return {
      version: 1,
      widgets: spec.map(function (s) {
        return { id: s.id, elementId: WIDGET_META[s.id] || '', visible: s.visible, order: s.order };
      }),
    };
  }

  /* Build a KPIManager-compatible config object.
     hidden: array of KPI IDs to set visible:false; all others default to true. */
  function _kpis(hidden) {
    return {
      version: 1,
      kpis: KPI_IDS.map(function (id) {
        return { id: id, visible: hidden.indexOf(id) === -1 };
      }),
    };
  }

  /* ════════════════════════════════════════════════════════
     BUILT-IN PRESETS
     ════════════════════════════════════════════════════════ */

  var PRESETS = {

    /* Owner — complete overview, default order, all visible */
    owner: {
      id: 'owner', name: 'オーナー', nameEn: 'Owner',
      layout: _layout([
        { id: 'stats',           visible: true,  order:  1 },
        { id: 'quick-actions',   visible: true,  order:  2 },
        { id: 'observability',   visible: true,  order:  3 },
        { id: 'bi-revenue',      visible: true,  order:  4 },
        { id: 'bi-trend',        visible: true,  order:  5 },
        { id: 'bi-service',      visible: true,  order:  6 },
        { id: 'bi-customer',     visible: true,  order:  7 },
        { id: 'bi-operational',  visible: true,  order:  8 },
        { id: 'bi-export',       visible: true,  order:  9 },
        { id: 'recent-bookings', visible: true,  order: 10 },
        { id: 'activity',        visible: true,  order: 11 },
      ]),
      kpis: _kpis([]), // all KPIs visible
    },

    /* Operations — daily ops focus: status counts, recent work, scheduling */
    operations: {
      id: 'operations', name: 'オペレーション', nameEn: 'Operations',
      layout: _layout([
        { id: 'stats',           visible: true,  order:  1 },
        { id: 'quick-actions',   visible: true,  order:  2 },
        { id: 'bi-operational',  visible: true,  order:  3 },
        { id: 'recent-bookings', visible: true,  order:  4 },
        { id: 'activity',        visible: true,  order:  5 },
        { id: 'bi-export',       visible: true,  order:  6 },
        { id: 'observability',   visible: false, order:  7 },
        { id: 'bi-revenue',      visible: false, order:  8 },
        { id: 'bi-trend',        visible: false, order:  9 },
        { id: 'bi-service',      visible: false, order: 10 },
        { id: 'bi-customer',     visible: false, order: 11 },
      ]),
      kpis: _kpis(['customers', 'reviews']),
    },

    /* Marketing — analytics focus: revenue, trends, customer acquisition */
    marketing: {
      id: 'marketing', name: 'マーケティング', nameEn: 'Marketing',
      layout: _layout([
        { id: 'stats',           visible: true,  order:  1 },
        { id: 'bi-revenue',      visible: true,  order:  2 },
        { id: 'bi-trend',        visible: true,  order:  3 },
        { id: 'bi-service',      visible: true,  order:  4 },
        { id: 'bi-customer',     visible: true,  order:  5 },
        { id: 'recent-bookings', visible: true,  order:  6 },
        { id: 'activity',        visible: true,  order:  7 },
        { id: 'quick-actions',   visible: false, order:  8 },
        { id: 'observability',   visible: false, order:  9 },
        { id: 'bi-operational',  visible: false, order: 10 },
        { id: 'bi-export',       visible: false, order: 11 },
      ]),
      kpis: _kpis(['bookings-today', 'bookings-weekly', 'pending', 'confirmed', 'cancelled', 'avg-daily']),
    },

  };

  /* ── Storage ── */

  function _loadStorage() {
    try {
      var raw    = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.version === VERSION) return parsed;
    } catch (_) {}
    return { version: VERSION, active: 'owner', overrides: {} };
  }

  function _saveStorage(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  /* Returns the effective profile: user override (if saved) → built-in preset. */
  function _getProfile(id) {
    var preset = PRESETS[id];
    if (!preset) return null;
    var storage  = _loadStorage();
    var override = storage.overrides && storage.overrides[id];
    if (!override) return preset;
    return { id: preset.id, name: preset.name, nameEn: preset.nameEn,
             layout: override.layout, kpis: override.kpis, customized: true };
  }

  /* ── Public API ── */

  function getActiveId() {
    return _loadStorage().active || 'owner';
  }

  /* Apply a profile to the live dashboard without a full re-render.
     Updates DashboardLayout + KPIManager storage, then re-sorts
     existing drag slots and re-applies visibility. */
  function load(profileId) {
    var profile = _getProfile(profileId);
    if (!profile) return;

    DashboardLayout.save(profile.layout);
    if (window.KPIManager) KPIManager.save(profile.kpis);

    var storage  = _loadStorage();
    storage.active = profileId;
    _saveStorage(storage);

    /* Re-sort slots → apply widget visibility → apply KPI card visibility */
    if (window.DashboardReorder) DashboardReorder.applyOrder();
    if (window.KPIManager)       KPIManager.applyVisibility();

    _updateTabState(profileId);
    if (typeof toast === 'function') toast('プロファイル「' + profile.name + '」を適用しました');
  }

  /* Snapshot the current DashboardLayout + KPIManager state as a user override
     for the currently active profile. */
  function saveCurrent() {
    var activeId = getActiveId();
    var storage  = _loadStorage();
    if (!storage.overrides) storage.overrides = {};
    storage.overrides[activeId] = {
      layout: DashboardLayout.get(),
      kpis:   window.KPIManager ? KPIManager.get() : PRESETS[activeId].kpis,
    };
    _saveStorage(storage);
    var name = PRESETS[activeId] ? PRESETS[activeId].name : activeId;
    if (typeof toast === 'function') toast('「' + name + '」に保存しました');
  }

  /* Discard any user override for a profile and restore its built-in preset. */
  function resetProfile(profileId) {
    var storage = _loadStorage();
    if (storage.overrides) delete storage.overrides[profileId];
    _saveStorage(storage);
    if (getActiveId() === profileId) load(profileId);
    else if (typeof toast === 'function') toast('プリセットに戻しました');
  }

  /* ── CSS (injected once) ── */

  function _injectCSS() {
    if (document.getElementById('dashProfilesCSS')) return;
    var s = document.createElement('style');
    s.id = 'dashProfilesCSS';
    s.textContent =
      '.dash-profile-tabs{display:flex;background:var(--bg-soft-2);' +
        'border-radius:8px;padding:2px;gap:1px}' +
      '.dash-profile-tab{border:none;background:transparent;padding:5px 12px;' +
        'border-radius:6px;font-size:12px;cursor:pointer;color:var(--gray-1);' +
        'font-family:inherit;transition:color .15s,background .15s;white-space:nowrap}' +
      '.dash-profile-tab:hover:not(.active){color:var(--ink)}' +
      '.dash-profile-tab.active{background:var(--bg);color:var(--ink);font-weight:600;' +
        'box-shadow:0 1px 3px rgba(0,0,0,.12)}';
    document.head.appendChild(s);
  }

  /* ── Bar injection ── */

  /* Injects profile tabs + save button into the left side of dashCustomizerBar.
     Since kpiManager.js prepends its button first, this runs after and becomes
     the actual leftmost element, held in place by margin-right:auto. */
  function _injectProfileBar() {
    if (document.getElementById('dashProfileBar')) return;
    var bar = document.getElementById('dashCustomizerBar');
    if (!bar) return;

    _injectCSS();
    var activeId = getActiveId();

    var wrap = document.createElement('div');
    wrap.id = 'dashProfileBar';
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-right:auto';
    wrap.innerHTML =
      '<span style="font-size:12px;color:var(--gray-1);white-space:nowrap;flex-shrink:0">' +
        'プロファイル' +
      '</span>' +
      '<div class="dash-profile-tabs">' +
        ['owner', 'operations', 'marketing'].map(function (id) {
          var cls = 'dash-profile-tab' + (id === activeId ? ' active' : '');
          return '<button class="' + cls + '" data-profile="' + id + '" ' +
            'onclick="DashboardProfiles.load(\'' + id + '\')">' +
            PRESETS[id].name + '</button>';
        }).join('') +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" onclick="DashboardProfiles.saveCurrent()" ' +
        'style="display:inline-flex;align-items:center;gap:5px;flex-shrink:0" ' +
        'title="現在のレイアウトをこのプロファイルに保存">' +
        '<svg viewBox="0 0 24 24" width="12" height="12">' +
          '<path fill="currentColor" d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4z' +
            'm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>' +
        '</svg>' +
        '保存' +
      '</button>';

    bar.insertBefore(wrap, bar.firstChild);
  }

  function _updateTabState(activeId) {
    document.querySelectorAll('.dash-profile-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.profile === activeId);
    });
  }

  /* ── Patch renderDash (outermost wrapper — loads last) ── */

  function init() {
    var _orig = window.renderDash;
    if (typeof _orig !== 'function') return;
    window.renderDash = function () {
      _orig.apply(this, arguments);
      _injectProfileBar();
      _updateTabState(getActiveId());
    };
  }

  return {
    load:         load,
    saveCurrent:  saveCurrent,
    resetProfile: resetProfile,
    getActiveId:  getActiveId,
    PRESETS:      PRESETS,     /* exposed for debugging */
    init:         init,
  };

}());

/* Boot — must be last in the dashboard module chain */
DashboardProfiles.init();
